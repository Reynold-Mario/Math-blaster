import type { AnswerResult, AnswerVerdict } from './math/evaluator';

// --- Reinforcements. A reinforcement is the consequence of the player
// having stopped engaging with the problem in front of them, and NOTHING
// ELSE. It is not a difficulty knob and not a timer.
//
// The old rule had this backwards. A `close` answer rolled a 50% chance of
// calling one in and a `partial` 35%, while a single outright wrong answer
// rolled nothing at all - so the player who reasoned their way to within
// one of the answer was punished harder than the one who guessed. The
// stated reasoning was that a near-miss doesn't remove the enemy, so the
// wave stretches; but the whole rest of the design says the reward for a
// near-miss is TIME, and this was quietly taking it back.
//
// So anything that lands at all now counts as engaging and resets the
// escalation, and only `incorrect`/`invalid` build toward it. ---

/** Consecutive misses that are free. A single wrong answer is never
 * punished - a child guessing once is thinking, not disengaging. */
const REINFORCE_GRACE_MISSES = 1;
/** Chance on the first miss past the grace, then climbing per miss. */
const REINFORCE_CHANCE_START = 0.35;
const REINFORCE_CHANCE_STEP = 0.25;

// --- Grunt knockback. Grunts have no health: an exact answer breaks a
// layer outright, and a near-miss shoves the enemy back up the screen
// instead of chipping a hit-point pool. What a good-but-not-exact answer
// buys is time, which is the only resource this game runs on.
//
// The partial ceiling sits below the close amount on purpose, so a close
// answer always out-pushes a partial one no matter how many digits that
// partial matched. ---

/** How far up the screen (in y-percent) a `close` answer shoves a grunt. */
const KNOCKBACK_CLOSE_PCT = 18;
/** The most a `partial` answer can shove one, at a full digit match. */
const KNOCKBACK_PARTIAL_MAX_PCT = 11;

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

/** How much of a "partial" hit lands, scaled by how many digits actually
 * matched rather than a flat rate - more matching digits reads as a
 * bigger shove, not just a fixed partial-credit amount. */
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

/** How far a non-exact answer shoves a grunt back up the screen. Exact and
 * equivalent return 0 because they don't push anything - they break the
 * layer instead. */
function knockbackForGrunt(result: AnswerResult): number {
  switch (result.verdict) {
    case 'close':
      return KNOCKBACK_CLOSE_PCT;
    case 'partial':
      return KNOCKBACK_PARTIAL_MAX_PCT * partialMatchRatio(result);
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

/** Whether an answer counts as engaging with the problem at all. Exact and
 * equivalent are obvious; `close` is reasoning that landed near, and
 * `partial` at least got a place value right. All four say the player is
 * still working, which is the only thing reinforcements care about. */
function isEngaged(verdict: AnswerVerdict): boolean {
  return isMastered(verdict) || verdict === 'close' || verdict === 'partial';
}

/**
 * Whether this answer calls in a reinforcement.
 *
 * Anything that landed at all resets the escalation to zero - a player
 * still reasoning at the problem is never punished for it, however far off
 * they are. Only `incorrect` and `invalid` build toward a reinforcement,
 * and the chance CLIMBS with each consecutive one, so drifting further from
 * the maths gets steadily more crowded while a single bad guess costs
 * nothing.
 *
 * The streak deliberately survives a reinforcement firing. Resetting it
 * there would sawtooth the pressure back to zero every time it landed,
 * which is the opposite of "the less the player engages, the more arrives";
 * only actually engaging clears it.
 */
function decideReinforcement(verdict: AnswerVerdict, missStreak: number): ReinforcementDecision {
  if (isEngaged(verdict)) {
    return { shouldReinforce: false, missStreak: 0 };
  }

  const streak = missStreak + 1;
  const past = streak - REINFORCE_GRACE_MISSES;
  if (past <= 0) return { shouldReinforce: false, missStreak: streak };

  const chance = Math.min(1, REINFORCE_CHANCE_START + (past - 1) * REINFORCE_CHANCE_STEP);
  return { shouldReinforce: Math.random() < chance, missStreak: streak };
}

/** The consequence of one shot on a grunt. Pure - callers apply the
 * knockback/layer/shield changes and spawn the reinforcement themselves. */
export interface GruntHitOutcome {
  /** How far up the screen to shove the enemy, in y-percent. Only ever
   * non-zero for close and partial answers - the reward for nearly getting
   * it right is time, not a dent in a health bar. */
  knockbackPct: number;
  /** The shot bounced off an intact shield: nothing landed, and the
   * shield is still up. */
  blocked: boolean;
  /** This shot stripped the shield. Nothing else lands on the same shot -
   * breaking through is its own step. */
  shieldBroken: boolean;
  /** The current layer was answered. When other layers remain the caller
   * mints a new problem instead of removing the enemy. */
  layerBroken: boolean;
  /** The last layer was answered - the enemy is gone. */
  defeated: boolean;
  reinforce: boolean;
  missStreak: number;
}

/** Everything a grunt hit reads off its target. No health here: a layer is
 * a question to answer, not a pool to drain, so `layersRemaining` is the
 * whole of an enemy's durability. */
export interface GruntTarget {
  layersRemaining: number;
  shielded: boolean;
}

export function resolveGruntHit(result: AnswerResult, target: GruntTarget, missStreak: number): GruntHitOutcome {
  const decision = decideReinforcement(result.verdict, missStreak);
  const base = {
    reinforce: decision.shouldReinforce,
    missStreak: decision.missStreak,
  };

  // A shield is a hard gate, not a partial reduction: only an exact answer
  // gets through it, and doing so costs the whole shot.
  if (target.shielded) {
    const cracked = isMastered(result.verdict);
    return {
      ...base,
      knockbackPct: 0,
      blocked: !cracked,
      shieldBroken: cracked,
      layerBroken: false,
      defeated: false,
    };
  }

  // Only mastery answers a layer. Anything less lands as a shove, which is
  // why `close` can never accumulate into a kill the way half-damage used
  // to - it buys the player time to work the problem out properly.
  const layerBroken = isMastered(result.verdict);

  return {
    ...base,
    knockbackPct: layerBroken ? 0 : knockbackForGrunt(result),
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
