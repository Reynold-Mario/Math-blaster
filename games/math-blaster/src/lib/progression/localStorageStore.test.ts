import { createLocalStorageStore, type StorageLike } from './localStorageStore';
import type { ProgressionCodec } from './ProgressionStore';

/**
 * The half that used to live inside `PlayerProfile.ts`: the key, JSON in
 * both directions, and the try/catches. Plus the debounce, which is the
 * actual reason this indirection exists - the game saves once per kill,
 * which is free against localStorage and fatal against a network.
 *
 * `testEnvironment` stays node. Storage is injected rather than stubbed
 * onto a global, so nothing here needs jsdom or a `window`.
 */

interface Counter {
  n: number;
  label: string;
}

const codec: ProgressionCodec<Counter> = {
  gameSlug: 'test-game',
  stateVersion: 1,
  empty: () => ({ n: 0, label: '' }),
  parse: (raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      n: typeof r.n === 'number' && Number.isFinite(r.n) ? r.n : 0,
      label: typeof r.label === 'string' ? r.label : '',
    };
  },
  merge: (a, b, hint) => ({ n: Math.max(a.n, b.n), label: hint === 'a-is-newer' ? a.label : b.label }),
  furthest: (s) => s.n,
};

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  let writes = 0;
  const storage: StorageLike = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      writes += 1;
      map.set(k, v);
    },
  };
  return { storage, map, writes: () => writes };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('reading at boot', () => {
  it('is synchronous - the state is there the instant the handle is', () => {
    // This is the whole reason there is no loading phase and no `0 banked`
    // flash on the boot screen.
    const { storage } = fakeStorage({ 'test-game.progress.v1': JSON.stringify({ n: 12, label: 'hi' }) });
    const handle = createLocalStorageStore({ storage }).open(codec);
    expect(handle.current).toEqual({ n: 12, label: 'hi' });
  });

  it('falls back to empty on unparseable JSON', () => {
    const { storage } = fakeStorage({ 'test-game.progress.v1': '{not json' });
    expect(createLocalStorageStore({ storage }).open(codec).current).toEqual({ n: 0, label: '' });
  });

  it('falls back to empty when there is no storage at all', () => {
    // Private-mode Safari, a disabled-storage browser, or a build script.
    expect(createLocalStorageStore({ storage: null }).open(codec).current).toEqual({ n: 0, label: '' });
  });

  it('survives storage that throws on read', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(createLocalStorageStore({ storage }).open(codec).current).toEqual({ n: 0, label: '' });
  });

  it('uses the key the caller asked for, not a derived one', () => {
    // Math Blaster's key predates the namespacing convention and must not
    // move, or every current player loses their currency and skills.
    const { storage, map } = fakeStorage({ legacy: JSON.stringify({ n: 5, label: 'old' }) });
    const handle = createLocalStorageStore({ storage, keyFor: () => 'legacy' }).open(codec);
    expect(handle.current.n).toBe(5);
    handle.put({ n: 6, label: 'old' });
    handle.flush();
    expect(map.has('legacy')).toBe(true);
    expect(map.has('test-game.progress.v1')).toBe(false);
  });
});

describe('debouncing writes', () => {
  it('collapses a burst into one write', () => {
    // The shape of a real wave: one put per kill.
    const { storage, writes } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);

    for (let i = 1; i <= 50; i++) {
      handle.put({ n: i, label: '' });
      jest.advanceTimersByTime(100);
    }
    expect(writes()).toBe(0);

    jest.advanceTimersByTime(2000);
    expect(writes()).toBe(1);
  });

  it('reads back the last value in the burst, not the first', () => {
    const { storage, map } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);
    handle.put({ n: 1, label: 'a' });
    handle.put({ n: 2, label: 'b' });
    jest.advanceTimersByTime(5000);
    expect(JSON.parse(map.get('test-game.progress.v1')!)).toEqual({ n: 2, label: 'b' });
  });

  it('writes anyway once the maximum wait elapses', () => {
    // Without the deadline, a run that never goes quiet for two seconds
    // would never write at all - which is exactly a busy run.
    const { storage, writes } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);

    for (let i = 0; i < 100; i++) {
      handle.put({ n: i, label: '' });
      jest.advanceTimersByTime(1000);
    }
    // 100 seconds of never being quiet for 2s: bounded by the 15s deadline,
    // so this is several writes but nothing like one per put.
    expect(writes()).toBeGreaterThan(1);
    expect(writes()).toBeLessThan(20);
  });

  it('keeps `current` ahead of what has been persisted', () => {
    // The in-memory copy is the truth during a run; persistence catches up.
    const { storage, writes } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);
    handle.put({ n: 99, label: 'now' });
    expect(handle.current).toEqual({ n: 99, label: 'now' });
    expect(writes()).toBe(0);
  });
});

describe('flushing', () => {
  it('writes immediately', () => {
    const { storage, writes } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);
    handle.put({ n: 7, label: '' });
    handle.flush();
    expect(writes()).toBe(1);
  });

  it('is a no-op when nothing is pending', () => {
    // Otherwise every safe-moment flush costs a redundant write.
    const { storage, writes } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);
    handle.put({ n: 7, label: '' });
    handle.flush();
    handle.flush();
    handle.flush();
    expect(writes()).toBe(1);
  });

  it('cancels the pending timer rather than writing twice', () => {
    const { storage, writes } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);
    handle.put({ n: 7, label: '' });
    handle.flush();
    jest.advanceTimersByTime(60000);
    expect(writes()).toBe(1);
  });

  it('happens on dispose, so a pending change is not lost', () => {
    const { storage, map } = fakeStorage();
    const handle = createLocalStorageStore({ storage }).open(codec);
    handle.put({ n: 3, label: 'pending' });
    handle.dispose();
    expect(JSON.parse(map.get('test-game.progress.v1')!)).toEqual({ n: 3, label: 'pending' });
  });
});

describe('failing to write', () => {
  it('does not throw when storage is full', () => {
    // Losing a save is not worth losing the wave the player is in.
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const handle = createLocalStorageStore({ storage }).open(codec);
    handle.put({ n: 1, label: '' });
    expect(() => handle.flush()).not.toThrow();
    expect(handle.current.n).toBe(1);
  });
});
