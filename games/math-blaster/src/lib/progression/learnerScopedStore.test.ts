import { createLearnerScopedStore } from './learnerScopedStore';
import { createLocalStorageStore, type StorageLike } from './localStorageStore';
import { CLAIM_MARKER_KEY } from '../identity/learnerScope';
import type { ProgressionCodec } from './ProgressionStore';
import type { IdentityResult, LearnerIdentitySource } from '../identity/LearnerIdentity';

/**
 * One slot per learner, on a device that may have several.
 *
 * Driven through the REAL localStorage store rather than a fake one, because
 * what is being tested is which key a write lands under - and a fake that
 * agreed with the implementation about keys would test nothing.
 */

interface State {
  coins: number;
}

const codec: ProgressionCodec<State> = {
  gameSlug: 'test',
  stateVersion: 1,
  empty: () => ({ coins: 0 }),
  parse: (raw) => ({ coins: typeof (raw as State)?.coins === 'number' ? (raw as State).coins : 0 }),
  merge: (a, b) => ({ coins: Math.max(a.coins, b.coins) }),
  furthest: (s) => s.coins,
};

const ANON = 'game.profile.v1';
const ADA = 'game.profile.v1.ada';
const BO = 'game.profile.v1.bo';

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage: StorageLike = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
  return { storage, at: (k: string) => (map.has(k) ? (JSON.parse(map.get(k)!) as State) : null), map };
}

function identityFor(result: IdentityResult): LearnerIdentitySource {
  return { resolve: () => Promise.resolve(result) };
}

function learner(id: string): LearnerIdentitySource {
  return identityFor({
    outcome: 'identified',
    identity: { learnerId: id, provider: 'vt', grade: null, pickedBy: 'primary' },
  });
}

function build(storage: StorageLike, identity: LearnerIdentitySource | null, scoped?: unknown[]) {
  return createLearnerScopedStore({
    // debounce 0 so a `put` reaches storage without a timer in the test.
    storeFor: (key) => createLocalStorageStore({ keyFor: () => key, storage, debounceMs: 0 }),
    anonymousKey: ANON,
    identity,
    storage,
    onScoped: (id, claimed) => void scoped?.push([id, claimed]),
  }).open(codec);
}

const settled = () => Promise.resolve().then(() => undefined);

describe('createLearnerScopedStore', () => {
  it('is a pass-through with no platform configured', () => {
    const { storage, at } = fakeStorage();
    const handle = build(storage, null);
    handle.put({ coins: 5 });
    handle.flush();
    expect(at(ANON)).toEqual({ coins: 5 });
  });

  it('carries the anonymous save over to the first learner to appear', async () => {
    const { storage, at } = fakeStorage({ [ANON]: JSON.stringify({ coins: 12 }) });
    const handle = build(storage, learner('ada'));
    await settled();

    expect(at(ADA)).toEqual({ coins: 12 });
    // Non-destructive: a guest coming back to the family tablet still finds
    // their game where they left it.
    expect(at(ANON)).toEqual({ coins: 12 });
    expect(handle.current).toEqual({ coins: 12 });
  });

  it("gives a second learner a fresh profile rather than a sibling's", async () => {
    const { storage, at } = fakeStorage({ [ANON]: JSON.stringify({ coins: 12 }) });

    const first = build(storage, learner('ada'));
    await settled();
    first.dispose();

    const second = build(storage, learner('bo'));
    await settled();

    // The whole reason the claim marker exists.
    expect(at(BO)).toBeNull();
    expect(second.current).toEqual({ coins: 0 });
    expect(at(ADA)).toEqual({ coins: 12 });
  });

  it('does not re-carry the anonymous save on a later boot', async () => {
    const { storage, at, map } = fakeStorage({ [ANON]: JSON.stringify({ coins: 12 }) });

    const first = build(storage, learner('ada'));
    await settled();
    first.put({ coins: 40 });
    first.flush();
    first.dispose();

    // Second boot. Re-carrying would overwrite the 40 with the stale 12.
    const again = build(storage, learner('ada'));
    await settled();
    expect(at(ADA)).toEqual({ coins: 40 });
    expect(again.current).toEqual({ coins: 40 });
    expect(map.get(CLAIM_MARKER_KEY)).toBe('ada');
  });

  it('writes to the learner slot once it has swapped, and announces the swap', async () => {
    const { storage, at } = fakeStorage();
    const seen: State[] = [];
    const handle = build(storage, learner('ada'));
    handle.onRemote((s) => void seen.push(s));
    await settled();

    handle.put({ coins: 9 });
    handle.flush();

    expect(at(ADA)).toEqual({ coins: 9 });
    // Nothing was ever written anonymously here, so that slot stays absent -
    // the write went to the learner's, which is the whole point.
    expect(at(ANON)).toBeNull();
    expect(seen.length).toBe(1);
  });

  it('stays on the anonymous slot for a player it cannot name', async () => {
    const { storage, at } = fakeStorage();
    const handle = build(storage, identityFor({ outcome: 'anonymous', reason: 'unauthenticated' }));
    await settled();

    handle.put({ coins: 3 });
    handle.flush();
    expect(at(ANON)).toEqual({ coins: 3 });
    expect(at(ADA)).toBeNull();
  });

  it('reports the learner and whether they claimed, exactly once', async () => {
    const { storage } = fakeStorage({ [ANON]: JSON.stringify({ coins: 1 }) });
    const first: unknown[] = [];
    build(storage, learner('ada'), first);
    await settled();
    expect(first).toEqual([['ada', true]]);

    const second: unknown[] = [];
    build(storage, learner('bo'), second);
    await settled();
    // `false` is what stops the run queue carrying Ada's banked runs to Bo.
    expect(second).toEqual([['bo', false]]);
  });

  it('is readable synchronously before identity resolves', () => {
    const { storage } = fakeStorage({ [ANON]: JSON.stringify({ coins: 6 }) });
    const handle = build(storage, learner('ada'));
    // Boot has no loading phase, and must not grow one.
    expect(handle.current).toEqual({ coins: 6 });
  });
});
