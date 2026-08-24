import type { AnswerResult, AnswerVerdict } from './math/evaluator';

/** How many consecutive incorrect/invalid answers (against the same
 * target) it takes to force a reinforcement, independent of the
 * close/partial chance-based rule below. */
const MISS_STREAK_THRESHOLD = 3;

const REINFORCE_CHANCE_CLOSE = 0.5;
const REINFORCE_CHANCE_PARTIAL = 0.35;

const GRUNT_PARTIAL_BASE = 0.7;

// --- Boss timer cuts. A boss has no health; a good answer shortens how
// long the player has to survive instead. The numbers are milliseconds
// shaved off the survive clock, which is what the old damage percentages
// have become - same role, expressed in the currency the fight actually
// runs on. ---

const BOSS_CUT_EXACT_MS = 2600;
const BOSS_CUT_CLOSE_MS = 900;
const BOSS_CUT_PARTIAL_MAX_MS = 1600;
/** Cracking an exposed weak point is worth noticeably more than a clean
 * hit on the body - it's a harder shot under a tighter tolerance. */
const BOSS_WEAK_POINT_CUT_MS = 4200;

/** How much of a "partial" hit's damage lands, scaled by how many digits
 * actually matched rather than a flat rate - more matching digits reads
 * as more damage, not just a fixed partial-credit amount. */
function partialMatchRatio(result: AnswerResult): number {
  if (!result.digitMatch || result.digitMatch.matches.length === 0) return 0;
  const hits = result.digitMatch.matches.filter(Boolean).length;
  return hits / result.digitMatch.matches.length;
}

/** Exact and equivalent are the only verdicts that count as mastery: they
 * extend a boss combo, and they're the only thing a shield yields to. */
function isMastered(verdict: AnswerVerdict): boolean {
  return verdict === 'exact' || verdict === 'equivalent';
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

function bossCutFor(result: AnswerResult): number {
  switch (result.verdict) {
    case 'exact':
    case 'equivalent':
      return BOSS_CUT_EXACT_MS;
    case 'close':
      return BOSS_CUT_CLOSE_MS;
    case 'partial':
      return Math.round(BOSS_CUT_PARTIAL_MAX_MS * partialMatchRatio(result));
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
  if (isMastered(verdict)) {
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

/** The consequence of one shot on a grunt. Pure - callers apply the
 * hp/layer/shield changes and spawn the reinforcement themselves. */
export interface GruntHitOutcome {
  damage: number;
  /** The shot bounced off an intact shield: nothing landed, and the
   * shield is still up. */
  blocked: boolean;
  /** This shot stripped the shield. No damage lands on the same shot -
   * breaking through is its own step. */
  shieldBroken: boolean;
  /** The current layer was emptied. When other layers remain the caller
   * refreshes hp and mints a new problem instead of removing the enemy. */
  layerBroken: boolean;
  /** The last layer was emptied - the enemy is gone. */
  defeated: boolean;
  reinforce: boolean;
  missStreak: number;
}

export interface GruntTarget {
  hp: number;
  maxHp: number;
  layersRemaining: number;
  shielded: boolean;
}

export function resolveGruntHit(result: AnswerResult, target: GruntTarget, missStreak: number): GruntHitOutcome {
  const decision = decideReinforcement(result.verdict, missStreak);
  const base = {
    reinforce: decision.shouldReinforce,
    missStreak: decision.missStreak,
  };

  // A shield is a hard gate, not a damage reduction: only an exact answer
  // gets through it, and doing so costs the whole shot.
  if (target.shielded) {
    const cracked = isMastered(result.verdict);
    return {
      ...base,
      damage: 0,
      blocked: !cracked,
      shieldBroken: cracked,
      layerBroken: false,
      defeated: false,
    };
  }

  const damage = damageForGrunt(result, target.maxHp);
  const layerBroken = damage > 0 && target.hp - damage <= 0;

  return {
    ...base,
    damage,
    blocked: false,
    shieldBroken: false,
    layerBroken,
    defeated: layerBroken && target.layersRemaining <= 1,
  };
}

/** The consequence of one answer aimed at a boss. There's no damage here
 * because there's no health: an answer either shortens the fight, breaks
 * a shield, extends a combo, or does nothing. */
export interface BossAnswerOutcome {
  /** Milliseconds to shave off the survive clock. */
  surviveCutMs: number;
  /** Hit the shielded body, or missed the weak point's exactness
   * requirement - nothing happened, and the combo is untouched. */
  blocked: boolean;
  /** This answer cracked the weak point and dropped the shield. */
  shieldBroken: boolean;
  /** The combo value to store back. */
  combo: number;
  /** A standing combo was just reset by a non-exact answer. */
  comboBroken: boolean;
  /** The combo reached the threshold - the fight is over, right now. */
  masteryAchieved: boolean;
  reinforce: boolean;
  missStreak: number;
}

export interface BossTarget {
  comboRequired: number;
  /** False while the shield is up. */
  vulnerable: boolean;
}

/**
 * Resolves one answer against a boss.
 *
 * Three situations, and they behave quite differently:
 *
 * - **Vulnerable body.** The ordinary case. Every non-zero verdict cuts
 *   the survive clock, so close and partial answers still make real
 *   progress; only exact and equivalent extend the combo, and anything
 *   less resets it.
 * - **Shielded body.** Nothing lands, and - deliberately - the combo is
 *   left alone. Firing into a shield isn't a failed attempt at the boss,
 *   it's a shot that never reached it, so it shouldn't cost a run the
 *   player has built up.
 * - **Exposed weak point.** Only an exact answer cracks it. That drops
 *   the shield, cuts the biggest chunk off the clock, and extends the
 *   combo. Anything less simply bounces.
 */
export function resolveBossAnswer(
  result: AnswerResult,
  boss: BossTarget,
  combo: number,
  missStreak: number,
  atWeakPoint: boolean
): BossAnswerOutcome {
  const decision = decideReinforcement(result.verdict, missStreak);
  const mastered = isMastered(result.verdict);
  const base = {
    reinforce: decision.shouldReinforce,
    missStreak: decision.missStreak,
  };
  const blockedOutcome: BossAnswerOutcome = {
    ...base,
    surviveCutMs: 0,
    blocked: true,
    shieldBroken: false,
    combo,
    comboBroken: false,
    masteryAchieved: false,
  };

  if (!boss.vulnerable) {
    if (!atWeakPoint || !mastered) return blockedOutcome;

    const nextCombo = combo + 1;
    return {
      ...base,
      surviveCutMs: BOSS_WEAK_POINT_CUT_MS,
      blocked: false,
      shieldBroken: true,
      combo: nextCombo,
      comboBroken: false,
      masteryAchieved: nextCombo >= boss.comboRequired,
    };
  }

  const nextCombo = mastered ? combo + 1 : 0;
  return {
    ...base,
    surviveCutMs: bossCutFor(result),
    blocked: false,
    shieldBroken: false,
    combo: nextCombo,
    comboBroken: !mastered && combo > 0,
    masteryAchieved: mastered && nextCombo >= boss.comboRequired,
  };
}
