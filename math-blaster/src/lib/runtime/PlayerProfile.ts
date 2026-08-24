import type { SkillProgress, SkillSubProgress } from '../skills/SkillTree';
import { GRADE_ORDER, type GradeLevel } from '../levels/gradeTree';

/**
 * What persists between runs: currency earned, skill levels purchased, and
 * which grade's maths the player is practising. Deliberately separate from
 * RuntimeState, which is per-run and resets on every resetRun() call -
 * skillProgress used to live there, which meant every upgrade would have
 * been wiped out at the start of each new run.
 */
export interface PlayerProfile {
  currency: number;
  skillProgress: SkillProgress;
  /** Installments already paid toward each node's in-progress level - see
   * SkillTree's installment-purchase model. */
  skillSubProgress: SkillSubProgress;
  /** The grade whose curriculum a run draws on. Locally chosen for now;
   * see `gradeSource.ts` for where it will come from instead. */
  selectedGrade: GradeLevel;
}

// Still v1: every field added since has been additive with a validated
// fallback, so an older payload loads cleanly. Bump it only for a change
// that would make an old profile *wrong* rather than incomplete.
const STORAGE_KEY = 'pixelMathBlaster.profile.v1';

export const DEFAULT_GRADE: GradeLevel = 'K';

function isGrade(value: unknown): value is GradeLevel {
  return typeof value === 'string' && (GRADE_ORDER as string[]).includes(value);
}

export function createEmptyProfile(): PlayerProfile {
  return { currency: 0, skillProgress: {}, skillSubProgress: {}, selectedGrade: DEFAULT_GRADE };
}

export function loadPlayerProfile(): PlayerProfile {
  try {
    if (typeof window === 'undefined') return createEmptyProfile();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyProfile();
    const parsed = JSON.parse(raw);
    return {
      currency: typeof parsed.currency === 'number' ? parsed.currency : 0,
      skillProgress: parsed.skillProgress && typeof parsed.skillProgress === 'object' ? parsed.skillProgress : {},
      skillSubProgress:
        parsed.skillSubProgress && typeof parsed.skillSubProgress === 'object' ? parsed.skillSubProgress : {},
      // Additive, and validated against the real grade list rather than
      // just typeof-checked - so a profile saved before grades existed, or
      // one carrying a grade that has since been removed, both load as the
      // default instead of putting the run in an unauthored curriculum.
      selectedGrade: isGrade(parsed.selectedGrade) ? parsed.selectedGrade : DEFAULT_GRADE,
    };
  } catch {
    return createEmptyProfile();
  }
}

export function savePlayerProfile(profile: PlayerProfile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable - ignore */
  }
}
