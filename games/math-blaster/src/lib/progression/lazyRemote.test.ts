import { createLazyRemote } from './lazyRemote';
import type { RemoteProgression, RemoteWrite } from './RemoteProgression';

/**
 * The deferral wrapper. Small, but two of its four properties are the kind that
 * only show up as "sync silently stopped working" months later, so they are
 * pinned here.
 */

function stubRemote(): { remote: RemoteProgression; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    remote: {
      currentProfileId: async () => {
        calls.push('currentProfileId');
        return 'profile-1';
      },
      read: async (slug) => {
        calls.push(`read:${slug}`);
        return null;
      },
      write: async (input: RemoteWrite) => {
        calls.push(`write:${input.gameSlug}`);
        return { outcome: 'written' as const, revision: 1 };
      },
      submitRun: async (run) => {
        calls.push(`submitRun:${run.idempotencyKey}`);
        return { outcome: 'submitted' as const };
      },
    },
  };
}

describe('createLazyRemote', () => {
  it('loads nothing until something actually asks a question', () => {
    let loads = 0;
    createLazyRemote(async () => {
      loads += 1;
      return stubRemote().remote;
    });

    // Constructing the wrapper must not pull the chunk in. This is the whole
    // reason it exists.
    expect(loads).toBe(0);
  });

  it('loads once and delegates every method', async () => {
    let loads = 0;
    const stub = stubRemote();
    const lazy = createLazyRemote(async () => {
      loads += 1;
      return stub.remote;
    });

    expect(await lazy.currentProfileId()).toBe('profile-1');
    expect(await lazy.read('test-game')).toBeNull();
    expect(
      await lazy.write({
        gameSlug: 'test-game',
        state: {},
        stateVersion: 1,
        furthest: 1,
        expectedRevision: null,
      })
    ).toEqual({ outcome: 'written', revision: 1 });

    expect(loads).toBe(1);
    expect(stub.calls).toEqual(['currentProfileId', 'read:test-game', 'write:test-game']);
  });

  it('shares one load between calls that arrive together', async () => {
    let loads = 0;
    const stub = stubRemote();
    const lazy = createLazyRemote(async () => {
      loads += 1;
      return stub.remote;
    });

    // The promise is memoized, not the resolved value - otherwise the store's
    // boot read and its first push would each pull the chunk.
    await Promise.all([lazy.currentProfileId(), lazy.read('a'), lazy.read('b')]);

    expect(loads).toBe(1);
  });

  it('does NOT memoize a failed load, so a later call retries', async () => {
    let loads = 0;
    const stub = stubRemote();
    const lazy = createLazyRemote(async () => {
      loads += 1;
      // Fail the first attempt only, the way a chunk fetch fails when the
      // player booted offline.
      if (loads === 1) throw new Error('offline');
      return stub.remote;
    });

    await expect(lazy.currentProfileId()).rejects.toThrow('offline');

    // Caching the rejected promise here would turn one bad moment into a
    // permanently local session - the store retries with backoff, and this is
    // what lets that retry mean something.
    expect(await lazy.currentProfileId()).toBe('profile-1');
    expect(loads).toBe(2);
  });

  it('surfaces the load failure rather than swallowing it', async () => {
    const lazy = createLazyRemote(async () => {
      throw new Error('chunk 404');
    });

    // The store maps a thrown error to onError plus a retry. Returning a
    // null-ish result instead would look like "signed out" and stop the retry.
    await expect(lazy.read('test-game')).rejects.toThrow('chunk 404');
  });
});
