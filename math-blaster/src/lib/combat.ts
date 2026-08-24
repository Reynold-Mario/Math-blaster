import type { AnswerResult, AnswerVerdict } from './math/evaluator';

/** How many consecutive incorrect/invalid answers (against the same
 * target) it takes to force a reinforcement, independent of the
 * close/partial chance-based rule below. */
const MISS_STREAK_THRESHOLD = 3;

const REINFORCE_CHANCE_CLOSE = 0.5;
const REINFORCE_CHANCE_PARTIAL = 0.35;

const GRUNT_PARTIAL_BASE = 0.7;
const BOSS_PARTIAL_BASE = 0.08;

/** How much of a "partial" hit's damage lands, scaled by how many digits
 * actually matched rather than a flat rate - more matching digits reads
 * as more damage, not just a fixed partial-credit amount. */
function partialMatchRatio(result: AnswerResult): number {
  if (!result.digitMatch || result.digitMatch.matches.length === 0) return 0;
  const hits = result.digitMatch.matches.filter(Boolean).length;
  return hits / result.digitMatch.matches.length;
}

function damageForGrunt(result: AnswerResult, maxHp: number): number {
  switch (result.verdict) {
    case 'exact':
    case 'equivalent':
      return maxHp;
    case 'close':
      return Math.round(maxHp * 0.5);
    case 'partial':
      return Math.round(maxHp * GRUNT_PARTIAL_BASE * partialMatchRatio(result));
    default:
      return 0;
  }
}

function damageForBoss(result: AnswerResult, maxHp: number): number {
  switch (result.verdict) {
    case 'exact':
    case 'equivalent':
      return Math.round(maxHp * 0.16);
    case 'close':
      return Math.round(maxHp * 0.06);
    case 'partial':
      return Math.round(maxHp * BOSS_PARTIAL_BASE * partialMatchRatio(result));
    default:
      return 0;
  }
}

interface ReinforcementDecision {
  shouldReinforce: boolean;
  /** The streak value to store back wherever the caller keeps it - 0 when
   * reset, otherwise the incremented count. */
  missStreak: number;
}

/**
 * Close and partial answers each get their own chance to call in a
 * reinforcement immediately. Exact and equivalent never do, and reset the
 * streak - they're fully correct, there's nothing to be "repeated" about.
 * Incorrect and invalid don't reinforce on their own, but build toward the
 * repeated-mistakes threshold instead, so a single bad guess is never
 * punished but a real pattern of them still has teeth.
 */
function decideReinforcement(verdict: AnswerVerdict, missStreak: number): ReinforcementDecision {
  if (verdict === 'exact' || verdict === 'equivalent') {
    return { shouldReinforce: false, missStreak: 0 };
  }
  if (verdict === 'close') {
    return { shouldReinforce: Math.random() < REINFORCE_CHANCE_CLOSE, missStreak: 0 };
  }
  if (verdict === 'partial') {
    return { shouldReinforce: Math.random() < REINFORCE_CHANCE_PARTIAL, missStreak: 0 };
  }
  // incorrect or invalid
  const streak = missStreak + 1;
  if (streak >= MISS_STREAK_THRESHOLD) {
    return { shouldReinforce: true, missStreak: 0 };
  }
  return { shouldReinforce: false, missStreak: streak };
}

/** The consequence of one shot: how much damage landed, whether it should
 * call in a reinforcement, whether the target is now defeated, and the
 * streak value to persist. Pure - callers apply the hp/streak changes and
 * spawn the reinforcement themselves. */
export interface HitOutcome {
  damage: number;
  reinforce: boolean;
  defeated: boolean;
  missStreak: number;
}

export function resolveGruntHit(
  result: AnswerResult,
  target: { hp: number; maxHp: number },
  missStreak: number
): HitOutcome {
  const damage = damageForGrunt(result, target.maxHp);
  const decision = decideReinforcement(result.verdict, missStreak);
  return {
    damage,
    reinforce: decision.shouldReinforce,
    defeated: Math.max(0, target.hp - damage) <= 0,
    missStreak: decision.missStreak,
  };
}

export function resolveBossHit(
  result: AnswerResult,
  boss: { hp: number; maxHp: number },
  missStreak: number
): HitOutcome {
  const damage = damageForBoss(result, boss.maxHp);
  const decision = decideReinforcement(result.verdict, missStreak);
  return {
    damage,
    reinforce: decision.shouldReinforce,
    defeated: Math.max(0, boss.hp - damage) <= 0,
    missStreak: decision.missStreak,
  };
}
