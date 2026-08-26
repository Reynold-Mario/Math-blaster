import type { StorageLike } from '../progression/localStorageStore';

/**
 * Which slot on this device belongs to whom.
 *
 * Pure, and separate from the store that uses it, because the interesting part
 * is a RULE rather than a mechanism: on a shared tablet, whose progress does an
 * anonymous save become?
 */

/**
 * Records the one learner that adopted this device's anonymous save.
 *
 * Not namespaced by game and not by storage key on purpose: it is a fact about
 * the DEVICE, and the profile and the pending-run queue must reach the same
 * verdict. Two markers would let a child inherit a sibling's queued runs while
 * correctly not inheriting their currency.
 */
export const CLAIM_MARKER_KEY = 'pixelMathBlaster.claimedBy.v1';

/**
 * A learner's slot is the anonymous key plus a suffix.
 *
 * **The anonymous key itself never moves.** It predates all of this and holds
 * every current player's currency and skills, so it stays exactly where it is
 * and becomes the slot for anyone we cannot name. Suffixing keeps it a literal
 * prefix of the new key, which is also what keeps the `v1` versioning rule
 * meaning what it meant.
 */
export function learnerScopedKey(anonymousKey: string, learnerId: string): string {
  return `${anonymousKey}.${learnerId}`;
}

export type ClaimOutcome =
  /** First learner on this device. The anonymous save is theirs. */
  | 'claimed'
  /** This same learner already claimed it, so there is nothing left to carry. */
  | 'already-mine'
  /** Somebody else got here first. This learner starts fresh. */
  | 'already-claimed-by-other';

/**
 * Decide whether this learner may adopt the device's anonymous save.
 *
 * **The marker is the whole point.** Carrying the save over unconditionally is
 * the obvious implementation and it is wrong: a child plays signed out, a
 * sibling signs in, and the sibling inherits everything. Recording who took it
 * makes that a one-time event instead of a rule.
 *
 * Non-destructive by design - the anonymous slot is never deleted, so a guest
 * on the family tablet still finds their game where they left it. And there is
 * deliberately NO merge across this boundary: merging one child's progress into
 * another's is the same mistake at a different moment.
 */
export function claimAnonymousSave(storage: StorageLike | null, learnerId: string): ClaimOutcome {
  if (storage === null) return 'already-claimed-by-other';
  let existing: string | null = null;
  try {
    existing = storage.getItem(CLAIM_MARKER_KEY);
  } catch {
    // Storage present but throwing (Safari private mode has done this).
    // Refusing to claim is the safe direction: the cost is a fresh profile,
    // where the cost of claiming wrongly is somebody else's.
    return 'already-claimed-by-other';
  }
  if (existing === learnerId) return 'already-mine';
  if (existing !== null && existing !== '') return 'already-claimed-by-other';
  try {
    storage.setItem(CLAIM_MARKER_KEY, learnerId);
  } catch {
    return 'already-claimed-by-other';
  }
  return 'claimed';
}
