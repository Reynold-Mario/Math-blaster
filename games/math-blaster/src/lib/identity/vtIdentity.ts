import { anonymous, type IdentityResult, type LearnerIdentity, type LearnerIdentitySource } from './LearnerIdentity';

/**
 * THE ONLY FILE THAT KNOWS VARSITY TUTORS EXISTS.
 *
 * Two reads against the student experience, which is the authenticated shell
 * the player is already inside when they launch this game from its catalog:
 *
 *   GET {base}/api/auth/get-session   ->  is anybody signed in
 *   GET {base}/api/learners           ->  which children, and their grades
 *
 * **The credentials are cookies we cannot see and cannot forward.** Both are
 * `httpOnly` and both are `SameSite=Lax`, so they ride along on a SAME-ORIGIN
 * request and on nothing else: a cross-origin `fetch` sends no cookie at all,
 * and no amount of CORS changes that. Which is why `base` below is typed as a
 * PATH and never an origin - the only configuration that can work is the only
 * one this module lets you express. In development the same shape is arranged
 * with a dev-server proxy; in production it is the router mapping both paths
 * onto one host.
 *
 * Nothing here reads `import.meta.env`. That gate lives in `vtIdentityClient.ts`
 * so this file stays reachable from a `.test.ts` (`tsconfig.jest.json` compiles
 * to commonjs, where `import.meta` is a compile error).
 */

/** The platform's grade vocabulary. Wider than the game's on purpose - see
 * `LearnerIdentity.grade`. Kept here because it describes THEIR payload; what
 * the game does about it belongs to `levels/`. */
const PLATFORM_GRADES: readonly string[] = [
  'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'college', 'adult',
];

const DEFAULT_TIMEOUT_MS = 4000;

/** The query parameter the catalog appends so a household with several
 * children launches into the right one. User-editable, therefore validated
 * against the household before it is believed - see `pickLearner`. */
export const LEARNER_PARAM = 'learner';

export interface VtIdentityOptions {
  /**
   * Same-origin path prefix the student experience is mounted at, e.g.
   * `'/learner'`. **A path, never an origin** - see the note above.
   */
  base: string;
  /** Injected so tests need neither a network nor a DOM. */
  fetchImpl?: typeof fetch;
  /** `location.search`, injected for the same reason. */
  search?: string;
  timeoutMs?: number;
  /**
   * Diagnostics. Receives a `where` string and the error, and NEVER a response
   * body - `Game.svelte` prints this in dev builds, and the bodies involved
   * carry children's names.
   */
  onError?(where: string, error: unknown): void;
}

/** The two fields we keep off a household row. Everything else the platform
 * sends - name, avatar - is dropped where the response is parsed, so it never
 * reaches an object anything downstream can read. */
interface HouseholdLearner {
  id: string;
  grade: string | null;
  isPrimary: boolean;
}

function readSearchParam(search: string, key: string): string | null {
  try {
    return new URLSearchParams(search).get(key);
  } catch {
    return null;
  }
}

/**
 * A JSON read that treats "a 200 that is not JSON" as a failure.
 *
 * This is not defensive padding. A standalone build of this game, configured
 * with a base but served without the platform behind it, answers
 * `/learner/api/auth/get-session` with its OWN `index.html` and a 200 - and a
 * bare `res.json()` would throw on the HTML, or worse, some future server
 * would return a shape that parses. Checking the content type turns a
 * misconfiguration into `unavailable` rather than into a puzzle.
 */
async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const res = await fetchImpl(url, {
    method: 'GET',
    // The whole point. Without it the cookies are not sent even same-origin
    // for a cross-site-initiated navigation, and the platform sees a stranger.
    credentials: 'include',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!res.ok) return { ok: false, status: res.status };
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return { ok: false, status: res.status };
  return { ok: true, body: (await res.json()) as unknown };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Better Auth answers 200 with `null` for a signed-out visitor, so the status
 * alone does not settle it. We read the session for its EXISTENCE and nothing
 * else: the user object it carries has an email on it. */
function isSignedIn(body: unknown): boolean {
  const root = asRecord(body);
  if (root === null) return false;
  return asRecord(root.session) !== null && asRecord(root.user) !== null;
}

/**
 * Keep three fields, discard the rest. `name` and `avatarId` are dropped HERE,
 * at the boundary, rather than merely left unused - an unused field is one
 * refactor away from being a used one.
 */
function parseHousehold(body: unknown): HouseholdLearner[] | null {
  const root = asRecord(body);
  const rows = root === null ? null : root.learners;
  if (!Array.isArray(rows)) return null;
  const parsed: HouseholdLearner[] = [];
  for (const row of rows) {
    const entry = asRecord(row);
    if (entry === null || typeof entry.id !== 'string' || entry.id === '') continue;
    parsed.push({
      id: entry.id,
      grade: typeof entry.grade === 'string' && PLATFORM_GRADES.includes(entry.grade) ? entry.grade : null,
      isPrimary: entry.isPrimary === true,
    });
  }
  return parsed;
}

/**
 * Which child is playing.
 *
 * The URL parameter wins, but ONLY once it has been found in this household.
 * It is user-editable and it decides whose permanent practice record a run
 * lands in, so an unrecognised value is ignored rather than trusted - and if
 * the household could not be read at all, the caller gives up instead, because
 * "cannot validate" and "validated" must never take the same branch.
 */
function pickLearner(household: HouseholdLearner[], hint: string | null): LearnerIdentity | null {
  const requested = hint === null ? undefined : household.find((l) => l.id === hint);
  const chosen = requested ?? household.find((l) => l.isPrimary) ?? household[0];
  if (chosen === undefined) return null;
  return {
    learnerId: chosen.id,
    provider: 'vt',
    grade: chosen.grade,
    pickedBy: requested !== undefined ? 'url-param' : chosen.isPrimary ? 'primary' : 'first',
  };
}

export function createVtIdentity(options: VtIdentityOptions): LearnerIdentitySource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const search = options.search ?? (typeof location === 'undefined' ? '' : location.search);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onError = options.onError ?? (() => {});
  const base = options.base.replace(/\/+$/, '');

  // Memoized, not cached-with-a-ttl: one answer per boot. There is no retry
  // loop either - the next launch is the retry, and a game that keeps polling
  // an unreachable platform while a child is playing has its priorities wrong.
  let pending: Promise<IdentityResult> | null = null;

  async function load(): Promise<IdentityResult> {
    if (typeof fetchImpl !== 'function') return anonymous('not-configured');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Neither read depends on the other: one answers "signed in?", the other
      // supplies the child and the grade. Sequential would double boot latency
      // for nothing.
      const [session, household] = await Promise.all([
        readJson(fetchImpl, `${base}/api/auth/get-session`, controller.signal),
        readJson(fetchImpl, `${base}/api/learners`, controller.signal),
      ]);

      if (!session.ok) return anonymous(session.status === 401 || session.status === 403 ? 'unauthenticated' : 'unavailable');
      if (!isSignedIn(session.body)) return anonymous('unauthenticated');
      if (!household.ok) return anonymous(household.status === 401 || household.status === 403 ? 'unauthenticated' : 'unavailable');

      const rows = parseHousehold(household.body);
      if (rows === null) return anonymous('unavailable');

      const identity = pickLearner(rows, readSearchParam(search, LEARNER_PARAM));
      return identity === null ? anonymous('no-learners') : { outcome: 'identified', identity };
    } catch (error) {
      // Offline, aborted, blocked, malformed JSON - one answer for all of
      // them, because the game's response to every one is identical.
      onError('vtIdentity', error);
      return anonymous('unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    resolve(): Promise<IdentityResult> {
      pending ??= load();
      return pending;
    },
  };
}
