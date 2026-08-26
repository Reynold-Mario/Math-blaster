import type { LearnerIdentitySource } from '../identity/LearnerIdentity';
import type { ProgressionCodec, ProgressionHandle, ProgressionStore } from './ProgressionStore';

/**
 * The store that lets a grade asserted by the platform reach a run.
 *
 * Composed OUTERMOST, so it has the last word:
 *
 *   localStorage  ->  supabase  ->  platformGrade
 *
 * It applies `codec.applyPlatformGrade` and emits through `onRemote`, which is
 * the channel `Game.svelte` already gates on a safe phase. `gradeSource.ts` is
 * untouched: its docstring always said the store would put the grade on the
 * profile and `resolveGrade()` would keep validating it, and that is exactly
 * what happens here.
 *
 * **Two rules, and both are the reason this is a store rather than a few lines
 * in `Game.svelte`.**
 *
 *  1. **The platform grade is applied LAST, every time.** It outranks the local
 *     picker, and it outranks a merge arriving later from the network. So an
 *     inner emit does not replace the grade, it gets the grade re-applied on top
 *     before going out.
 *  2. **It never calls `put()`.** A background write is the precise race the
 *     progression seam exists to prevent. This emits and stops; the game applies
 *     it when it is safe to, and the next ordinary save persists it. If the
 *     player quits before one happens, nothing is lost - the platform asserts
 *     the same grade again next boot, which is correct for a value the platform
 *     owns rather than one we are storing on its behalf.
 *
 * Why not an option on `createSupabaseProgressionStore`: it returns `inner`
 * untouched when `remote === null`, and that is *precisely* the configuration
 * this ships in first - so the grade would be silently dropped in the only
 * build anyone is running. And not through `profiles.grade_source` either,
 * which cannot fire without a session.
 */
export interface PlatformGradeStoreOptions {
  inner: ProgressionStore;
  /** `null` - no platform configured - makes this a transparent pass-through,
   * exactly like `remote: null` does one layer down. */
  identity: LearnerIdentitySource | null;
  /**
   * Maps the platform's grade vocabulary onto the game's, returning `null` for
   * "no usable opinion". Injected rather than imported so this file stays as
   * ignorant of the curriculum as the cache below it is of the game.
   */
  mapGrade(raw: string): string | null;
  /**
   * Fired once, if the platform asserts a grade this game can use.
   *
   * Exists so exactly one place decides "a platform grade is in force". The
   * UI has to know - a picker that still looks editable while the platform
   * overrules it on every boot is a control that lies - and having the screen
   * re-derive it would put the same mapping in two places.
   */
  onGranted?(grade: string): void;
  onError?(where: string, error: unknown): void;
}

export function createPlatformGradeStore(options: PlatformGradeStoreOptions): ProgressionStore {
  const { inner: innerStore, identity, mapGrade, onGranted = () => {}, onError = () => {} } = options;

  return {
    open<S>(codec: ProgressionCodec<S>): ProgressionHandle<S> {
      const inner = innerStore.open(codec);
      // No platform, or a codec with no opinion about platform grades: there is
      // nothing to add, so add nothing rather than a layer of indirection.
      if (identity === null || codec.applyPlatformGrade === undefined) return inner;
      const applyPlatformGrade = codec.applyPlatformGrade.bind(codec);

      const listeners = new Set<(merged: S) => void>();
      /**
       * Replayed to late subscribers, for the same reason `supabaseStore` keeps
       * one: `Game.svelte` builds the store during component init and subscribes
       * in `onMount`, so a fast resolve can land before anyone is listening.
       */
      let lastEmitted: S | null = null;
      /** The most recent state we know of - the cache's at open, then whatever
       * the game last wrote or the network last merged. Never read from
       * `inner.current`, which only learns about a merge once the game has
       * applied it and called `put()`. */
      let latest: S = inner.current;
      /** The mapped grade, once the platform has told us. */
      let granted: string | null = null;
      let disposed = false;

      function emit(next: S): void {
        latest = next;
        lastEmitted = next;
        for (const fn of listeners) {
          try {
            fn(next);
          } catch (error) {
            // One bad subscriber must not stop the others.
            onError('platformGrade listener', error);
          }
        }
      }

      function withGrade(state: S): S {
        return granted === null ? state : applyPlatformGrade(state, granted);
      }

      // A merge from below is re-stamped rather than passed through, so a
      // network round trip that happens to finish after the platform answered
      // cannot quietly undo it.
      const unsubscribe = inner.onRemote((merged) => {
        latest = merged;
        emit(withGrade(merged));
      });

      // Not awaited. Boot stays synchronous, and this arrives - if it arrives -
      // through the same channel a remote merge does.
      void identity
        .resolve()
        .then((result) => {
          if (disposed || result.outcome !== 'identified') return;
          const raw = result.identity.grade;
          // No grade, or one the game has no maths for: say nothing at all.
          // Emitting here would overwrite the player's own pick with a value we
          // could not translate, which is worse than leaving it alone.
          const mapped = raw === null ? null : mapGrade(raw);
          if (mapped === null) return;
          granted = mapped;
          try {
            onGranted(mapped);
          } catch (error) {
            onError('platformGrade onGranted', error);
          }
          emit(withGrade(latest));
        })
        .catch((error: unknown) => {
          // `resolve()` is contractually total, so this is belt and braces -
          // but an unhandled rejection on the boot path would be a real one.
          onError('platformGrade resolve', error);
        });

      return {
        get current(): S {
          // Deliberately the cache's value, not `latest`. `current` is the
          // synchronous boot answer, and at boot the platform has not spoken.
          return inner.current;
        },
        put(next: S): void {
          latest = next;
          inner.put(next);
        },
        flush(): void {
          inner.flush();
        },
        onRemote(fn: (merged: S) => void): () => void {
          listeners.add(fn);
          if (lastEmitted !== null) {
            try {
              fn(lastEmitted);
            } catch (error) {
              onError('platformGrade replay', error);
            }
          }
          return () => void listeners.delete(fn);
        },
        dispose(): void {
          disposed = true;
          listeners.clear();
          unsubscribe();
          inner.dispose();
        },
      };
    },
  };
}
