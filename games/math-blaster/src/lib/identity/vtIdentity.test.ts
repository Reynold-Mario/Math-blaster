import { createVtIdentity, LEARNER_PARAM } from './vtIdentity';
import type { IdentityResult } from './LearnerIdentity';

/**
 * The one file that talks to the platform.
 *
 * Three properties here are load-bearing and all three fail quietly:
 *  - it NEVER throws, because it sits on the boot path of a game that has to
 *    keep working when the platform does not;
 *  - it never returns a child's name, because the household payload carries
 *    them and we are not cleared to hold them;
 *  - an unvalidated `?learner=` is never believed, because that value decides
 *    whose permanent practice record a run lands in.
 */

const SESSION_URL = '/learner/api/auth/get-session';
const LEARNERS_URL = '/learner/api/learners';

type Reply = { status?: number; contentType?: string; body?: unknown } | Error;

function json(body: unknown): Reply {
  return { status: 200, contentType: 'application/json', body };
}

/** A `fetch` that answers from a table and counts what it was asked. */
function fakeFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const reply = replies[url];
    if (reply === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (reply.contentType ?? null) : null) },
      json: async () => reply.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const SIGNED_IN = json({ session: { id: 's1' }, user: { id: 'u1', email: 'parent@example.com' } });

function household(...learners: unknown[]): Reply {
  return json({ learners });
}

function resolveWith(replies: Record<string, Reply>, search = ''): Promise<IdentityResult> {
  return createVtIdentity({ base: '/learner', fetchImpl: fakeFetch(replies).impl, search }).resolve();
}

describe('createVtIdentity', () => {
  it('picks the learner named by the URL parameter', async () => {
    const result = await resolveWith(
      {
        [SESSION_URL]: SIGNED_IN,
        [LEARNERS_URL]: household(
          { id: 'a', name: 'Ada', grade: '1', isPrimary: true },
          { id: 'b', name: 'Bo', grade: '3', isPrimary: false },
        ),
      },
      `?${LEARNER_PARAM}=b`,
    );

    expect(result).toEqual({
      outcome: 'identified',
      identity: { learnerId: 'b', provider: 'vt', grade: '3', pickedBy: 'url-param' },
    });
  });

  it('falls back to the primary learner, then to the first', async () => {
    const primary = await resolveWith({
      [SESSION_URL]: SIGNED_IN,
      [LEARNERS_URL]: household(
        { id: 'a', name: 'Ada', grade: '1', isPrimary: false },
        { id: 'b', name: 'Bo', grade: '2', isPrimary: true },
      ),
    });
    expect(primary).toMatchObject({ identity: { learnerId: 'b', pickedBy: 'primary' } });

    const first = await resolveWith({
      [SESSION_URL]: SIGNED_IN,
      [LEARNERS_URL]: household({ id: 'a', name: 'Ada', grade: 'K', isPrimary: false }),
    });
    expect(first).toMatchObject({ identity: { learnerId: 'a', pickedBy: 'first' } });
  });

  it('ignores a URL parameter naming a learner outside the household', async () => {
    // Not an error, and not a refusal: the player is still a real learner in
    // this household, so play as the one we can actually vouch for.
    const result = await resolveWith(
      {
        [SESSION_URL]: SIGNED_IN,
        [LEARNERS_URL]: household({ id: 'a', name: 'Ada', grade: '1', isPrimary: true }),
      },
      `?${LEARNER_PARAM}=somebody-elses-child`,
    );
    expect(result).toMatchObject({ identity: { learnerId: 'a', pickedBy: 'primary' } });
  });

  it('refuses to trust the URL parameter when the household cannot be read', async () => {
    // "Cannot validate" must not take the same branch as "validated". Trusting
    // the parameter here would let a hand-edited URL choose whose record a run
    // is written to, on exactly the request that failed to check.
    const result = await resolveWith(
      { [SESSION_URL]: SIGNED_IN, [LEARNERS_URL]: { status: 503 } },
      `?${LEARNER_PARAM}=b`,
    );
    expect(result).toEqual({ outcome: 'anonymous', reason: 'unavailable' });
  });

  it('never returns anything beyond the four fields it declares', async () => {
    // The household payload carries children's names. Pinning the exact key
    // set is what stops a later edit smuggling one back in unnoticed.
    const result = await resolveWith({
      [SESSION_URL]: SIGNED_IN,
      [LEARNERS_URL]: household({ id: 'a', name: 'Ada', avatarId: 'fox', grade: '1', isPrimary: true }),
    });

    expect(result.outcome).toBe('identified');
    if (result.outcome !== 'identified') return;
    expect(Object.keys(result.identity).sort()).toEqual(['grade', 'learnerId', 'pickedBy', 'provider']);
    expect(JSON.stringify(result)).not.toContain('Ada');
  });

  it('reports unauthenticated for a rejected read and for a signed-out session', async () => {
    await expect(resolveWith({ [SESSION_URL]: { status: 401 }, [LEARNERS_URL]: { status: 401 } })).resolves.toEqual({
      outcome: 'anonymous',
      reason: 'unauthenticated',
    });

    // Better Auth answers 200 with nulls for a signed-out visitor, so the
    // status alone does not settle it.
    await expect(
      resolveWith({ [SESSION_URL]: json({ session: null, user: null }), [LEARNERS_URL]: household() }),
    ).resolves.toEqual({ outcome: 'anonymous', reason: 'unauthenticated' });
  });

  it('treats a 200 that is not JSON as unavailable', async () => {
    // A standalone build configured with a base but served without the
    // platform behind it answers with its OWN index.html and a 200. That is a
    // misconfiguration, and it must not read as a signed-out player.
    const result = await resolveWith({
      [SESSION_URL]: { status: 200, contentType: 'text/html', body: '<!doctype html>' },
      [LEARNERS_URL]: { status: 200, contentType: 'text/html', body: '<!doctype html>' },
    });
    expect(result).toEqual({ outcome: 'anonymous', reason: 'unavailable' });
  });

  it('never throws, whatever the network does', async () => {
    const result = await resolveWith({
      [SESSION_URL]: new Error('offline'),
      [LEARNERS_URL]: new Error('offline'),
    });
    expect(result).toEqual({ outcome: 'anonymous', reason: 'unavailable' });
  });

  it('reports no-learners for an empty household', async () => {
    await expect(resolveWith({ [SESSION_URL]: SIGNED_IN, [LEARNERS_URL]: household() })).resolves.toEqual({
      outcome: 'anonymous',
      reason: 'no-learners',
    });
  });

  it('drops a grade outside the platform vocabulary rather than passing it on', async () => {
    // The mapping onto the game's grades happens downstream; letting an
    // unrecognised string travel would just move the decision somewhere with
    // less context to make it.
    const result = await resolveWith({
      [SESSION_URL]: SIGNED_IN,
      [LEARNERS_URL]: household({ id: 'a', name: 'Ada', grade: 'year 4', isPrimary: true }),
    });
    expect(result).toMatchObject({ identity: { grade: null } });
  });

  it('resolves once, however many callers ask', async () => {
    const fetcher = fakeFetch({
      [SESSION_URL]: SIGNED_IN,
      [LEARNERS_URL]: household({ id: 'a', name: 'Ada', grade: '1', isPrimary: true }),
    });
    const source = createVtIdentity({ base: '/learner', fetchImpl: fetcher.impl, search: '' });

    const [first, second] = await Promise.all([source.resolve(), source.resolve()]);
    await source.resolve();

    expect(first).toBe(second);
    expect(fetcher.calls).toEqual([SESSION_URL, LEARNERS_URL]);
  });

  it('makes no request at all when the environment has no fetch', async () => {
    // The gate that matters is a build with no platform configured, which
    // `vtIdentityClient` answers before this module is ever constructed. This
    // pins the backstop: no fetch, no requests, and still an ordinary answer.
    const realFetch = globalThis.fetch;
    // @ts-expect-error - deleting a global for the duration of one assertion.
    delete globalThis.fetch;
    try {
      const source = createVtIdentity({ base: '/learner', search: '' });
      await expect(source.resolve()).resolves.toEqual({ outcome: 'anonymous', reason: 'not-configured' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
