import { createSupabaseProgressionStore } from './supabaseStore';
import { createLocalStorageStore, type StorageLike } from './localStorageStore';
import type { ProgressionCodec } from './ProgressionStore';
import type {
  RemoteProgression,
  RemoteSnapshot,
  RemoteWrite,
  RemoteWriteResult,
} from './RemoteProgression';

/**
 * The networked store, tested against the PORT rather than against Supabase.
 *
 * `testEnvironment` stays node and nothing here imports `@supabase/*`: the
 * store only ever talks to `RemoteProgression`, so a fake implementation covers
 * every branch including the ones that are awkward to reach for real (a
 * conflicting writer, a dropped connection, a signed-out player).
 *
 * The cache is the REAL localStorage store with injected storage, because the
 * composition is the thing under test - "boot stays synchronous" is only
 * meaningful if the actual cache is the one providing it.
 */

interface Counter {
  n: number;
  label: string;
  grade: string;
}

const codec: ProgressionCodec<Counter> = {
  gameSlug: 'test-game',
  stateVersion: 3,
  empty: () => ({ n: 0, label: '', grade: 'K' }),
  parse: (raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      n: typeof r.n === 'number' && Number.isFinite(r.n) ? r.n : 0,
      label: typeof r.label === 'string' ? r.label : '',
      grade: typeof r.grade === 'string' ? r.grade : 'K',
    };
  },
  // `n` is the monotone record; `label` and `grade` are preferences, so they
  // follow the hint. Same split the real profile codec has.
  //
  // NOTE THE KEY ORDER: `parse` above emits n/label/grade, this emits
  // grade/label/n. That mismatch is deliberate and mirrors the real codec,
  // whose `parse` opens with `currency` and whose `merge` opens with
  // `earnedTotal`. An earlier version of this file emitted the same order from
  // both, which let a `JSON.stringify` comparison in the store look correct
  // while pushing a redundant write on every boot in production.
  merge: (a, b, hint) => ({
    grade: hint === 'a-is-newer' ? a.grade : b.grade,
    label: hint === 'a-is-newer' ? a.label : b.label,
    n: Math.max(a.n, b.n),
  }),
  furthest: (s) => s.n,
  applyPlatformGrade: (s, grade) => ({ ...s, grade }),
};

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage: StorageLike = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
  return { storage, read: (k: string) => map.get(k) ?? null };
}

function snapshotOf(state: Counter, revision: number, over: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return {
    state,
    stateVersion: 3,
    revision,
    furthest: state.n,
    gradeLevel: null,
    gradeSource: null,
    ...over,
  };
}

function fakeRemote(initial: RemoteSnapshot | null = null) {
  let profileId: string | null = 'profile-1';
  let snapshot = initial;
  const writes: RemoteWrite[] = [];
  const forced: { result: RemoteWriteResult; after?: RemoteSnapshot | null }[] = [];
  let reads = 0;

  const remote: RemoteProgression = {
    currentProfileId: async () => profileId,
    read: async () => {
      reads += 1;
      return snapshot;
    },
    write: async (input) => {
      writes.push(input);
      const next = forced.shift();
      if (next !== undefined) {
        // Simulate whatever the other writer did, so the store's re-read sees
        // a row that has genuinely moved on.
        if (next.after !== undefined) snapshot = next.after;
        return next.result;
      }
      const revision = (snapshot?.revision ?? 0) + 1;
      snapshot = {
        state: input.state,
        stateVersion: input.stateVersion,
        revision,
        furthest: input.furthest,
        gradeLevel: snapshot?.gradeLevel ?? null,
        gradeSource: snapshot?.gradeSource ?? null,
      };
      return { outcome: 'written', revision };
    },
    // Not exercised here - the store never submits runs, `runQueue` does.
    submitRun: async () => ({ outcome: 'submitted' as const }),
  };

  return {
    remote,
    writes,
    get reads() {
      return reads;
    },
    get snapshot() {
      return snapshot;
    },
    signOut: () => void (profileId = null),
    forceNext: (result: RemoteWriteResult, after?: RemoteSnapshot | null) =>
      void forced.push({ result, after }),
  };
}

/** Drain the microtask queue. The store awaits two calls before it does
 * anything observable, and fake timers do not advance promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

function open(
  remote: RemoteProgression | null,
  seed: Record<string, string> = {},
  onError?: (where: string, error: unknown) => void
) {
  const fs = fakeStorage(seed);
  const store = createSupabaseProgressionStore({
    cache: createLocalStorageStore({ storage: fs.storage, keyFor: () => 'k' }),
    remote,
    onError,
  });
  return { handle: store.open(codec), storage: fs };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createSupabaseProgressionStore', () => {
  it('resolves current synchronously, before any fetch has finished', () => {
    const r = fakeRemote(snapshotOf({ n: 99, label: 'remote', grade: 'K' }, 4));
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 7, label: 'local', grade: 'K' }) });

    // No await anywhere above. This is the boot path, and it must not wait.
    expect(handle.current).toEqual({ n: 7, label: 'local', grade: 'K' });
    expect(r.writes).toHaveLength(0);
  });

  it('is a transparent pass-through with no remote configured', async () => {
    const { handle, storage } = open(null, {});

    handle.put({ n: 3, label: 'x', grade: 'K' });
    await advance(2000);

    expect(JSON.parse(storage.read('k') ?? '{}')).toEqual({ n: 3, label: 'x', grade: 'K' });
  });

  it('merges the remote row into local state and delivers it through onRemote', async () => {
    const r = fakeRemote(snapshotOf({ n: 42, label: 'remote', grade: 'K' }, 4));
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 7, label: 'local', grade: 'K' }) });

    const seen: Counter[] = [];
    handle.onRemote((m) => void seen.push(m));
    await settle();

    // `n` is monotone so the higher wins; `label` follows the hint, and with
    // grade_source null the local pick stays authoritative.
    expect(seen).toEqual([{ n: 42, label: 'local', grade: 'K' }]);
  });

  it('replays the merge to a listener that subscribed after the fetch resolved', async () => {
    const r = fakeRemote(snapshotOf({ n: 42, label: 'remote', grade: 'K' }, 4));
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 1, label: 'local', grade: 'K' }) });

    // Let the boot sync finish with nobody listening at all - Game.svelte
    // constructs the store during init and subscribes in onMount, so this is
    // the ordering that actually happens on a fast connection.
    await settle();

    const seen: Counter[] = [];
    handle.onRemote((m) => void seen.push(m));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.n).toBe(42);
  });

  it('seeds the row from local state when this profile has never played', async () => {
    const r = fakeRemote(null);
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 12, label: 'local', grade: 'K' }) });
    void handle;

    await settle();
    await advance(5000);

    expect(r.writes).toHaveLength(1);
    // `null` is what tells the adapter to insert rather than update.
    expect(r.writes[0]?.expectedRevision).toBeNull();
    expect(r.writes[0]?.state).toEqual({ n: 12, label: 'local', grade: 'K' });
    expect(r.writes[0]?.furthest).toBe(12);
    expect(r.writes[0]?.stateVersion).toBe(3);
  });

  it('debounces pushes rather than sending one per put', async () => {
    const r = fakeRemote(snapshotOf({ n: 0, label: '', grade: 'K' }, 1));
    const { handle } = open(r.remote, {});
    await settle();

    for (let n = 1; n <= 40; n += 1) {
      handle.put({ n, label: 'x', grade: 'K' });
      await advance(100);
    }
    await advance(5000);

    // 40 puts across 4s of run time. One write, carrying the latest state -
    // this is the whole reason the debounce is in the seam and not at the
    // call sites.
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]?.state).toEqual({ n: 40, label: 'x', grade: 'K' });
  });

  it('never sits on a change past the max wait, however busy the run is', async () => {
    const r = fakeRemote(snapshotOf({ n: 0, label: '', grade: 'K' }, 1));
    const { handle } = open(r.remote, {});
    await settle();

    // A run that never goes quiet for the trailing window. Without the
    // deadline this would never write at all, and a busy run is exactly the
    // one worth saving.
    for (let n = 1; n <= 100; n += 1) {
      handle.put({ n, label: 'x', grade: 'K' });
      await advance(1000);
    }

    expect(r.writes.length).toBeGreaterThanOrEqual(3);
  });

  it('carries the revision it read, and re-merges instead of clobbering on conflict', async () => {
    const r = fakeRemote(snapshotOf({ n: 5, label: 'remote', grade: 'K' }, 7));
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 5, label: 'local', grade: 'K' }) });
    await settle();

    // Somebody else got there first and pushed the row to revision 9.
    r.forceNext({ outcome: 'conflict' }, snapshotOf({ n: 31, label: 'other', grade: 'K' }, 9));

    const seen: Counter[] = [];
    handle.onRemote((m) => void seen.push(m));
    handle.put({ n: 20, label: 'mine', grade: 'K' });
    await advance(5000);

    expect(r.writes[0]?.expectedRevision).toBe(7);

    // The other writer's 31 survives, and so does the local label: the local
    // side is the one holding unpushed work, so it is the newer writer.
    const merged = seen[seen.length - 1];
    expect(merged).toEqual({ n: 31, label: 'mine', grade: 'K' });

    // Retry carries the NEW revision and the merged payload - never the
    // payload that just conflicted.
    await advance(2000);
    expect(r.writes).toHaveLength(2);
    expect(r.writes[1]?.expectedRevision).toBe(9);
    expect(r.writes[1]?.state).toEqual({ n: 31, label: 'mine', grade: 'K' });
  });

  it('retries the same payload when the write is unavailable', async () => {
    const r = fakeRemote(snapshotOf({ n: 1, label: '', grade: 'K' }, 2));
    const { handle } = open(r.remote, {});
    await settle();

    r.forceNext({ outcome: 'unavailable' });
    handle.put({ n: 9, label: 'x', grade: 'K' });
    await advance(5000);
    expect(r.writes).toHaveLength(1);

    // Backoff starts at 2s. Same payload, no re-merge: nothing on the server
    // changed, so there is nothing to reconcile.
    await advance(2000);
    expect(r.writes).toHaveLength(2);
    expect(r.writes[1]?.state).toEqual({ n: 9, label: 'x', grade: 'K' });
  });

  it('backs off rather than retrying at a fixed interval', async () => {
    const r = fakeRemote(snapshotOf({ n: 1, label: '', grade: 'K' }, 2));
    const { handle } = open(r.remote, {});
    await settle();

    for (let i = 0; i < 4; i += 1) r.forceNext({ outcome: 'unavailable' });
    handle.put({ n: 9, label: 'x', grade: 'K' });
    await advance(5000);
    expect(r.writes).toHaveLength(1);

    await advance(2000);
    expect(r.writes).toHaveLength(2);
    // Doubling, so 2s does not produce another attempt - 4s does.
    await advance(2000);
    expect(r.writes).toHaveLength(2);
    await advance(2000);
    expect(r.writes).toHaveLength(3);
  });

  it('does not attempt a write while signed out, and schedules no retry', async () => {
    const r = fakeRemote(null);
    r.signOut();
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 4, label: 'local', grade: 'K' }) });
    await settle();

    handle.put({ n: 5, label: 'local', grade: 'K' });
    await advance(60000);

    // A signed-out player is the default state, not a failure. Nothing is
    // sent, nothing retries, and the local game is unaffected.
    expect(r.writes).toHaveLength(0);
    expect(handle.current).toEqual({ n: 5, label: 'local', grade: 'K' });
  });

  it('lets a platform grade overrule the local picker', async () => {
    const r = fakeRemote(
      snapshotOf({ n: 1, label: 'remote', grade: 'K' }, 3, {
        gradeLevel: '3',
        gradeSource: 'platform',
      })
    );
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 1, label: 'local', grade: '1' }) });

    const seen: Counter[] = [];
    handle.onRemote((m) => void seen.push(m));
    await settle();

    expect(seen[0]?.grade).toBe('3');
  });

  it('leaves the local grade alone when the platform has no opinion', async () => {
    const r = fakeRemote(
      snapshotOf({ n: 1, label: 'remote', grade: 'K' }, 3, {
        gradeLevel: 'K',
        gradeSource: 'self',
      })
    );
    const { handle } = open(r.remote, { k: JSON.stringify({ n: 1, label: 'local', grade: '1' }) });

    const seen: Counter[] = [];
    handle.onRemote((m) => void seen.push(m));
    await settle();

    // grade_source 'self' means the local pick IS the record. Overwriting it
    // would silently move a child to a grade they did not choose.
    expect(seen[0]?.grade).toBe('1');
  });

  it('does not push when the merge matches what the server already had', async () => {
    const same = { n: 5, label: 'same', grade: 'K' };
    const r = fakeRemote(snapshotOf(same, 3));
    const { handle } = open(r.remote, { k: JSON.stringify(same) });
    void handle;

    await settle();
    await advance(60000);

    // Re-sending an identical payload would burn a request and a revision
    // bump for nothing.
    //
    // THIS IS THE REGRESSION TEST FOR A BUG THAT SHIPPED PAST THE FIRST
    // VERSION OF IT. The store compared with JSON.stringify, the codec emits
    // its keys in a different order from `parse` (see the note on `merge`
    // above), so the strings never matched and every signed-in player pushed
    // on every boot - observed as `revision` 5 -> 6 with byte-identical state.
    // The comparison must be by value.
    expect(r.writes).toHaveLength(0);
  });

  it('treats a state that differs only in key order as unchanged', async () => {
    // The narrow property, stated on its own so it cannot be lost while
    // refactoring the test above.
    const stored = { n: 5, label: 'same', grade: 'K' };
    const reordered = { grade: 'K', label: 'same', n: 5 } as typeof stored;
    const r = fakeRemote(snapshotOf(reordered, 3));
    const { handle } = open(r.remote, { k: JSON.stringify(stored) });
    void handle;

    await settle();
    await advance(60000);

    expect(r.writes).toHaveLength(0);
  });

  it('writes nothing after dispose', async () => {
    const r = fakeRemote(snapshotOf({ n: 1, label: '', grade: 'K' }, 2));
    const { handle } = open(r.remote, {});
    await settle();

    handle.put({ n: 8, label: 'x', grade: 'K' });
    handle.dispose();
    await advance(60000);

    expect(r.writes).toHaveLength(0);
  });

  it('reports a listener that throws without stopping the others', async () => {
    const r = fakeRemote(snapshotOf({ n: 9, label: 'remote', grade: 'K' }, 2));
    const errors: string[] = [];
    const { handle } = open(r.remote, {}, (where) => void errors.push(where));

    handle.onRemote(() => {
      throw new Error('bad subscriber');
    });
    const seen: Counter[] = [];
    handle.onRemote((m) => void seen.push(m));
    await settle();

    expect(errors).toContain('onRemote listener');
    expect(seen).toHaveLength(1);
  });
});
