/**
 * WHO IS PLAYING, as a PORT rather than a client.
 *
 * The same split `RemoteProgression.ts` makes: this file is types only - no
 * `fetch`, no DOM, no `import.meta.env` - so anything built on it stays
 * unit-testable under `testEnvironment: node`. `vtIdentity.ts` is the only
 * implementation that knows Varsity Tutors exists, and the only file in the
 * codebase where `/learner/api/*` appears.
 *
 * The game is fully playable without any of this. An anonymous answer is the
 * ORDINARY case - a player who opened the game directly, a build with no
 * platform configured, a household that has not signed in - and every one of
 * them must land on exactly the game that shipped before identity existed.
 */

/** Only one today. Named so the database's `profile_identities.provider`
 * column and this type say the same word. */
export type IdentityProvider = 'vt';

/**
 * The resolved player.
 *
 * Every field here is opaque or already the game's own business. **There is no
 * `name` field, and there must not become one.** The platform's household
 * payload carries children's names, and until the minors question in
 * `ROADMAP.md` is answered we store no personally identifying information -
 * so names are dropped at the parse boundary in `vtIdentity.ts` and this type
 * deliberately offers nowhere to put one.
 */
export interface LearnerIdentity {
  /**
   * The platform's learner id. Opaque, stable, and per-CHILD rather than per
   * household account - which is the whole point: two siblings on one tablet
   * are two players, not one.
   */
  readonly learnerId: string;
  readonly provider: IdentityProvider;
  /**
   * The platform's grade, UNVALIDATED and in the PLATFORM's vocabulary
   * (`'K' | '1'..'12' | 'college' | 'adult'`), which is wider than the game's.
   * Translating it is a curriculum question, so it happens in `levels/`, not
   * here - this port only reports what was said.
   *
   * `null` means the platform holds no opinion, which is different from
   * holding one this game cannot use. Both leave the local pick standing, but
   * only one of them is worth a diagnostic.
   */
  readonly grade: string | null;
  /** How this learner was chosen. Diagnostics only - never persisted, never
   * shown, never sent anywhere. */
  readonly pickedBy: 'url-param' | 'primary' | 'first';
}

/**
 * Why there is no learner. Callers treat all four identically; the distinction
 * exists so a developer can tell "this build is not wired up" from "the
 * platform is down" without anyone logging a response body.
 */
export type AnonymousReason =
  /** No platform is configured in this build. Zero requests were made. */
  | 'not-configured'
  /** The platform answered, and nobody is signed in. */
  | 'unauthenticated'
  /** Offline, blocked, timed out, 5xx, or an answer that was not JSON. */
  | 'unavailable'
  /** Signed in, but the household is empty - so there is nobody to play as. */
  | 'no-learners';

export type IdentityResult =
  | { outcome: 'identified'; identity: LearnerIdentity }
  | { outcome: 'anonymous'; reason: AnonymousReason };

export interface LearnerIdentitySource {
  /**
   * Resolve once.
   *
   * **MUST NOT THROW** - the same contract `ProgressionCodec.parse` holds, and
   * for the same reason: this sits on the boot path of a game that has to keep
   * working when everything around it does not. Implementations memoize, so
   * two callers share one round trip.
   */
  resolve(): Promise<IdentityResult>;
}

/** The anonymous answer, as a value - saves every caller rebuilding it. */
export function anonymous(reason: AnonymousReason): IdentityResult {
  return { outcome: 'anonymous', reason };
}
