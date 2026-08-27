import type { PlayerProfile } from './PlayerProfile';
import { DEFAULT_GRADE } from './PlayerProfile';
import { GRADE_ORDER, type GradeLevel } from '../levels/gradeTree';

/**
 * Where the player's grade comes from.
 *
 * Exactly one function on purpose. Today the grade is whatever the player
 * picked locally, kept on their profile. It is meant to come from a service
 * that already knows the user's grade instead - and when it does, this
 * function's body is the only thing that should need to change. Nothing
 * else in the codebase reads `profile.selectedGrade`, and nothing else
 * decides what grade a run is at.
 *
 * That future source is remote, so treat its answer as untrusted the way
 * this one already does: validate it against `GRADE_ORDER` and fall back to
 * a real grade rather than letting an unknown value reach the curriculum
 * ladder. A run with no problems in it is a much worse failure than a run
 * at the wrong grade.
 *
 * Since the progression store was introduced, "the grade comes from the
 * platform" has a place to be implemented that is NOT here: the store puts
 * it on the profile, and this function keeps validating it exactly as it
 * already does. Which is why the store landing changed nothing in this
 * file - the seam was already in the right place.
 */
export function resolveGrade(profile: PlayerProfile): GradeLevel {
  return (GRADE_ORDER as string[]).includes(profile.selectedGrade) ? profile.selectedGrade : DEFAULT_GRADE;
}
