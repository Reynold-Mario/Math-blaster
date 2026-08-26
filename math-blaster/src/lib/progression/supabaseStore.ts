import type {
  MergeHint,
  ProgressionCodec,
  ProgressionHandle,
  ProgressionStore,
} from './ProgressionStore';
import type { RemoteProgression } from './RemoteProgression';

/**
 * A `ProgressionStore` that keeps a remote copy in step, WITHOUT becoming the
 * boot path.
 *
 * It wraps another store - the localStorage one - rather than replacing it, and
 * that composition is the whole design:
 *
 * - **`current` is still synchronous**, because it is the cache's `current`.
 *   There is no loading phase, no spinner, and no `0 banked` flash while a
 *   fetch is in flight. A signed-out player, an offline player and a player on
 *   a dead network all get exactly today's game.
 * - **The network is an UPDATE, never the source.** The remote read happens in
 *   the background and arrives through `onRemote`, which `Game.svelte` only
 *   acts on at a safe phase. Nothing here can land mid-`tick()` and race
 *   `awardCurrency()`.
 * - **Every failure is silent to the player.** Offline, signed out, a 5xx, a
 *   conflict: all of them degrade to "the local game keeps working and we try
 *   again". A sync problem must never cost a wave.
 *
 * With `remote: null` this is a transparent pass-through, which is what makes
 * it safe to wire in before any credentials exist.
 */

/**
 * Trailing debounce on the PUSH, deliberately slower than the cache's 2s.
 *
 * The cache absorbs the per-kill write rate; this only has to keep the server
 * roughly current. Every extra second here is a request not made.
 */
const PUSH_DEBOUNCE_MS = 5000;
/** ...and the same hard deadline reasoning as the cache: a busy run must not
 * be able to postpone the write forever. */
const PUSH_MAX_WAIT_MS = 30000;
/** First retry delay after an `unavailable` write. Doubles, capped. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;

export interface SupabaseProgressionStoreOptions {
  /** The synchronous cache, and the boot path. In the game this is
   * `createLocalStorageStore`. */
  cache: ProgressionStore;
  /**
   * `null` means "no remote configured" and makes this a pass-through.
   *
   * That is the state the game ships in until credentials exist, so it is the
   * path that must be boringly safe rather than an afterthought.
   */
  remote: RemoteProgression | null;
  pushDebounceMs?: number;
  pushMaxWaitMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  now?(): number;
  /**
   * Where sync failures go. Reported, never thrown: `put()` is called from the
   * game loop and an exception escaping it would take the run down over a
   * failed HTTP request.
   */
  onError?(where: string, error: unknown): void;
}

/**
 * Deep equality by value, INDEPENDENT OF KEY ORDER.
 *
 * `JSON.stringify` was the obvious thing here and it was wrong. The codec's
 * `parse` and `merge` build their objects with different literal key orders -
 * Math Blaster's `parse` opens with `currency`, its `merge` opens with
 * `earnedTotal` - so two semantically identical profiles stringified to
 * different text, the "nothing to say" check never fired, and every signed-in
 * player pushed a redundant write on EVERY BOOT. Harmless to the data because
 * the triggers are monotone, but it burned a revision each time, which makes
 * real conflict detection noisier, and it defeated the one property this guard
 * exists to provide.
 *
 * Caught by watching a real boot bump `revision` 5 -> 6 with byte-identical
 * state; the unit tests missed it because the test codec happened to emit its
 * keys in the same order from both methods.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function createSupabaseProgressionStore(
  options: SupabaseProgressionStoreOptions
): ProgressionStore {
  const {
    cache,
    remote,
    pushDebounceMs = PUSH_DEBOUNCE_MS,
    pushMaxWaitMs = PUSH_MAX_WAIT_MS,
    retryBaseMs = RETRY_BASE_MS,
    retryMaxMs = RETRY_MAX_MS,
    now = () => Date.now(),
    onError = () => {},
  } = options;

  return {
    open<S>(codec: ProgressionCodec<S>): ProgressionHandle<S> {
      const inner = cache.open(codec);
      if (remote === null) return inner;

      const listeners = new Set<(merged: S) => void>();

      /**
       * What we intend to send next, which is NOT the same as the cache's
       * state.
       *
       * The cache only learns about a merge when the game calls `put()` after
       * applying it, so pushing straight from `inner.current` would send a copy
       * that predates the merge. Holding the outgoing value here keeps the two
       * independent and means nothing has to write the cache from a background
       * task - which is the exact race the seam exists to prevent.
       */
      let outgoing: S | null = null;
      /** The revision we last READ. `null` = no row seen yet, so a write
       * inserts rather than updating. */
      let lastRevision: number | null = null;
      let rowKnown = false;

      let timer: ReturnType<typeof setTimeout> | null = null;
      let pendingSince: number | null = null;
      let retryDelay = retryBaseMs;
      let inFlight = false;
      let disposed = false;

      /**
       * The last merge we produced, replayed to any listener that subscribes
       * afterwards.
       *
       * `Game.svelte` constructs the store during component init and subscribes
       * in `onMount`, so a fast boot fetch can resolve before anyone is
       * listening. Without this the very first sync - the one that restores a
       * returning player on a new device - is the one that gets dropped.
       */
      let lastEmitted: S | null = null;

      function emit(merged: S): void {
        lastEmitted = merged;
        for (const fn of listeners) {
          try {
            fn(merged);
          } catch (error) {
            // A listener throwing is the listener's problem. Swallowing it
            // here keeps one bad subscriber from stopping the others.
            onError('onRemote listener', error);
          }
        }
      }

      function clearTimer(): void {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      }

      function schedulePush(): void {
        if (disposed || outgoing === null) return;
        const at = now();
        if (pendingSince === null) pendingSince = at;
        const dueAt = Math.min(at + pushDebounceMs, pendingSince + pushMaxWaitMs);
        clearTimer();
        timer = setTimeout(() => void push(), Math.max(0, dueAt - at));
      }

      function scheduleRetry(): void {
        if (disposed || outgoing === null) return;
        clearTimer();
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, retryMaxMs);
        timer = setTimeout(() => void push(), delay);
      }

      /**
       * Which side of a merge holds the newer PREFERENCE.
       *
       * Monotone fields do not care - `max` is the same answer either way. This
       * is only about `selectedGrade`, and the schema already answers it:
       * `grade_source = 'platform'` means something upstream knows the child's
       * grade and outranks the local picker; `'self'` means the local pick IS
       * the record, so the local copy wins.
       *
       * If a SECOND preference field ever appears, this stops being adequate -
       * one hint cannot speak for two preferences with different authorities,
       * and that is the point at which the merge needs per-field rules rather
       * than a hint.
       */
      function hintFor(gradeSource: 'self' | 'platform' | null): MergeHint {
        return gradeSource === 'platform' ? 'b-is-newer' : 'a-is-newer';
      }

      async function syncFromRemote(): Promise<void> {
        if (remote === null || disposed) return;
        try {
          const profileId = await remote.currentProfileId();
          // Signed out is the default state, not a failure.
          if (profileId === null || disposed) return;

          const snapshot = await remote.read(codec.gameSlug);
          if (disposed) return;

          if (snapshot === null) {
            // Never played on this account. Our local copy is the only copy,
            // so seed the row from it.
            rowKnown = true;
            lastRevision = null;
            outgoing = inner.current;
            schedulePush();
            return;
          }

          rowKnown = true;
          lastRevision = snapshot.revision;

          const local = inner.current;
          const incoming = codec.parse(snapshot.state);
          let merged = codec.merge(local, incoming, hintFor(snapshot.gradeSource));

          // A grade the platform asserts outranks the local picker, and the
          // codec decides where it lands - this store does not know what field
          // a game keeps a grade in. Validation stays downstream, in the game's
          // own `resolveGrade()`.
          if (
            snapshot.gradeSource === 'platform' &&
            snapshot.gradeLevel !== null &&
            codec.applyPlatformGrade !== undefined
          ) {
            merged = codec.applyPlatformGrade(merged, snapshot.gradeLevel);
          }

          emit(merged);

          // Push only if we actually know something the server does not.
          // Re-sending an identical payload would burn a request and a
          // revision bump for nothing. Compared by VALUE - see stableStringify:
          // a string compare here silently pushed on every boot.
          if (stableStringify(merged) !== stableStringify(incoming)) {
            outgoing = merged;
            schedulePush();
          }
        } catch (error) {
          onError('syncFromRemote', error);
        }
      }

      async function push(): Promise<void> {
        if (remote === null || disposed || inFlight) return;
        const payload = outgoing;
        if (payload === null) return;

        inFlight = true;
        clearTimer();
        pendingSince = null;
        try {
          const profileId = await remote.currentProfileId();
          if (profileId === null || disposed) {
            // Signed out. Keep the payload: if a session appears later, the
            // next `put()` sends it. Do not retry on a timer - there is
            // nothing to wait for.
            return;
          }

          const result = await remote.write({
            gameSlug: codec.gameSlug,
            state: payload,
            stateVersion: codec.stateVersion,
            furthest: codec.furthest(payload),
            expectedRevision: rowKnown ? lastRevision : null,
          });
          if (disposed) return;

          if (result.outcome === 'written') {
            lastRevision = result.revision;
            rowKnown = true;
            retryDelay = retryBaseMs;
            // Only clear the payload if nothing newer arrived while the
            // request was in flight.
            if (outgoing === payload) outgoing = null;
            return;
          }

          if (result.outcome === 'conflict') {
            // Somebody else wrote. Re-read and re-merge through the GAME's
            // merge - never clobber, and never retry the same payload, which
            // would just conflict again.
            const snapshot = await remote.read(codec.gameSlug);
            if (disposed) return;
            if (snapshot === null) {
              // The row went away underneath us. Treat it as an insert.
              lastRevision = null;
              rowKnown = false;
              scheduleRetry();
              return;
            }
            lastRevision = snapshot.revision;
            rowKnown = true;
            const incoming = codec.parse(snapshot.state);
            // `payload` holds work the server has not seen, so the local side
            // is the newer writer for preference purposes.
            const merged = codec.merge(payload, incoming, 'a-is-newer');
            outgoing = merged;
            emit(merged);
            retryDelay = retryBaseMs;
            scheduleRetry();
            return;
          }

          // unavailable: same payload, later.
          scheduleRetry();
        } catch (error) {
          onError('push', error);
          scheduleRetry();
        } finally {
          inFlight = false;
        }
      }

      // Coming back online is a much better retry trigger than a timer that
      // happened to be counting down, so take both.
      const onOnline = () => {
        retryDelay = retryBaseMs;
        if (outgoing !== null) void push();
      };
      if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

      // Kick the boot read off without awaiting it. Nothing below this line
      // depends on it having finished, which is the property that keeps boot
      // synchronous.
      void syncFromRemote();

      return {
        get current(): S {
          return inner.current;
        },
        put(next: S): void {
          inner.put(next);
          outgoing = next;
          schedulePush();
        },
        flush(): void {
          inner.flush();
          // Fire and forget. `flush()` is synchronous by contract - the
          // moments that call it (a purchase, game over, `pagehide`) cannot
          // wait on a round trip, and the cache has already taken the write.
          void push();
        },
        onRemote(fn: (merged: S) => void): () => void {
          listeners.add(fn);
          // Replay, so a subscriber that arrived after the boot fetch still
          // hears about it.
          if (lastEmitted !== null) {
            try {
              fn(lastEmitted);
            } catch (error) {
              onError('onRemote replay', error);
            }
          }
          return () => void listeners.delete(fn);
        },
        dispose(): void {
          disposed = true;
          clearTimer();
          listeners.clear();
          if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
          inner.dispose();
        },
      };
    },
  };
}
