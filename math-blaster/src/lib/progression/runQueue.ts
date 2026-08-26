import type { StorageLike } from './localStorageStore';
import type { RemoteProgression, RunSubmission } from './RemoteProgression';

/**
 * Finished runs, held until the server has them.
 *
 * **THE RUN IS WRITTEN TO STORAGE BEFORE ANY NETWORK CALL.** That ordering is
 * the whole point: a run ends, the tab closes, the child's practice is still
 * recorded and lands on the next boot. Submitting first and persisting only on
 * failure would lose exactly the runs a flaky connection makes most likely to
 * fail.
 *
 * The idempotency key is generated ONCE here, when the run is queued, and
 * travels with it through every retry. `submit_run()` is unique on
 * (profile_id, idempotency_key), so a replay is a no-op on the server rather
 * than a doubled mastery record. Generating a new key per attempt would defeat
 * the mechanism entirely - which is why the key is not the caller's business.
 *
 * Three outcomes, three different responses, and the third is the one that
 * matters: `submitted` and `rejected` both DROP the run, `unavailable` keeps it.
 * Without a terminal-failure outcome a single malformed run would retry forever
 * and every later run would queue behind it.
 */

/** Cap on stored runs. Generous, because each one is small and each one is a
 * child's practice. See `enqueue` for what happens at the ceiling and why. */
const MAX_QUEUED = 50;
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 120000;

export const PENDING_RUNS_KEY = 'pixelMathBlaster.pendingRuns.v1';

export interface RunQueueOptions {
  /** `null` disables the queue entirely: nothing is stored and nothing is sent,
   * which is the signed-out / unconfigured path. */
  remote: RemoteProgression | null;
  storage?: StorageLike | null;
  key?: string;
  maxQueued?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Injected so tests need no crypto and no randomness. */
  newKey?(): string;
  onError?(where: string, error: unknown): void;
}

export interface RunQueue {
  /** Queue a finished run. Persists first, then tries to send. */
  submit(run: Omit<RunSubmission, 'idempotencyKey'>): void;
  /** Attempt a drain now. */
  flush(): void;
  /** How many runs are waiting. For tests and the dev console. */
  pending(): number;
  /**
   * Move the queue to another storage key, once this device learns who is
   * playing.
   *
   * A queued run is worse to mis-attribute than a profile is: `submit_run()`
   * writes it into a child's permanent practice record, where a profile only
   * decides how much currency they have. So the runs banked before we knew who
   * was here are carried over only when this learner also claimed the
   * anonymous profile - one decision per device, taken in `learnerScope.ts` -
   * and otherwise stay behind for whoever comes back for them.
   */
  rekey(key: string, carryPending: boolean): void;
  dispose(): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Present but throwing - Safari private mode has done exactly this.
    return null;
  }
}

function defaultKey(): string {
  // `crypto.randomUUID` needs a secure context; a run must still be queueable
  // without one, and the key only has to be unique per profile.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function createRunQueue(options: RunQueueOptions): RunQueue {
  const {
    remote,
    storage = defaultStorage(),
    key: initialKey = PENDING_RUNS_KEY,
    maxQueued = MAX_QUEUED,
    retryBaseMs = RETRY_BASE_MS,
    retryMaxMs = RETRY_MAX_MS,
    newKey = defaultKey,
    onError = () => {},
  } = options;

  let storageKey = initialKey;
  let queue: RunSubmission[] = read();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = retryBaseMs;
  let draining = false;
  let disposed = false;

  function read(): RunSubmission[] {
    if (!storage) return [];
    let raw: string | null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      return [];
    }
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Keep only entries that still carry the two fields the server needs to
      // be idempotent. A hand-edited or older-shaped entry is dropped rather
      // than sent, because a run without a key can double a practice record.
      return parsed.filter(
        (r): r is RunSubmission =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as RunSubmission).idempotencyKey === 'string' &&
          (r as RunSubmission).idempotencyKey !== '' &&
          typeof (r as RunSubmission).gameSlug === 'string'
      );
    } catch {
      return [];
    }
  }

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(queue));
    } catch {
      // Quota, or storage disabled mid-session. The in-memory queue still
      // drains this session; losing a save is not worth losing the run.
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleRetry(): void {
    if (disposed || queue.length === 0) return;
    clearTimer();
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, retryMaxMs);
    timer = setTimeout(() => void drain(), delay);
  }

  async function drain(): Promise<void> {
    if (remote === null || disposed || draining || queue.length === 0) return;
    draining = true;
    clearTimer();
    try {
      // Oldest first, one at a time. Sequential rather than parallel: these are
      // writes to the same rows, and a burst buys nothing but contention.
      while (queue.length > 0 && !disposed) {
        const run = queue[0];
        if (run === undefined) break;
        const result = await remote.submitRun(run);

        if (result.outcome === 'unavailable') {
          scheduleRetry();
          return;
        }
        if (result.outcome === 'rejected') {
          // Terminal. Drop it, but say so - a silently discarded run is a
          // child's practice vanishing with no trace.
          onError('runQueue rejected', new Error(result.reason));
        }
        queue = queue.slice(1);
        persist();
        retryDelay = retryBaseMs;
      }
    } catch (error) {
      onError('runQueue drain', error);
      scheduleRetry();
    } finally {
      draining = false;
    }
  }

  const onOnline = () => {
    retryDelay = retryBaseMs;
    void drain();
  };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  // Anything left from a previous session goes out on boot. This is the payoff
  // for persisting first.
  void drain();

  return {
    submit(run: Omit<RunSubmission, 'idempotencyKey'>): void {
      if (remote === null || disposed) return;
      const submission: RunSubmission = { ...run, idempotencyKey: newKey() };
      queue = [...queue, submission];
      if (queue.length > maxQueued) {
        // At the ceiling, drop the OLDEST. Both directions lose practice
        // signal; losing the run just played is the more visible failure, and
        // a queue this deep means sync has been broken for a long time anyway.
        const dropped = queue.length - maxQueued;
        queue = queue.slice(dropped);
        onError('runQueue overflow', new Error(`dropped ${dropped} oldest queued run(s)`));
      }
      // PERSIST BEFORE SENDING. See the module comment.
      persist();
      void drain();
    },
    flush(): void {
      void drain();
    },
    rekey(key: string, carryPending: boolean): void {
      if (disposed || key === storageKey) return;
      // Whatever is in hand right now, including anything submitted before
      // identity resolved. Persisted under the OLD key first if it is staying
      // behind, so nothing is silently dropped by the switch.
      const carried = queue;
      if (!carryPending) persist();
      clearTimer();
      storageKey = key;
      // The new slot may already hold runs from a previous session, and those
      // come first - they have been waiting longer.
      queue = carryPending ? [...read(), ...carried] : read();
      retryDelay = retryBaseMs;
      persist();
      void drain();
    },
    pending(): number {
      return queue.length;
    },
    dispose(): void {
      disposed = true;
      clearTimer();
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    },
  };
}
