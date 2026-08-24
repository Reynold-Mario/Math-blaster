import type { SkillProgress, SkillSubProgress } from '../skills/SkillTree';

/**
 * What persists between runs: currency earned and skill levels purchased.
 * Deliberately separate from RuntimeState, which is per-run and resets on
 * every resetRun() call - skillProgress used to live there, which meant
 * every upgrade would have been wiped out at the start of each new run.
 */
export interface PlayerProfile {
  currency: number;
  skillProgress: SkillProgress;
  /** Installments already paid toward each node's in-progress level - see
   * SkillTree's installment-purchase model. */
  skillSubProgress: SkillSubProgress;
}

const STORAGE_KEY = 'pixelMathBlaster.profile.v1';

export function createEmptyProfile(): PlayerProfile {
  return { currency: 0, skillProgress: {}, skillSubProgress: {} };
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
