import type { RuntimeState, EnemyInstance, BossState } from './RuntimeState';
import type { PlayerProfile } from './PlayerProfile';
import type { BossPhase, Curriculum } from '../levels/LevelDefinition';
import type { EnemyArchetypeId } from '../levels/enemyArchetypes';
import type { ProblemDefinition } from '../math/ProblemDefinition';
import type { AnswerResult } from '../math/evaluator';
import type { InputAction } from '../input/InputManager';

import { phaseIndexForProgress } from '../levels/LevelDefinition';
import {
	enemyArchetype,
	stepMovement,
	clampLane,
	GLOBAL_FALL_SPEED_MULTIPLIER
} from '../levels/enemyArchetypes';
import { buildFormation } from '../levels/waves';
import {
	arcadeDifficultyFor,
	bossMinFightSec,
	bossOrdinal,
	bossRulesFor,
	bossScopeForWave,
	curriculumForWave,
	isBossWave,
	waveSpecFor
} from '../levels/waveProgression';
import {
	generateProblem,
	generateBossProblem,
	buildAuthoredProblem
} from '../levels/problemGenerators';
import { evaluateAnswer } from '../math/evaluator';
import { resolveGruntHit, resolveBossAnswer } from '../combat';
import { resolveTarget, ALIGNMENT_TOLERANCE_PCT, weakPointXPct } from '../targeting';
import { gameEvents } from '../events';
import { currentEffect } from '../skills/SkillTree';
import { findBaseSkillNode } from '../skills/baseSkillTree';
import { curriculumLadderForGrade, cumulativeScopeForGrade } from '../levels/gradeTree';
import { resolveGrade } from './gradeSource';

// Must match GameCanvas.svelte's own IMPACT_LINE_PCT constant.
const IMPACT_LINE_PCT = 86;
// Likewise its BOSS_Y_PCT - where boss hit effects should appear.
const BOSS_FX_Y_PCT = 12;
// --- The run clock. Time is the only resource this game spends, and the
// only thing that ends a run. It used to be a single budget set once at the
// start and drained to zero, which made the game unfinishable the moment a
// boss was more than a few waves away: a fully upgraded clock ran out
// around wave 4.
//
// So the clock is now earned back. Clearing a wave pays a flat amount plus
// a per-kill share, and the cap means those payouts bank into *surviving
// the next wave* rather than accumulating into a cushion that makes the
// rest of the run free. A player who keeps clearing waves keeps playing;
// one who starts leaking enemies loses the bonus and the clock together.
//
// These numbers HAVE now been tuned, against simulated runs rather than
// against children - `balanceSim.ts` drives this module with modelled
// players and reports where runs end. What that measured, and what these
// values are set to answer:
//
//  - A slow player (~6.5s per problem) was walled at the first boss: the
//    median run ended on wave 5 and only 40% of them ever got past it.
//  - The payout is deliberately weighted toward the FLAT part rather than
//    the per-kill share. Per-kill rewards throughput, which is precisely
//    what a struggling child does not have; the flat part is what lets a
//    player who answered one of two still come out roughly level.
//  - It cannot balance for both ends at once: a payout that lets a 6.5s
//    player survive necessarily overpays a 3.2s one, who therefore climbs
//    to the ceiling and stays there. That is what the ceiling is FOR - it
//    is the pressure valve on a surplus, not an oversight. What matters is
//    that it arrives late in a run rather than at wave 6.
//
// Re-run the harness after touching any of these; they interact. ---

const BASE_TIMER_MS = 50000;
/**
 * How far above a player's *starting* clock earned time can bank.
 *
 * The ceiling is relative rather than absolute on purpose. A flat cap at
 * base + a maxed More Time would leave a fully upgraded player pinned to it
 * from wave 1 - every wave-clear payout silently discarded, and More Time
 * reduced to "start at the ceiling" rather than an upgrade that keeps
 * paying. Relative to the start, every player gets the same bankable slack
 * and More Time raises both ends.
 *
 * The size of the slack is what decides how deep a strong player gets
 * before their surplus starts being discarded. It was 30s, which measured
 * as a competent player pinned from wave 6 of a ~30-wave run - most of the
 * run spent with the clock inert and no feedback for good play.
 */
const BANKABLE_HEADROOM_MS = 35000;
/** Paid for clearing an ordinary wave, before per-kill share. Carries most
 * of the payout on purpose - see the note above on why the flat part is
 * what keeps a struggling player in the run. It has to stay comfortably
 * below (formation size x impact penalty), or letting a whole wave land
 * becomes a free way past a wave the player can't answer. */
const WAVE_CLEAR_BONUS_MS = 9500;
/** Paid per qualifying kill in the cleared wave. An enemy that got through
 * costs the player this as well as the impact penalty. */
const WAVE_CLEAR_PER_KILL_BONUS_MS = 3000;
/**
 * Paid for DEFEATING a boss - the mastery route only. Outlasting the
 * survive clock is escaping a boss, not killing it, and pays nothing at
 * all: the cost of failing to defeat one is the half-minute spent on it
 * with nothing to show.
 *
 * Cut from 25s when it stopped being paid on both routes, then raised
 * again against the harness. Withholding it from the survival route,
 * shrinking it, and giving every fight a 30s+ floor all push the same
 * direction, and the youngest players wear all three at once - this is
 * the knob that buys them back. Retune it HERE rather than by paying the
 * survival route something, which is the distinction the whole change
 * rests on.
 */
const BOSS_CLEAR_BONUS_MS = 18000;
/** Cut from the clock by one enemy reaching the impact line. Every point of
 * this compounds for a weak player, who leaks on most waves - it was 5s,
 * which was most of why a slow run died before the second boss. */
const BASE_IMPACT_TIME_PENALTY_MS = 3500;
const BASE_CURRENCY_PER_KILL = 5;
const BASE_PLAYER_SPEED_PCT_PER_SEC = 55;

/**
 * Seconds between a wave being announced and its formation arriving.
 *
 * Every wave gets one, which is what makes waves read as discrete events:
 * the board empties, the run takes a breath, the next wave is called, then
 * it arrives. It also does the job the old opening delay did - the
 * countdown never hands the player a formation already halfway down.
 */
const WAVE_BREATHER_SEC = 1.5;
/** How many reinforcements one wave can be padded out with. A wave ends
 * when the board empties, so without a cap a player answering badly could
 * keep the same wave alive indefinitely and never reach the next one. */
const MAX_REINFORCEMENTS_PER_WAVE = 3;
/** Horizontal spread of the minis a splitter breaks into. */
const SPLIT_SPREAD_PCT = 9;
/** How far back up the screen a knockback can push an enemy. Kept a little
 * above the top edge so a shoved enemy still reads as being on its way in
 * rather than vanishing off-screen. */
const KNOCKBACK_CEILING_Y_PCT = -10;

/** The fight enters its finale when this fraction of the survive timer is
 * left - the boss drops its shield for good and goes berserk. */
const FINALE_REMAINING_THRESHOLD = 0.15;
/** Adds come in this much faster once the finale starts. */
const FINALE_ADD_INTERVAL_MULTIPLIER = 0.55;
/** How far off-centre a weak point can sit. Kept inside the boss sprite's
 * own width so the marker always reads as part of the boss. */
const WEAK_POINT_MIN_OFFSET_PCT = 8;
const WEAK_POINT_MAX_OFFSET_PCT = 16;

/** Ending a fight on a combo instead of the clock is the mastery route,
 * and it pays like one. It is also the ONLY route that pays: see
 * `onBossDefeated`. */
const MASTERY_SCORE_BONUS = 250;

// --- Boss bounty. A boss is the point of a run, so killing one is the
// biggest single payout in the game, and it grows with how many bosses
// deep the run has got - a wave-40 boss should not pay what wave 5's did.
//
// Expressed as a multiplier on the ordinary per-kill amount rather than as
// its own flat figure, so it goes through `awardCurrency` and the Bounty
// skill keeps applying to the one kill that matters most. ---

/** What the first boss pays, in ordinary-kill equivalents. */
const BOSS_BOUNTY_MULTIPLIER = 5;
/** Added to that multiplier for each boss the run has already reached. */
const BOSS_BOUNTY_MULTIPLIER_PER_FIGHT = 1.5;
/** On top again for the mastery route, which is the harder way to win. */
const MASTERY_BOUNTY_MULTIPLIER = 3;
/** Score for a good answer against a boss - bosses award no per-kill
 * score of their own, so this is the fight's whole scoring surface. */
const BOSS_ANSWER_SCORE = 15;
/** Each add a bomb clears during a boss fight is worth this much off the
 * survive clock. */
const BOMB_BOSS_CUT_PER_ADD_MS = 1200;
/** How much slower a boss's reinforcements fall than the fight's own
 * arcade difficulty asks for. An add exists to make disengaging cost
 * something, so it has to stay readable - see `spawnBossAdd`. */
const BOSS_ADD_SPEED_MULTIPLIER = 0.8;

function randInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randRange(min: number, max: number): number {
	return min + Math.random() * (max - min);
}
/** The rules of the fight in progress. Held on the run rather than looked
 * up, because a boss is generated from a wave number now. */
function currentBossRules(state: RuntimeState) {
	return state.bossRules!;
}
function currentBossPhase(state: RuntimeState): BossPhase {
	return currentBossRules(state).phases[state.boss!.phaseIndex];
}

/** Which arcade knobs apply right now - a boss fight governs its adds with
 * its own difficulty block rather than the wave's. */
function activeArcadeDifficulty(state: RuntimeState) {
	return state.runPhase === 'boss' && state.bossRules
		? state.bossRules.arcadeDifficulty
		: arcadeDifficultyFor(state.waveNumber);
}

/**
 * The curriculum ladder this run draws from - the player's grade and
 * nothing harder. Every problem in the game comes through here.
 *
 * Resolved per call rather than captured at run start, so it costs nothing
 * and can't go stale. `resolveGrade` is the one place the grade itself is
 * decided; see gradeSource.ts.
 */
function curriculumLadder(profile: PlayerProfile): Curriculum[] {
	return curriculumLadderForGrade(resolveGrade(profile));
}

/** What a boss may draw on: everything up to and including the run's grade,
 * so a fight reviews the ground already covered. Wider than the wave ladder
 * on purpose - waves teach this grade, bosses test everything up to it. */
function bossScope(profile: PlayerProfile): Curriculum[] {
	return cumulativeScopeForGrade(resolveGrade(profile));
}

/** Where a newly spawned or re-layered enemy's problem comes from. During
 * a boss fight even the adds draw from the boss's cumulative scope, so
 * the whole fight reviews everything learned so far. */
function problemForCurrentPhase(state: RuntimeState, profile: PlayerProfile): ProblemDefinition {
	if (state.runPhase === 'boss' && state.boss && state.bossRules) {
		return generateBossProblem(
			state.bossRules.scope,
			state.boss.progress,
			state.bossRules.scopeBias
		);
	}
	return generateProblem(curriculumForWave(curriculumLadder(profile), state.waveNumber));
}

// --- Skill-effect lookups. Skill levels now live on PlayerProfile (they
// persist across runs), not RuntimeState. Every one of these is
// well-defined at level 0 (its "not purchased" baseline), so calling
// these before any shop UI exists is always safe. ---

function currentPlayerSpeed(profile: PlayerProfile): number {
	const effect = currentEffect(findBaseSkillNode('player-speed')!, profile.skillProgress);
	return BASE_PLAYER_SPEED_PCT_PER_SEC * (effect.kind === 'playerSpeed' ? effect.multiplier : 1);
}
function currentEnemySpeedMultiplier(profile: PlayerProfile): number {
	const effect = currentEffect(findBaseSkillNode('enemy-slowdown')!, profile.skillProgress);
	return effect.kind === 'enemySpeed' ? effect.multiplier : 1;
}
function currentPierceChance(profile: PlayerProfile): number {
	const effect = currentEffect(findBaseSkillNode('pierce')!, profile.skillProgress);
	return effect.kind === 'pierce' ? effect.chance : 0;
}
function currentFireCooldownSec(profile: PlayerProfile): number {
	const effect = currentEffect(findBaseSkillNode('fire-rate')!, profile.skillProgress);
	return effect.kind === 'fireRate' ? effect.cooldownSec : 0.6;
}
function currentDodgeChance(profile: PlayerProfile): number {
	const effect = currentEffect(findBaseSkillNode('dodge')!, profile.skillProgress);
	return effect.kind === 'dodge' ? effect.chance : 0;
}
function currentArmorReduction(profile: PlayerProfile): number {
	const effect = currentEffect(findBaseSkillNode('armor')!, profile.skillProgress);
	return effect.kind === 'armor' ? effect.penaltyReduction : 0;
}
function currentBountyBonus(profile: PlayerProfile): number {
	const effect = currentEffect(findBaseSkillNode('bounty')!, profile.skillProgress);
	return effect.kind === 'bounty' ? effect.bonusPerKill : 0;
}
function startingTimeMs(profile: PlayerProfile): number {
	const moreTime = currentEffect(findBaseSkillNode('more-time')!, profile.skillProgress);
	return BASE_TIMER_MS + (moreTime.kind === 'moreTime' ? moreTime.bonusMs : 0);
}

/** The most the clock can hold for this player. */
function maxTimeMs(profile: PlayerProfile): number {
	return startingTimeMs(profile) + BANKABLE_HEADROOM_MS;
}

// --- Setup ---

export function createInitialRuntimeState(): RuntimeState {
	return {
		waveNumber: 1,
		runPhase: 'wave',
		score: 0,
		timeRemainingMs: BASE_TIMER_MS,
		enemies: [],
		player: {
			xPct: 50,
			movingLeft: false,
			movingRight: false,
			inputBuffer: '',
			fireCooldownRemainingMs: 0
		},
		boss: null,
		bossRules: null,
		enemiesDefeated: 0,
		enemiesDefeatedThisWave: 0,
		reinforcementsThisWave: 0,
		waveSize: 0,
		bossReinforceCooldownSec: 0,
		waveBreatherSec: 0,
		missStreak: 0,
		skillCooldowns: {},
		freezeUntilMs: 0
	};
}

/**
 * Starts a run at `fromWave`. Everything per-run is cleared here,
 * including the cooldowns and player position that used to survive into
 * the next run because only `setupStage` touched them.
 *
 * `fromWave` exists so a run can start somewhere other than the beginning.
 * Nothing in this module decides whether that's allowed - it takes the
 * number it's given.
 */
export function resetRun(state: RuntimeState, profile: PlayerProfile, fromWave = 1): void {
	state.score = 0;
	state.timeRemainingMs = startingTimeMs(profile);
	state.enemiesDefeated = 0;
	state.player.xPct = 50;
	state.player.movingLeft = false;
	state.player.movingRight = false;
	state.skillCooldowns = {};
	state.freezeUntilMs = 0;
	advanceToWave(state, profile, Math.max(1, Math.floor(fromWave)));
}

/**
 * Announces a wave and starts its breather. The formation (or the boss)
 * arrives when that breather runs out, in `openWave` - a wave is an
 * announced event, not something that materialises the instant the last
 * one dies.
 */
export function beginWave(state: RuntimeState, waveNumber: number): void {
	state.waveNumber = waveNumber;
	state.runPhase = isBossWave(waveNumber) ? 'boss' : 'wave';
	state.enemies = [];
	state.boss = null;
	state.bossRules = null;
	state.missStreak = 0;
	state.enemiesDefeatedThisWave = 0;
	state.reinforcementsThisWave = 0;
	state.waveSize = 0;
	state.bossReinforceCooldownSec = 0;
	state.waveBreatherSec = WAVE_BREATHER_SEC;
	gameEvents.emit({ type: 'wave-announced', waveNumber, isBoss: isBossWave(waveNumber) });
}

/**
 * Starts a wave and reports having reached it, so the profile's ceiling on
 * where a run may begin tracks waves *arrived at*. Arriving is the proof
 * the player can get there; surviving is a different question.
 *
 * Kept separate from `beginWave` so tests (and anything that wants to set
 * up a wave without granting progress) can still use the plain version.
 */
function advanceToWave(state: RuntimeState, profile: PlayerProfile, waveNumber: number): void {
	beginWave(state, waveNumber);
	if (waveNumber > profile.highestWaveReached) {
		profile.highestWaveReached = waveNumber;
		gameEvents.emit({ type: 'wave-record', waveNumber });
	}
}

/** The breather has elapsed: send in whatever this wave is. */
function openWave(state: RuntimeState, profile: PlayerProfile): void {
	if (isBossWave(state.waveNumber)) startBossPhase(state, profile);
	else releaseWave(state, profile);
}

/**
 * A wave ends when the board is empty. That always happens: an enemy is
 * either answered or it crosses the impact line and is removed, so there
 * is no state in which a wave can stall forever.
 */
function onWaveCleared(state: RuntimeState, profile: PlayerProfile): void {
	const bonusMs = addRunTime(
		state,
		profile,
		WAVE_CLEAR_BONUS_MS + state.enemiesDefeatedThisWave * WAVE_CLEAR_PER_KILL_BONUS_MS
	);
	gameEvents.emit({
		type: 'wave-cleared',
		waveNumber: state.waveNumber,
		defeated: state.enemiesDefeatedThisWave,
		released: state.waveSize,
		bonusMs
	});
	advanceToWave(state, profile, state.waveNumber + 1);
}

// --- Spawning ---

let uidCounter = 0;

interface SpawnOptions {
	archetype: EnemyArchetypeId;
	xPct: number;
	y: number;
	/** Overrides what this enemy asks. Only boss adds use it, to draw an
	 * easier problem than the fight they arrive in - see `spawnBossAdd`. */
	problem?: ProblemDefinition;
	/** Scales this enemy's fall speed on top of every other factor. Applied
	 * here rather than mutated afterwards, so speed stays composed in exactly
	 * one place (see the note on `GLOBAL_FALL_SPEED_MULTIPLIER`). */
	speedMultiplier?: number;
}

/** Builds one enemy from its archetype. Everything mechanical - sprite,
 * layers, shield, speed - is read from the archetype here and then never
 * looked up again during a hit, so an instance is self-describing. There
 * is no health to initialise: `layersRemaining` is the whole of it. */
function spawnEnemy(
	state: RuntimeState,
	profile: PlayerProfile,
	options: SpawnOptions
): EnemyInstance {
	const archetype = enemyArchetype(options.archetype);
	const problem = options.problem ?? problemForCurrentPhase(state, profile);
	const [minSpeed, maxSpeed] = activeArcadeDifficulty(state).fallSpeed;
	const lane = clampLane(options.xPct);

	const enemy: EnemyInstance = {
		uid: ++uidCounter,
		archetype: archetype.id,
		kind: archetype.sprite,
		mini: archetype.mini,
		problem,
		layersRemaining: archetype.layers,
		layersTotal: archetype.layers,
		shielded: archetype.shielded,
		xPct: lane,
		anchorXPct: lane,
		wavePhase: Math.random(),
		y: options.y,
		speed:
			(options.speedMultiplier ?? 1) *
			randRange(minSpeed, maxSpeed) *
			archetype.speedMultiplier *
			GLOBAL_FALL_SPEED_MULTIPLIER *
			currentEnemySpeedMultiplier(profile),
		frozen: false,
		burnUntilMs: 0
	};
	state.enemies.push(enemy);
	return enemy;
}

function hasRoom(state: RuntimeState): boolean {
	return state.enemies.length < activeArcadeDifficulty(state).maxConcurrent;
}

/**
 * Releases this wave's whole formation at once. No maxConcurrent gate and
 * no deferral: the wave *is* the formation, its size was already capped
 * when `waveSpecFor` built it, and there is no plan position left to
 * silently skip past. `maxConcurrent` still applies to everything that
 * arrives on top of a formation - splits, reinforcements, boss adds.
 */
function releaseWave(state: RuntimeState, profile: PlayerProfile): void {
	const spec = waveSpecFor(state.waveNumber);
	const slots = buildFormation(spec, state.waveNumber);

	for (const slot of slots) {
		spawnEnemy(state, profile, { archetype: slot.archetype, xPct: slot.xPct, y: slot.y });
	}

	state.waveSize = slots.length;
	gameEvents.emit({ type: 'wave-incoming', waveNumber: state.waveNumber, count: slots.length });
}

/**
 * One reinforcement, called in because the player stopped engaging with the
 * boss's maths. It is DELIBERATELY MUCH EASIER than the fight it arrives in,
 * on all three axes that make an enemy hard:
 *
 *  - **Its problem** comes from the easiest rung of the boss's scope, not
 *    from `generateBossProblem`. This is the big one. Adds used to inherit
 *    the boss's own cumulative scope weighted toward its hard end, so a
 *    player already failing the boss's maths was handed more of the same
 *    maths to fail - which made a bad patch unrecoverable rather than
 *    something to climb out of.
 *  - **Its archetype** comes from `BOSS_ADD_LADDER`, which stops short of
 *    bulwark and sentinel.
 *  - **Its speed** is scaled down, so there is time to actually read it.
 *
 * The point of an add is to make disengaging cost something while still
 * offering the player a problem they can answer to dig out.
 */
function spawnBossAdd(state: RuntimeState, profile: PlayerProfile): EnemyInstance {
	const phase = currentBossPhase(state);
	const scope = currentBossRules(state).scope;
	return spawnEnemy(state, profile, {
		archetype: phase.addArchetype,
		xPct: randInt(12, 88),
		y: 0,
		// Ordered easiest-first by contract - see `cumulativeScopeForGrade`.
		problem: generateProblem(scope[0]),
		speedMultiplier: BOSS_ADD_SPEED_MULTIPLIER
	});
}

/**
 * The consequence of the combat layer asking for a reinforcement - the ONLY
 * way an add ever reaches the board during a boss fight now. A level sends
 * in a spore; a boss calls whatever its current phase calls.
 *
 * The two contexts are held back differently, because what a spare enemy
 * costs differs. During a wave it extends the board that has to be cleared
 * before the run can move on, so it's capped per wave. During a boss fight
 * the fight ends on its own clock, so the limit is a cooldown instead: an
 * uncapped boss can afford to keep calling minions, but a player who
 * answers four wrong in a row shouldn't have four arrive at once.
 */
function tryReinforce(state: RuntimeState, profile: PlayerProfile): void {
	if (!hasRoom(state)) return;

	if (state.runPhase === 'boss') {
		if (state.bossReinforceCooldownSec > 0) return;
		const phase = currentBossPhase(state);
		// Floundering through the finale gets them faster, as it always did.
		const multiplier = state.boss?.inFinale ? FINALE_ADD_INTERVAL_MULTIPLIER : 1;
		state.bossReinforceCooldownSec =
			randRange(phase.addInterval[0], phase.addInterval[1]) * multiplier;
	} else {
		if (state.reinforcementsThisWave >= MAX_REINFORCEMENTS_PER_WAVE) return;
		state.reinforcementsThisWave++;
	}

	const spawned =
		state.runPhase === 'boss'
			? spawnBossAdd(state, profile)
			: spawnEnemy(state, profile, { archetype: 'spore', xPct: randInt(12, 88), y: 0 });
	gameEvents.emit({ type: 'reinforcement-spawned', xPct: spawned.xPct });
}

/** Splitter debris. Spawned at the parent's position so the split reads as
 * one thing becoming two, and deliberately not counted as a kill (see the
 * archetype's countsTowardClear) - so it pays no wave-clear share. It still
 * has to leave the board before the wave ends, like anything else. */
function spawnSplit(
	state: RuntimeState,
	profile: PlayerProfile,
	parent: EnemyInstance,
	count: number
): void {
	let spawned = 0;
	for (let i = 0; i < count; i++) {
		if (!hasRoom(state)) break;
		const offset = (i - (count - 1) / 2) * SPLIT_SPREAD_PCT * 2;
		spawnEnemy(state, profile, { archetype: 'spore', xPct: parent.xPct + offset, y: parent.y });
		spawned++;
	}
	if (spawned > 0)
		gameEvents.emit({ type: 'enemy-split', xPct: parent.xPct, y: parent.y, count: spawned });
}

// --- Combat resolution ---

/**
 * `problem` is the one that was ANSWERED, so callers capture it before
 * anything else in the turn can replace it - clearing a layer or breaking
 * a shield both mint a fresh one, and attributing an answer to the
 * problem that replaced it would quietly mis-file every multi-layer
 * enemy's mastery.
 *
 * gameFlow still knows nothing about mastery. It reports what the problem
 * was; whoever cares interprets that, exactly like every other event here.
 */
function emitHitEvent(
	result: AnswerResult,
	problem: ProblemDefinition,
	xPct: number,
	y: number,
	targetId: number | 'boss'
): void {
	const topic = { topicId: problem.topicId, standardCode: problem.standardCode };
	switch (result.verdict) {
		case 'exact':
			gameEvents.emit({ type: 'hit-exact', xPct, y, targetId, ...topic });
			break;
		case 'equivalent':
			gameEvents.emit({ type: 'hit-equivalent', xPct, y, targetId, ...topic });
			break;
		case 'close':
			gameEvents.emit({ type: 'hit-close', xPct, y, targetId, ...topic });
			break;
		case 'partial':
			gameEvents.emit({
				type: 'hit-partial',
				xPct,
				y,
				targetId,
				answerDigits: result.digitMatch?.answerDigits ?? '',
				digitMatches: result.digitMatch?.matches ?? [],
				...topic
			});
			break;
		case 'incorrect':
			gameEvents.emit({ type: 'hit-incorrect', xPct, y, targetId, ...topic });
			break;
		case 'invalid':
			gameEvents.emit({ type: 'hit-invalid', xPct, y, targetId, ...topic });
			break;
	}
}

/** Pays currency and reports what was actually paid, so a caller can put
 * the real figure in front of the player rather than the nominal one. */
function awardCurrency(profile: PlayerProfile, multiplier = 1): number {
	const amount = Math.max(
		1,
		Math.round((BASE_CURRENCY_PER_KILL + currentBountyBonus(profile)) * multiplier)
	);
	profile.currency += amount;
	// The monotone counterpart. `currency` is a balance and goes down when
	// the player spends; `earnedTotal` only ever rises, which is what makes
	// reconciling two copies of a profile possible at all - `max` means
	// something on a total and nothing on a balance.
	profile.earnedTotal += amount;
	gameEvents.emit({ type: 'currency-earned', amount, total: profile.currency });
	return amount;
}

/** What this wave's boss is worth, in ordinary-kill equivalents. Grows with
 * the boss ordinal rather than the raw wave number so it steps once per
 * fight instead of drifting between them. */
function bossBountyMultiplier(waveNumber: number): number {
	const ordinal = Math.max(1, bossOrdinal(waveNumber));
	return BOSS_BOUNTY_MULTIPLIER + (ordinal - 1) * BOSS_BOUNTY_MULTIPLIER_PER_FIGHT;
}

function destroyEnemy(state: RuntimeState, profile: PlayerProfile, enemy: EnemyInstance): void {
	const archetype = enemyArchetype(enemy.archetype);
	state.enemies = state.enemies.filter((e) => e.uid !== enemy.uid);
	state.score += Math.round(10 * archetype.bountyMultiplier);
	awardCurrency(profile, archetype.bountyMultiplier);
	gameEvents.emit({ type: 'enemy-defeated', xPct: enemy.xPct, y: enemy.y, kind: enemy.kind });

	if (archetype.splitsInto > 0) spawnSplit(state, profile, enemy, archetype.splitsInto);

	// Purely a tally now. What used to happen here - hitting a quota and
	// starting the boss - is a wave count instead, so a kill no longer
	// decides where the run goes next.
	if (archetype.countsTowardClear) {
		state.enemiesDefeated++;
		if (state.runPhase === 'wave') state.enemiesDefeatedThisWave++;
	}
}

function applyHitToEnemy(
	state: RuntimeState,
	profile: PlayerProfile,
	enemy: EnemyInstance,
	result: AnswerResult
): { defeated: boolean } {
	// Captured before resolution: breaking a shield replaces enemy.problem
	// a few lines below, and a cleared non-final layer mints another one.
	const answered = enemy.problem;
	const outcome = resolveGruntHit(result, enemy, state.missStreak);
	state.missStreak = outcome.missStreak;

	if (outcome.blocked) {
		// Show the shield, not the verdict - the answer never reached the
		// enemy, so reporting it as a hit or a miss would both be wrong.
		gameEvents.emit({ type: 'shield-blocked', xPct: enemy.xPct, y: enemy.y, targetId: enemy.uid });
	} else if (outcome.shieldBroken) {
		enemy.shielded = false;
		enemy.problem = problemForCurrentPhase(state, profile);
		gameEvents.emit({ type: 'shield-broken', xPct: enemy.xPct, y: enemy.y, targetId: enemy.uid });
	} else {
		emitHitEvent(result, answered, enemy.xPct, enemy.y, enemy.uid);

		if (outcome.knockbackPct > 0) {
			enemy.y = Math.max(KNOCKBACK_CEILING_Y_PCT, enemy.y - outcome.knockbackPct);
			gameEvents.emit({
				type: 'enemy-knockback',
				xPct: enemy.xPct,
				y: enemy.y,
				amountPct: outcome.knockbackPct
			});
		}

		// Burn is earned by any answer that actually reached the enemy, not
		// just a layer-clearing one - a close answer is still a hit landing.
		if (outcome.layerBroken || outcome.knockbackPct > 0) {
			const burn = currentEffect(findBaseSkillNode('burn')!, profile.skillProgress);
			if (burn.kind === 'burn' && burn.chance > 0 && Math.random() < burn.chance) {
				enemy.burnUntilMs = performance.now() + burn.durationSec * 1000;
			}
		}

		if (outcome.layerBroken && !outcome.defeated) {
			enemy.layersRemaining -= 1;
			enemy.problem = problemForCurrentPhase(state, profile);
			gameEvents.emit({
				type: 'enemy-layer-broken',
				xPct: enemy.xPct,
				y: enemy.y,
				layersRemaining: enemy.layersRemaining
			});
		}
	}

	if (outcome.defeated) destroyEnemy(state, profile, enemy);
	if (outcome.reinforce) tryReinforce(state, profile);
	return { defeated: outcome.defeated };
}

function resolveEnemyShot(
	state: RuntimeState,
	profile: PlayerProfile,
	primary: EnemyInstance,
	result: AnswerResult
): void {
	const primaryXPct = primary.xPct;
	const primaryY = primary.y;
	const { defeated } = applyHitToEnemy(state, profile, primary, result);

	if (defeated && result.verdict === 'exact' && Math.random() < currentPierceChance(profile)) {
		const next = state.enemies
			.filter((e) => Math.abs(e.xPct - primaryXPct) <= ALIGNMENT_TOLERANCE_PCT && e.y < primaryY)
			.sort((a, b) => b.y - a.y)[0];
		if (next) applyHitToEnemy(state, profile, next, result);
	}
}

// --- Boss phase ---

/**
 * Shortens the survive clock, but never below the time still owed to the
 * fight's minimum duration.
 *
 * A boss is the point of a run, and one that flashes past in twelve seconds
 * isn't an event. So a good answer COMPRESSES a fight rather than skipping
 * it: `progress` still moves on every cut, which means a strong player
 * walks the whole phase ladder inside the minimum window instead of seeing
 * only the opening phase.
 *
 * It also keeps the mastery route reachable. Cuts used to race the player
 * into the endurance ending - each exact answer took 2.6s off the clock on
 * top of the seconds spent thinking, so stringing together the combo was
 * arithmetically impossible at every wave (measured: 0% mastery rate for
 * every modelled player). The floor is what leaves room to finish a combo.
 *
 * The combo itself is deliberately exempt: reaching `comboRequired` ends
 * the fight immediately whatever the floor says.
 */
function cutSurviveClock(boss: BossState, amountMs: number): void {
	if (amountMs <= 0) return;
	const owedMs = Math.max(0, boss.minFightMs - boss.elapsedMs);
	boss.surviveRemainingMs = Math.max(owedMs, boss.surviveRemainingMs - amountMs);
	boss.progress = 1 - boss.surviveRemainingMs / boss.surviveTotalMs;
}

function refreshBossProblem(state: RuntimeState): void {
	const boss = state.boss!;
	const rules = currentBossRules(state);
	boss.problem = boss.inFinale
		? buildAuthoredProblem(rules.finaleProblem)
		: generateBossProblem(rules.scope, boss.progress, rules.scopeBias);
}

function rollWeakPointOffset(): number {
	const magnitude = randRange(WEAK_POINT_MIN_OFFSET_PCT, WEAK_POINT_MAX_OFFSET_PCT);
	return Math.random() < 0.5 ? -magnitude : magnitude;
}

function raiseBossShield(state: RuntimeState, phase: BossPhase): void {
	const boss = state.boss!;
	boss.vulnerable = false;
	boss.stateRemainingMs = phase.shieldedSec * 1000;
	boss.weakPointOffsetPct = rollWeakPointOffset();
	gameEvents.emit({ type: 'boss-shield-raised', weakPointXPct: weakPointXPct(boss) });
}

function dropBossShield(state: RuntimeState, phase: BossPhase): void {
	const boss = state.boss!;
	boss.vulnerable = true;
	boss.stateRemainingMs = phase.vulnerableSec * 1000;
	gameEvents.emit({ type: 'boss-shield-dropped' });
}

function enterBossPhase(state: RuntimeState, phaseIndex: number): void {
	const boss = state.boss!;
	const phase = currentBossRules(state).phases[phaseIndex];
	boss.phaseIndex = phaseIndex;
	boss.driftSpeed = phase.driftSpeed;
	// Every phase opens with the boss exposed, so a phase change is a
	// window rather than an ambush.
	boss.vulnerable = true;
	boss.stateRemainingMs = phase.vulnerableSec * 1000;
	gameEvents.emit({ type: 'boss-phase-changed', phaseIndex, name: phase.name });
}

/** Builds the fight for this wave and starts it. The rules are generated
 * from the wave number rather than read off a level, and stored on the run
 * because there's nowhere else for them to live. */
function startBossPhase(state: RuntimeState, profile: PlayerProfile): void {
	const rules = bossRulesFor(
		state.waveNumber,
		bossScopeForWave(bossScope(profile), state.waveNumber)
	);
	state.runPhase = 'boss';
	state.bossRules = rules;
	state.enemies = [];
	state.missStreak = 0;
	state.waveSize = 0;

	const surviveTotalMs = rules.surviveSec * 1000;
	const openingPhase = rules.phases[0];
	state.boss = {
		name: rules.name,
		sprite: rules.sprite,
		surviveRemainingMs: surviveTotalMs,
		surviveTotalMs,
		elapsedMs: 0,
		minFightMs: bossMinFightSec(state.waveNumber) * 1000,
		combo: 0,
		comboRequired: rules.comboToDefeat,
		bestCombo: 0,
		phaseIndex: 0,
		vulnerable: true,
		stateRemainingMs: openingPhase.vulnerableSec * 1000,
		weakPointOffsetPct: 0,
		xPct: 50,
		driftDirection: 1,
		driftSpeed: openingPhase.driftSpeed,
		problem: generateBossProblem(rules.scope, 0, rules.scopeBias),
		progress: 0,
		missStreak: 0,
		inFinale: false,
		defeatedBy: null
	};
	// Ready from the first shot: the boss calls nothing in until the player
	// gives it a reason to, so there is no opening delay to schedule.
	state.bossReinforceCooldownSec = 0;
	gameEvents.emit({ type: 'boss-phase-changed', phaseIndex: 0, name: openingPhase.name });
}

/**
 * Ends a boss fight, either way it was won.
 *
 * ONLY THE MASTERY ROUTE PAYS. Outlasting the survive clock is escaping a
 * boss, not defeating it - the player never answered it down, so there is
 * nothing to reward. Both the bounty and the clock bonus are gated on the
 * combo, which makes the half-minute spent on a boss you couldn't answer
 * the whole cost of not answering it. There is deliberately no *extra*
 * penalty on top: the run moves on either way, and the lost payout is
 * punishment enough for a child.
 *
 * Bounty and time both come back from the calls that granted them rather
 * than being reported nominally - the clock has a ceiling that can swallow
 * a payout whole, and the banner must not promise what the player didn't
 * get.
 */
function onBossDefeated(
	state: RuntimeState,
	profile: PlayerProfile,
	cause: 'survival' | 'mastery'
): void {
	const boss = state.boss!;
	boss.defeatedBy = cause;

	let bountyEarned = 0;
	let timeBonusMs = 0;
	if (cause === 'mastery') {
		state.score += MASTERY_SCORE_BONUS;
		bountyEarned = awardCurrency(
			profile,
			bossBountyMultiplier(state.waveNumber) + MASTERY_BOUNTY_MULTIPLIER
		);
		timeBonusMs = addRunTime(state, profile, BOSS_CLEAR_BONUS_MS);
	}

	state.enemies = [];
	gameEvents.emit({
		type: 'boss-defeated',
		by: cause,
		bestCombo: Math.max(boss.bestCombo, boss.combo),
		waveNumber: state.waveNumber,
		bountyEarned,
		timeBonusMs
	});
	state.boss = null;
	state.bossRules = null;
	// Straight on to the next wave. No stage-clear screen, no Continue
	// button, no victory - the run only ends when the clock does.
	advanceToWave(state, profile, state.waveNumber + 1);
}

/**
 * One answer aimed at the boss - at its body, or at the weak point its
 * shield exposes. Damage bookkeeping is gone entirely: what a good answer
 * buys is time off the survive clock and a step along the combo, either of
 * which can end the fight.
 */
function resolveBossShot(
	state: RuntimeState,
	profile: PlayerProfile,
	result: AnswerResult,
	atWeakPoint: boolean
): void {
	const boss = state.boss!;
	const fxX = atWeakPoint ? weakPointXPct(boss) : boss.xPct;
	const outcome = resolveBossAnswer(
		result,
		{ comboRequired: boss.comboRequired, vulnerable: boss.vulnerable },
		boss.combo,
		boss.missStreak,
		atWeakPoint
	);
	boss.missStreak = outcome.missStreak;

	if (outcome.blocked) {
		gameEvents.emit({ type: 'shield-blocked', xPct: fxX, y: BOSS_FX_Y_PCT, targetId: 'boss' });
		if (outcome.reinforce) tryReinforce(state, profile);
		return;
	}

	emitHitEvent(result, boss.problem, fxX, BOSS_FX_Y_PCT, 'boss');

	if (outcome.shieldBroken) {
		dropBossShield(state, currentBossPhase(state));
		gameEvents.emit({ type: 'shield-broken', xPct: fxX, y: BOSS_FX_Y_PCT, targetId: 'boss' });
	}

	if (outcome.comboBroken) gameEvents.emit({ type: 'boss-combo-broken', lostCombo: boss.combo });
	boss.combo = outcome.combo;
	boss.bestCombo = Math.max(boss.bestCombo, boss.combo);
	if (boss.combo > 0)
		gameEvents.emit({ type: 'boss-combo', combo: boss.combo, required: boss.comboRequired });

	if (outcome.surviveCutMs > 0) {
		const before = boss.surviveRemainingMs;
		cutSurviveClock(boss, outcome.surviveCutMs);
		state.score += BOSS_ANSWER_SCORE;
		gameEvents.emit({
			type: 'boss-timer-cut',
			// What the cut actually took, not what it offered - the minimum-
			// duration floor can absorb it, and the HUD must not count down time
			// the fight didn't lose.
			amountMs: before - boss.surviveRemainingMs,
			remainingMs: boss.surviveRemainingMs
		});
	}

	if (outcome.masteryAchieved) {
		onBossDefeated(state, profile, 'mastery');
		return;
	}
	if (boss.surviveRemainingMs <= 0) {
		onBossDefeated(state, profile, 'survival');
		return;
	}

	if (outcome.surviveCutMs > 0) refreshBossProblem(state);
	if (outcome.reinforce) tryReinforce(state, profile);
}

// --- Firing & skills ---

function applyFireCooldown(state: RuntimeState, profile: PlayerProfile): void {
	state.player.fireCooldownRemainingMs = currentFireCooldownSec(profile) * 1000;
}

function fire(state: RuntimeState, profile: PlayerProfile): void {
	if (state.player.fireCooldownRemainingMs > 0 || !state.player.inputBuffer) return;

	const guess = state.player.inputBuffer;
	const target = resolveTarget(state.player, state.enemies, state.boss);
	gameEvents.emit({ type: 'shot-fired', guessText: guess, xPct: state.player.xPct });
	state.player.inputBuffer = '';
	applyFireCooldown(state, profile);

	switch (target.kind) {
		case 'none':
			return;
		case 'boss':
			resolveBossShot(state, profile, evaluateAnswer(guess, state.boss!.problem), false);
			return;
		case 'boss-weak-point':
			resolveBossShot(state, profile, evaluateAnswer(guess, state.boss!.problem), true);
			return;
		case 'enemy':
			// Boss adds are ordinary enemies now: they threaten the clock, but
			// shooting one is no longer a backdoor into damaging the boss.
			resolveEnemyShot(state, profile, target.enemy, evaluateAnswer(guess, target.enemy.problem));
			return;
	}
}

function applyBomb(state: RuntimeState, profile: PlayerProfile, layersStripped: number): void {
	if (state.runPhase === 'boss' && state.boss) {
		const boss = state.boss;
		const cleared = state.enemies.length;
		state.enemies = [];
		for (let i = 0; i < cleared; i++) awardCurrency(profile, 0.5);

		if (cleared > 0) {
			const before = boss.surviveRemainingMs;
			cutSurviveClock(boss, cleared * BOMB_BOSS_CUT_PER_ADD_MS);
			gameEvents.emit({
				type: 'boss-timer-cut',
				amountMs: before - boss.surviveRemainingMs,
				remainingMs: boss.surviveRemainingMs
			});
		}
		if (boss.surviveRemainingMs <= 0) onBossDefeated(state, profile, 'survival');
		return;
	}

	// A bomb answers layers outright rather than dealing damage to them. It
	// strips a fixed number, so a multi-layer enemy can survive one with a
	// fresh problem - which is what makes those enemies the answer to a
	// bomb-heavy playstyle.
	for (const enemy of [...state.enemies]) {
		if (enemy.shielded) continue;

		if (enemy.layersRemaining > layersStripped) {
			enemy.layersRemaining -= layersStripped;
			enemy.problem = problemForCurrentPhase(state, profile);
			gameEvents.emit({
				type: 'enemy-layer-broken',
				xPct: enemy.xPct,
				y: enemy.y,
				layersRemaining: enemy.layersRemaining
			});
		} else {
			destroyEnemy(state, profile, enemy);
		}
	}
}

function useSkill(state: RuntimeState, profile: PlayerProfile, skillId: string): void {
	if (skillId !== 'bomb' && skillId !== 'freeze') return;
	const node = findBaseSkillNode(skillId);
	if (!node) return;
	if ((state.skillCooldowns[skillId] ?? 0) > 0) return;
	const effect = currentEffect(node, profile.skillProgress);

	if (skillId === 'freeze' && effect.kind === 'freeze') {
		if (effect.durationSec <= 0) return; // level 0 - not yet purchased
		state.freezeUntilMs = performance.now() + effect.durationSec * 1000;
		state.skillCooldowns.freeze = effect.cooldownSec * 1000;
		gameEvents.emit({ type: 'skill-used', skill: 'freeze' });
	} else if (skillId === 'bomb' && effect.kind === 'bomb') {
		if (effect.layersStripped <= 0) return; // level 0 - not yet purchased
		applyBomb(state, profile, effect.layersStripped);
		state.skillCooldowns.bomb = effect.cooldownSec * 1000;
		gameEvents.emit({ type: 'skill-used', skill: 'bomb' });
	}
}

export function handleInputAction(
	state: RuntimeState,
	profile: PlayerProfile,
	action: InputAction
): void {
	if (state.timeRemainingMs <= 0) return;
	switch (action.type) {
		case 'move':
			if (action.direction === 'left') state.player.movingLeft = action.pressed;
			else state.player.movingRight = action.pressed;
			break;
		case 'moveTo':
			state.player.xPct = Math.max(4, Math.min(96, action.xPct));
			break;
		case 'digit':
			if (state.player.inputBuffer.length < 6) state.player.inputBuffer += action.digit;
			break;
		case 'backspace':
			state.player.inputBuffer = state.player.inputBuffer.slice(0, -1);
			break;
		case 'fire':
			fire(state, profile);
			break;
		case 'skill':
			useSkill(state, profile, action.skill);
			break;
	}
}

// --- Tick ---

function updatePlayerMovement(state: RuntimeState, profile: PlayerProfile, dt: number): void {
	const speed = currentPlayerSpeed(profile);
	if (state.player.movingLeft && !state.player.movingRight) {
		state.player.xPct = Math.max(4, state.player.xPct - speed * dt);
	} else if (state.player.movingRight && !state.player.movingLeft) {
		state.player.xPct = Math.min(96, state.player.xPct + speed * dt);
	}
}

function updateCooldowns(state: RuntimeState, dt: number): void {
	if (state.player.fireCooldownRemainingMs > 0) {
		state.player.fireCooldownRemainingMs = Math.max(
			0,
			state.player.fireCooldownRemainingMs - dt * 1000
		);
	}
	for (const id of Object.keys(state.skillCooldowns)) {
		if (state.skillCooldowns[id] > 0) {
			state.skillCooldowns[id] = Math.max(0, state.skillCooldowns[id] - dt * 1000);
		}
	}
}

function updateEnemyMovement(
	state: RuntimeState,
	profile: PlayerProfile,
	dt: number,
	frozen: boolean
): void {
	const now = performance.now();
	const burn = currentEffect(findBaseSkillNode('burn')!, profile.skillProgress);
	const slowMultiplier = burn.kind === 'burn' ? burn.slowMultiplier : 1;

	for (const enemy of state.enemies) {
		enemy.frozen = frozen;
		if (frozen) continue;
		const burning = now < enemy.burnUntilMs;
		const moved = stepMovement({
			movement: enemyArchetype(enemy.archetype).movement,
			y: enemy.y,
			anchorXPct: enemy.anchorXPct,
			wavePhase: enemy.wavePhase,
			speed: enemy.speed * (burning ? slowMultiplier : 1),
			dtSec: dt
		});
		enemy.y = moved.y;
		enemy.xPct = moved.xPct;
	}
}

/**
 * Adds time to the run clock, capped. Every payout goes through here so the
 * cap can't be bypassed by a new one forgetting about it.
 *
 * Returns what was actually granted, which is less than `amountMs` once the
 * clock is near the cap - the caller reports that rather than the nominal
 * figure, so the HUD never promises time the player didn't get.
 */
function addRunTime(state: RuntimeState, profile: PlayerProfile, amountMs: number): number {
	if (amountMs <= 0) return 0;
	const granted = Math.min(amountMs, maxTimeMs(profile) - state.timeRemainingMs);
	if (granted <= 0) return 0;
	state.timeRemainingMs += granted;
	gameEvents.emit({ type: 'time-gained', amountMs: granted, remainingMs: state.timeRemainingMs });
	return granted;
}

/**
 * Dodge is a full negation (triggers -> no time lost at all). Armor only
 * reduces the penalty's *magnitude* when it lands - the two are
 * independent mechanics now, not combined into one avoidance roll.
 */
function handleSingleImpact(state: RuntimeState, profile: PlayerProfile): void {
	if (Math.random() < currentDodgeChance(profile)) {
		gameEvents.emit({ type: 'impact-avoided' });
		return;
	}
	const penalty = BASE_IMPACT_TIME_PENALTY_MS * (1 - currentArmorReduction(profile));
	state.timeRemainingMs = Math.max(0, state.timeRemainingMs - penalty);
	gameEvents.emit({ type: 'time-lost', amountMs: penalty, remainingMs: state.timeRemainingMs });
	if (state.timeRemainingMs <= 0) gameEvents.emit({ type: 'game-over' });
}

function handleImpacts(state: RuntimeState, profile: PlayerProfile): void {
	const landed = state.enemies.filter((e) => e.y >= IMPACT_LINE_PCT);
	if (!landed.length) return;
	for (const _enemy of landed) {
		// Stop the moment the clock is gone. Several enemies can cross the
		// line on one frame, and without this each of the rest would emit
		// another `game-over` on an already-empty clock.
		if (state.timeRemainingMs <= 0) break;
		handleSingleImpact(state, profile);
	}
	state.enemies = state.enemies.filter((e) => e.y < IMPACT_LINE_PCT);
}

function updateWavePhase(
	state: RuntimeState,
	profile: PlayerProfile,
	dt: number,
	frozen: boolean
): void {
	updateEnemyMovement(state, profile, dt, frozen);
	// Waves are discrete: an empty board IS the end of the wave. Nothing
	// else releases enemies while one is running, so there's no ambiguity
	// about which wave just ended.
	if (state.enemies.length === 0) onWaveCleared(state, profile);
}

function updateBossDrift(state: RuntimeState, dt: number): void {
	const boss = state.boss!;
	boss.xPct += boss.driftDirection * boss.driftSpeed * dt;
	if (boss.xPct > 90) {
		boss.xPct = 90;
		boss.driftDirection = -1;
	} else if (boss.xPct < 10) {
		boss.xPct = 10;
		boss.driftDirection = 1;
	}
}

function startBossFinale(state: RuntimeState): void {
	const boss = state.boss!;
	boss.inFinale = true;
	boss.vulnerable = true;
	state.enemies = [];
	boss.problem = buildAuthoredProblem(currentBossRules(state).finaleProblem);
	gameEvents.emit({ type: 'boss-finale-started' });
}

function updateBossPhase(
	state: RuntimeState,
	profile: PlayerProfile,
	dt: number,
	frozen: boolean
): void {
	const boss = state.boss!;
	const rules = currentBossRules(state);
	updateEnemyMovement(state, profile, dt, frozen);

	// The survive clock runs regardless of Freeze - freezing the adds is
	// meant to buy breathing room, not to stall the fight it's meant to win.
	//
	// `elapsedMs` advances from the tick ALONE. It is what the minimum-
	// duration floor measures against, so a timer cut must never touch it.
	boss.elapsedMs += dt * 1000;
	boss.surviveRemainingMs = Math.max(0, boss.surviveRemainingMs - dt * 1000);
	boss.progress = 1 - boss.surviveRemainingMs / boss.surviveTotalMs;

	const nextPhase = phaseIndexForProgress(rules.phases, boss.progress);
	if (nextPhase !== boss.phaseIndex) enterBossPhase(state, nextPhase);
	const phase = currentBossPhase(state);

	if (
		!boss.inFinale &&
		boss.surviveRemainingMs <= boss.surviveTotalMs * FINALE_REMAINING_THRESHOLD
	) {
		startBossFinale(state);
	}

	// Shields never cycle during the finale - the boss is committed and
	// fully exposed for the last stretch.
	if (!boss.inFinale && phase.shieldedSec > 0) {
		boss.stateRemainingMs -= dt * 1000;
		if (boss.stateRemainingMs <= 0) {
			if (boss.vulnerable) raiseBossShield(state, phase);
			else dropBossShield(state, phase);
		}
	}

	if (!frozen) updateBossDrift(state, dt);

	// No timed add stream. A boss calls in reinforcements ONLY when the
	// player has stopped engaging with its maths (see `tryReinforce`), so a
	// player answering well - even nearly - fights it on an empty screen.
	// This only counts the cooldown down; nothing spawns from here.
	state.bossReinforceCooldownSec = Math.max(0, state.bossReinforceCooldownSec - dt);

	if (boss.surviveRemainingMs <= 0) onBossDefeated(state, profile, 'survival');
}

/** Advances the simulation by dtSec. Does nothing once the clock has run
 * out - callers are expected to stop invoking tick() on game-over, but
 * this makes that a safety property, not just a convention. */
export function tick(state: RuntimeState, profile: PlayerProfile, dtSec: number): void {
	if (state.timeRemainingMs <= 0) return;

	state.timeRemainingMs = Math.max(0, state.timeRemainingMs - dtSec * 1000);
	if (state.timeRemainingMs <= 0) {
		gameEvents.emit({ type: 'game-over' });
		return;
	}

	updatePlayerMovement(state, profile, dtSec);
	updateCooldowns(state, dtSec);
	const frozen = performance.now() < state.freezeUntilMs;

	// The breather runs ahead of both kinds of wave, and the board is empty
	// while it does - so nothing else needs to happen this frame.
	if (state.waveBreatherSec > 0) {
		state.waveBreatherSec -= dtSec;
		if (state.waveBreatherSec <= 0) openWave(state, profile);
		return;
	}

	if (state.runPhase === 'wave') updateWavePhase(state, profile, dtSec, frozen);
	else if (state.boss) updateBossPhase(state, profile, dtSec, frozen);

	handleImpacts(state, profile);
}
