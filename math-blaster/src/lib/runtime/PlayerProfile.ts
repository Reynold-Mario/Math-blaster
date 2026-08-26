import type { SkillProgress, SkillSubProgress } from '../skills/SkillTree';
import { GRADE_ORDER, type GradeLevel } from '../levels/gradeTree';

/**
 * What persists between runs: currency earned, skill levels purchased, and
 * which grade's maths the player is practising. Deliberately separate from
 * RuntimeState, which is per-run and resets on every resetRun() call -
 * skillProgress used to live there, which meant every upgrade would have
 * been wiped out at the start of each new run.
 *
 * This file is now PURE: the type, the validation, and nothing about where
 * any of it is stored. Loading and saving belong to the progression store
 * (`progression/`), which owns the key, the `window` guard, JSON and the
 * try/catches - so that swapping localStorage for something networked does
 * not touch validation.
 */
export interface PlayerProfile {
  currency: number;
  /**
   * Lifetime totals, which `currency` is not - it goes down when the player
   * spends. Two MONOTONE counters are what make a merge possible at all:
   * `max` is meaningful on a total and meaningless on a balance, so without
   * these, reconciling two devices could only ever guess.
   */
  earnedTotal: number;
  spentTotal: number;
  skillProgress: SkillProgress;
  /** Installments already paid toward each node's in-progress level - see
   * SkillTree's installment-purchase model. */
  skillSubProgress: SkillSubProgress;
  /** The grade whose curriculum a run draws on. Locally chosen for now;
   * see `gradeSource.ts` for where it will come from instead. */
  selectedGrade: GradeLevel;
  /**
   * The furthest wave this player has ever started. It is the hard ceiling
   * on where a run may begin - neither the Checkpoint skill nor a paid skip
   * can put a player into a wave they have never seen, so skipping only
   * ever skips ground already covered.
   */
  highestWaveReached: number;
}

export const DEFAULT_GRADE: GradeLevel = 'K';

export function isGrade(value: unknown): value is GradeLevel {
  return typeof value === 'string' && (GRADE_ORDER as string[]).includes(value);
}

export function createEmptyProfile(): PlayerProfile {
  return {
    currency: 0,
    earnedTotal: 0,
    spentTotal: 0,
    skillProgress: {},
    skillSubProgress: {},
    selectedGrade: DEFAULT_GRADE,
    highestWaveReached: 1,
  };
}

/** A finite number, floored, never below `min`. The shape most of these
 * fields need: a hand-edited profile must not be able to smuggle in NaN,
 * Infinity or a fraction. */
function counter(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

/**
 * Coerce whatever was stored into a valid profile. **Never throws**, and
 * never rejects a payload wholesale - every field degrades on its own.
 *
 * This is the one place untrusted data enters the game: a player can edit
 * it, and an older version of the game may have written a different shape.
 * Two fields gate real things - `highestWaveReached` decides what a player
 * may skip to, and `selectedGrade` decides which maths they are asked.
 */
export function normalizeProfile(raw: unknown): PlayerProfile {
  if (raw === null || typeof raw !== 'object') return createEmptyProfile();
  const parsed = raw as Record<string, unknown>;

  const currency = typeof parsed.currency === 'number' && Number.isFinite(parsed.currency) ? parsed.currency : 0;

  // A profile written before these existed is INCOMPLETE, not wrong: the
  // player really did earn everything they are holding, and had spent
  // nothing we know about. That is why the storage key stays at v1.
  const earnedTotal = counter(parsed.earnedTotal, 0, Math.max(0, currency));
  // Mirrors the database's `spent <= earned` CHECK. Clamping rather than
  // rejecting keeps the rule true without discarding a real balance.
  const spentTotal = Math.min(counter(parsed.spentTotal, 0, 0), earnedTotal);

  return {
    currency,
    earnedTotal,
    spentTotal,
    skillProgress: parsed.skillProgress && typeof parsed.skillProgress === 'object' ? (parsed.skillProgress as SkillProgress) : {},
    skillSubProgress:
      parsed.skillSubProgress && typeof parsed.skillSubProgress === 'object'
        ? (parsed.skillSubProgress as SkillSubProgress)
        : {},
    // Validated against the real grade list rather than just
    // typeof-checked - so a profile saved before grades existed, or one
    // carrying a grade that has since been removed, both load as the
    // default instead of putting the run in an unauthored curriculum.
    selectedGrade: isGrade(parsed.selectedGrade) ? parsed.selectedGrade : DEFAULT_GRADE,
    // Floored at 1 and integer-coerced: this value gates what a player is
    // allowed to skip to, so a corrupted or hand-edited profile must not
    // be able to unlock arbitrary waves.
    highestWaveReached: counter(parsed.highestWaveReached, 1, 1),
  };
}
