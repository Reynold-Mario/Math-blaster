import type { LearnerIdentitySource } from '../identity/LearnerIdentity';
import { claimAnonymousSave, learnerScopedKey } from '../identity/learnerScope';
import type { StorageLike } from './localStorageStore';
import type { ProgressionCodec, ProgressionHandle, ProgressionStore } from './ProgressionStore';

/**
 * One slot per learner, on a device that may have several.
 *
 * `pixelMathBlaster.profile.v1` is one slot per BROWSER. Two children on one
 * tablet share currency, skills and each other's queued runs, which is fine for
 * a game nobody was signed in to and wrong the moment somebody is.
 *
 * Takes a FACTORY rather than a store, because it has to open a second stack
 * against a different key once it learns who is playing, and a store binds its
 * key at `open()`. That also means the swap re-points everything below it -
 * including, when there is one, the network layer - rather than leaving a
 * cache pointed at one learner and a remote at another.
 *
 * Boot stays synchronous: it opens the anonymous slot immediately and swaps
 * later, announcing the swap on `onRemote` like any other late arrival.
 */
export interface LearnerScopedStoreOptions {
  /**
   * Builds a store bound to ONE storage key. Called once for the anonymous
   * slot, and once more if a learner turns up.
   */
  storeFor(key: string): ProgressionStore;
  /** The slot for a player we cannot name. Never moves - see `learnerScope.ts`. */
  anonymousKey: string;
  /** `null` makes this a transparent pass-through. */
  identity: LearnerIdentitySource | null;
  /** For the claim marker only; the stores below own their own storage. */
  storage?: StorageLike | null;
  /**
   * Fired once, when a learner takes over the device.
   *
   * `claimedAnonymous` says whether they also adopted the anonymous save.
   * Reported rather than re-derived because the claim is a ONE-TIME decision:
   * asking `claimAnonymousSave` a second time answers "already mine", so a
   * second caller working it out for itself would always conclude there was
   * nothing to carry. The pending-run queue is that second caller.
   */
  onScoped?(learnerId: string, claimedAnonymous: boolean): void;
  onError?(where: string, error: unknown): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createLearnerScopedStore(options: LearnerScopedStoreOptions): ProgressionStore {
  const {
    storeFor,
    anonymousKey,
    identity,
    storage = defaultStorage(),
    onScoped = () => {},
    onError = () => {},
  } = options;

  return {
    open<S>(codec: ProgressionCodec<S>): ProgressionHandle<S> {
      const anonymous = storeFor(anonymousKey).open(codec);
      if (identity === null) return anonymous;

      let active = anonymous;
      let disposed = false;
      const listeners = new Set<(merged: S) => void>();
      let lastEmitted: S | null = null;

      function emit(next: S): void {
        lastEmitted = next;
        for (const fn of listeners) {
          try {
            fn(next);
          } catch (error) {
            onError('learnerScoped listener', error);
          }
        }
      }

      // Whatever the active handle announces is passed straight up. Re-bound on
      // a swap, so a merge for the previous learner cannot arrive after it.
      let unbindActive = active.onRemote(emit);

      function adopt(learnerId: string): void {
        const outcome = claimAnonymousSave(storage, learnerId);
        // Read through the handle rather than the raw string: writes made
        // before identity resolved are in here and would otherwise be lost.
        const carried = anonymous.current;

        const learner = storeFor(learnerScopedKey(anonymousKey, learnerId)).open(codec);
        if (outcome === 'claimed') {
          // One-time carry-over. `flush` so a tab closed immediately after does
          // not lose the very save we just decided belongs to this child.
          learner.put(carried);
          learner.flush();
        }

        unbindActive();
        active = learner;
        unbindActive = active.onRemote(emit);
        // Disposing the anonymous handle flushes it back to ITS key, which is a
        // different one - so nothing we just wrote gets overwritten, and a
        // guest still finds their game.
        anonymous.dispose();

        try {
          onScoped(learnerId, outcome === 'claimed');
        } catch (error) {
          onError('learnerScoped onScoped', error);
        }
        emit(active.current);
      }

      void identity
        .resolve()
        .then((result) => {
          if (disposed || result.outcome !== 'identified') return;
          adopt(result.identity.learnerId);
        })
        .catch((error: unknown) => {
          onError('learnerScoped resolve', error);
        });

      return {
        get current(): S {
          return active.current;
        },
        put(next: S): void {
          active.put(next);
        },
        flush(): void {
          active.flush();
        },
        onRemote(fn: (merged: S) => void): () => void {
          listeners.add(fn);
          if (lastEmitted !== null) {
            try {
              fn(lastEmitted);
            } catch (error) {
              onError('learnerScoped replay', error);
            }
          }
          return () => void listeners.delete(fn);
        },
        dispose(): void {
          disposed = true;
          listeners.clear();
          unbindActive();
          active.dispose();
        },
      };
    },
  };
}
