import type { RuntimeState, EnemyInstance } from './RuntimeState';
import type { PlayerProfile } from './PlayerProfile';
import type { BossPhase, Curriculum } from '../levels/LevelDefinition';
import type { EnemyArchetypeId } from '../levels/enemyArchetypes';
import type { ProblemDefinition } from '../math/ProblemDefinition';
import type { AnswerResult } from '../math/evaluator';
import type { InputAction } from '../input/InputManager';

import { GAME_LEVELS } from '../levels/gameLevels';
import { phaseIndexForProgress } from '../levels/LevelDefinition';
import { enemyArchetype, stepMovement, clampLane, GLOBAL_FALL_SPEED_MULTIPLIER } from '../levels/enemyArchetypes';
import { buildFormation, waveAt, nextWaveIndex } from '../levels/waves';
import { generateProblem, generateBossProblem, buildAuthoredProblem } from '../levels/problemGenerators';
import { evaluateAnswer } from '../math/evaluator';
import { resolveGruntHit, resolveBossAnswer } from '../combat';
import { resolveTarget, ALIGNMENT_TOLERANCE_PCT, weakPointXPct } from '../targeting';
import { gameEvents } from '../events';
import { currentEffect } from '../skills/SkillTree';
import { findBaseSkillNode } from '../skills/baseSkillTree';

// Must match GameCanvas.svelte's own IMPACT_LINE_PCT constant.
const IMPACT_LINE_PCT = 86;
// Likewise its BOSS_Y_PCT - where boss hit effects should appear.
const BOSS_FX_Y_PCT = 12;
const BASE_TIMER_MS = 30000;
const BASE_IMPACT_TIME_PENALTY_MS = 5000;
const BASE_CURRENCY_PER_KILL = 5;
const BASE_PLAYER_SPEED_PCT_PER_SEC = 55;

/** Delay before a stage's first wave, so the countdown doesn't hand the
 * player a formation already halfway down the screen. */
const OPENING_WAVE_DELAY_SEC = 1.2;
/** How long to wait before retrying a wave that couldn't be released
 * because the screen was already at maxConcurrent. */
const WAVE_RETRY_DELAY_SEC = 0.7;
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
 * and it pays like one. */
const MASTERY_SCORE_BONUS = 250;
const MASTERY_CURRENCY_BONUS = 40;
/** Score for a good answer against a boss - bosses award no per-kill
 * score of their own, so this is the fight's whole scoring surface. */
const BOSS_ANSWER_SCORE = 15;
/** Each add a bomb clears during a boss fight is worth this much off the
 * survive clock. */
const BOMB_BOSS_CUT_PER_ADD_MS = 1200;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function currentLevel(state: RuntimeState) {
  return GAME_LEVELS[state.stageIndex];
}
function currentBossRules(state: RuntimeState) {
  return currentLevel(state).boss!;
}
function currentBossPhase(state: RuntimeState): BossPhase {
  return currentBossRules(state).phases[state.boss!.phaseIndex];
}

/** Which arcade knobs apply right now - a boss fight governs its adds with
 * its own difficulty block rather than the level's. */
function activeArcadeDifficulty(state: RuntimeState) {
  return state.stagePhase === 'boss' ? currentBossRules(state).arcadeDifficulty : currentLevel(state).arcadeDifficulty;
}

/** Where a newly spawned or re-layered enemy's problem comes from. During
 * a boss fight even the adds draw from the boss's cumulative scope, so
 * the whole fight reviews everything learned so far. */
function problemForCurrentPhase(state: RuntimeState): ProblemDefinition {
  if (state.stagePhase === 'boss' && state.boss) {
    return generateBossProblem(currentBossRules(state).scope, state.boss.progress);
  }
  return generateProblem(currentLevel(state).curriculum);
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

// --- Setup ---

export function createInitialRuntimeState(): RuntimeState {
  return {
    stageIndex: 0,
    stagePhase: 'level',
    score: 0,
    timeRemainingMs: BASE_TIMER_MS,
    enemies: [],
    player: { xPct: 50, movingLeft: false, movingRight: false, inputBuffer: '', fireCooldownRemainingMs: 0 },
    boss: null,
    enemiesDefeated: 0,
    spawnTimer: 0,
    waveIndex: 0,
    missStreak: 0,
    skillCooldowns: {},
    freezeUntilMs: 0,
  };
}

export function resetRun(state: RuntimeState, profile: PlayerProfile): void {
  state.score = 0;
  state.timeRemainingMs = startingTimeMs(profile);
  setupStage(state, 0);
}

export function setupStage(state: RuntimeState, stageIndex: number): void {
  state.stageIndex = stageIndex;
  state.stagePhase = 'level';
  state.enemies = [];
  state.boss = null;
  state.enemiesDefeated = 0;
  state.missStreak = 0;
  state.player.inputBuffer = '';
  state.player.fireCooldownRemainingMs = 0;
  state.waveIndex = 0;
  state.spawnTimer = OPENING_WAVE_DELAY_SEC;
  gameEvents.emit({ type: 'level-started', stageId: currentLevel(state).id });
}

/** Called by the Svelte layer once the player dismisses a "stage clear"
 * screen - gameFlow itself never auto-advances, so that pause is always
 * player-driven. */
export function advanceToNextStage(state: RuntimeState): void {
  setupStage(state, state.stageIndex + 1);
}

// --- Spawning ---

let uidCounter = 0;

interface SpawnOptions {
  archetype: EnemyArchetypeId;
  xPct: number;
  y: number;
  curriculum?: Curriculum;
}

/** Builds one enemy from its archetype. Everything mechanical - sprite,
 * layers, shield, speed - is read from the archetype here and then never
 * looked up again during a hit, so an instance is self-describing. There
 * is no health to initialise: `layersRemaining` is the whole of it. */
function spawnEnemy(state: RuntimeState, profile: PlayerProfile, options: SpawnOptions): EnemyInstance {
  const archetype = enemyArchetype(options.archetype);
  const problem = options.curriculum ? generateProblem(options.curriculum) : problemForCurrentPhase(state);
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
      randRange(minSpeed, maxSpeed) *
      archetype.speedMultiplier *
      GLOBAL_FALL_SPEED_MULTIPLIER *
      currentEnemySpeedMultiplier(profile),
    frozen: false,
    burnUntilMs: 0,
  };
  state.enemies.push(enemy);
  return enemy;
}

function hasRoom(state: RuntimeState): boolean {
  return state.enemies.length < activeArcadeDifficulty(state).maxConcurrent;
}

/**
 * Releases the next authored wave. A wave is all-or-most-of-it at once -
 * that's what makes it read as a formation rather than a trickle - but it
 * still respects maxConcurrent, and defers rather than advancing the plan
 * when the screen is already full, so a backed-up player never silently
 * skips content.
 */
function releaseWave(state: RuntimeState, profile: PlayerProfile): void {
  const level = currentLevel(state);
  if (!hasRoom(state)) {
    state.spawnTimer = WAVE_RETRY_DELAY_SEC;
    return;
  }

  const spec = waveAt(level.waves, state.waveIndex);
  const slots = buildFormation(spec, state.waveIndex);
  let released = 0;
  for (const slot of slots) {
    if (!hasRoom(state)) break;
    spawnEnemy(state, profile, { archetype: slot.archetype, xPct: slot.xPct, y: slot.y, curriculum: level.curriculum });
    released++;
  }

  gameEvents.emit({ type: 'wave-incoming', index: state.waveIndex, count: released });
  state.waveIndex = nextWaveIndex(level.waves, state.waveIndex);
  state.spawnTimer = spec.gapSec;
}

function spawnBossAdd(state: RuntimeState, profile: PlayerProfile): EnemyInstance {
  const phase = currentBossPhase(state);
  return spawnEnemy(state, profile, { archetype: phase.addArchetype, xPct: randInt(12, 88), y: 0 });
}

/** The consequence of the combat layer asking for a reinforcement. What
 * arrives depends on where we are: a level sends in a spore, a boss calls
 * whatever its current phase calls. */
function tryReinforce(state: RuntimeState, profile: PlayerProfile): void {
  if (!hasRoom(state)) return;
  const spawned =
    state.stagePhase === 'boss'
      ? spawnBossAdd(state, profile)
      : spawnEnemy(state, profile, { archetype: 'spore', xPct: randInt(12, 88), y: 0 });
  gameEvents.emit({ type: 'reinforcement-spawned', xPct: spawned.xPct });
}

/** Splitter debris. Spawned at the parent's position so the split reads as
 * one thing becoming two, and deliberately not counted toward the level
 * quota (see the archetype's countsTowardClear). */
function spawnSplit(state: RuntimeState, profile: PlayerProfile, parent: EnemyInstance, count: number): void {
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    if (!hasRoom(state)) break;
    const offset = (i - (count - 1) / 2) * SPLIT_SPREAD_PCT * 2;
    spawnEnemy(state, profile, { archetype: 'spore', xPct: parent.xPct + offset, y: parent.y });
    spawned++;
  }
  if (spawned > 0) gameEvents.emit({ type: 'enemy-split', xPct: parent.xPct, y: parent.y, count: spawned });
}

// --- Combat resolution ---

function emitHitEvent(result: AnswerResult, xPct: number, y: number, targetId: number | 'boss'): void {
  switch (result.verdict) {
    case 'exact':
      gameEvents.emit({ type: 'hit-exact', xPct, y, targetId });
      break;
    case 'equivalent':
      gameEvents.emit({ type: 'hit-equivalent', xPct, y, targetId });
      break;
    case 'close':
      gameEvents.emit({ type: 'hit-close', xPct, y, targetId });
      break;
    case 'partial':
      gameEvents.emit({
        type: 'hit-partial',
        xPct,
        y,
        targetId,
        answerDigits: result.digitMatch?.answerDigits ?? '',
        digitMatches: result.digitMatch?.matches ?? [],
      });
      break;
    case 'incorrect':
      gameEvents.emit({ type: 'hit-incorrect', xPct, y, targetId });
      break;
    case 'invalid':
      gameEvents.emit({ type: 'hit-invalid', xPct, y, targetId });
      break;
  }
}

function awardCurrency(profile: PlayerProfile, multiplier = 1): void {
  const amount = Math.max(1, Math.round((BASE_CURRENCY_PER_KILL + currentBountyBonus(profile)) * multiplier));
  profile.currency += amount;
  gameEvents.emit({ type: 'currency-earned', amount, total: profile.currency });
}

function destroyEnemy(state: RuntimeState, profile: PlayerProfile, enemy: EnemyInstance): void {
  const archetype = enemyArchetype(enemy.archetype);
  state.enemies = state.enemies.filter((e) => e.uid !== enemy.uid);
  state.score += Math.round(10 * archetype.bountyMultiplier);
  awardCurrency(profile, archetype.bountyMultiplier);
  gameEvents.emit({ type: 'enemy-defeated', xPct: enemy.xPct, y: enemy.y, kind: enemy.kind });

  if (archetype.splitsInto > 0) spawnSplit(state, profile, enemy, archetype.splitsInto);

  if (state.stagePhase === 'level' && archetype.countsTowardClear) {
    state.enemiesDefeated++;
    if (state.enemiesDefeated >= currentLevel(state).enemiesToClear) startBossPhase(state, profile);
  }
}

function applyHitToEnemy(
  state: RuntimeState,
  profile: PlayerProfile,
  enemy: EnemyInstance,
  result: AnswerResult
): { defeated: boolean } {
  const outcome = resolveGruntHit(result, enemy, state.missStreak);
  state.missStreak = outcome.missStreak;

  if (outcome.blocked) {
    // Show the shield, not the verdict - the answer never reached the
    // enemy, so reporting it as a hit or a miss would both be wrong.
    gameEvents.emit({ type: 'shield-blocked', xPct: enemy.xPct, y: enemy.y, targetId: enemy.uid });
  } else if (outcome.shieldBroken) {
    enemy.shielded = false;
    enemy.problem = problemForCurrentPhase(state);
    gameEvents.emit({ type: 'shield-broken', xPct: enemy.xPct, y: enemy.y, targetId: enemy.uid });
  } else {
    emitHitEvent(result, enemy.xPct, enemy.y, enemy.uid);

    if (outcome.knockbackPct > 0) {
      enemy.y = Math.max(KNOCKBACK_CEILING_Y_PCT, enemy.y - outcome.knockbackPct);
      gameEvents.emit({
        type: 'enemy-knockback',
        xPct: enemy.xPct,
        y: enemy.y,
        amountPct: outcome.knockbackPct,
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
      enemy.problem = problemForCurrentPhase(state);
      gameEvents.emit({
        type: 'enemy-layer-broken',
        xPct: enemy.xPct,
        y: enemy.y,
        layersRemaining: enemy.layersRemaining,
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

function refreshBossProblem(state: RuntimeState): void {
  const boss = state.boss!;
  boss.problem = boss.inFinale
    ? buildAuthoredProblem(currentBossRules(state).finaleProblem)
    : generateBossProblem(currentBossRules(state).scope, boss.progress);
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

function startBossPhase(state: RuntimeState, profile: PlayerProfile): void {
  const rules = currentLevel(state).boss;
  if (!rules) {
    advanceStageOrEndRun(state);
    return;
  }
  state.stagePhase = 'boss';
  state.enemies = [];
  state.missStreak = 0;

  const surviveTotalMs = rules.surviveSec * 1000;
  const openingPhase = rules.phases[0];
  state.boss = {
    name: rules.name,
    sprite: rules.sprite,
    surviveRemainingMs: surviveTotalMs,
    surviveTotalMs,
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
    problem: generateBossProblem(rules.scope, 0),
    progress: 0,
    missStreak: 0,
    inFinale: false,
    defeatedBy: null,
  };
  state.spawnTimer = randRange(openingPhase.addInterval[0], openingPhase.addInterval[1]);
  gameEvents.emit({ type: 'boss-phase-changed', phaseIndex: 0, name: openingPhase.name });
}

function onBossDefeated(state: RuntimeState, profile: PlayerProfile, cause: 'survival' | 'mastery'): void {
  const boss = state.boss!;
  boss.defeatedBy = cause;

  if (cause === 'mastery') {
    state.score += MASTERY_SCORE_BONUS;
    profile.currency += MASTERY_CURRENCY_BONUS;
    gameEvents.emit({ type: 'currency-earned', amount: MASTERY_CURRENCY_BONUS, total: profile.currency });
  }

  state.enemies = [];
  gameEvents.emit({ type: 'boss-defeated', by: cause, bestCombo: Math.max(boss.bestCombo, boss.combo) });
  state.boss = null;
  advanceStageOrEndRun(state);
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

  emitHitEvent(result, fxX, BOSS_FX_Y_PCT, 'boss');

  if (outcome.shieldBroken) {
    dropBossShield(state, currentBossPhase(state));
    gameEvents.emit({ type: 'shield-broken', xPct: fxX, y: BOSS_FX_Y_PCT, targetId: 'boss' });
  }

  if (outcome.comboBroken) gameEvents.emit({ type: 'boss-combo-broken', lostCombo: boss.combo });
  boss.combo = outcome.combo;
  boss.bestCombo = Math.max(boss.bestCombo, boss.combo);
  if (boss.combo > 0) gameEvents.emit({ type: 'boss-combo', combo: boss.combo, required: boss.comboRequired });

  if (outcome.surviveCutMs > 0) {
    boss.surviveRemainingMs = Math.max(0, boss.surviveRemainingMs - outcome.surviveCutMs);
    boss.progress = 1 - boss.surviveRemainingMs / boss.surviveTotalMs;
    state.score += BOSS_ANSWER_SCORE;
    gameEvents.emit({
      type: 'boss-timer-cut',
      amountMs: outcome.surviveCutMs,
      remainingMs: boss.surviveRemainingMs,
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

function advanceStageOrEndRun(state: RuntimeState): void {
  if (state.stageIndex >= GAME_LEVELS.length - 1) {
    gameEvents.emit({ type: 'victory' });
  } else {
    gameEvents.emit({ type: 'stage-cleared', stageId: currentLevel(state).id });
  }
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
  if (state.stagePhase === 'boss' && state.boss) {
    const boss = state.boss;
    const cleared = state.enemies.length;
    state.enemies = [];
    for (let i = 0; i < cleared; i++) awardCurrency(profile, 0.5);

    if (cleared > 0) {
      const cut = cleared * BOMB_BOSS_CUT_PER_ADD_MS;
      boss.surviveRemainingMs = Math.max(0, boss.surviveRemainingMs - cut);
      boss.progress = 1 - boss.surviveRemainingMs / boss.surviveTotalMs;
      gameEvents.emit({ type: 'boss-timer-cut', amountMs: cut, remainingMs: boss.surviveRemainingMs });
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
      enemy.problem = problemForCurrentPhase(state);
      gameEvents.emit({
        type: 'enemy-layer-broken',
        xPct: enemy.xPct,
        y: enemy.y,
        layersRemaining: enemy.layersRemaining,
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

export function handleInputAction(state: RuntimeState, profile: PlayerProfile, action: InputAction): void {
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
    state.player.fireCooldownRemainingMs = Math.max(0, state.player.fireCooldownRemainingMs - dt * 1000);
  }
  for (const id of Object.keys(state.skillCooldowns)) {
    if (state.skillCooldowns[id] > 0) {
      state.skillCooldowns[id] = Math.max(0, state.skillCooldowns[id] - dt * 1000);
    }
  }
}

function updateEnemyMovement(state: RuntimeState, profile: PlayerProfile, dt: number, frozen: boolean): void {
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
      dtSec: dt,
    });
    enemy.y = moved.y;
    enemy.xPct = moved.xPct;
  }
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
  for (const _enemy of landed) handleSingleImpact(state, profile);
  state.enemies = state.enemies.filter((e) => e.y < IMPACT_LINE_PCT);
}

function updateLevelPhase(state: RuntimeState, profile: PlayerProfile, dt: number, frozen: boolean): void {
  updateEnemyMovement(state, profile, dt, frozen);
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) releaseWave(state, profile);
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

function updateBossPhase(state: RuntimeState, profile: PlayerProfile, dt: number, frozen: boolean): void {
  const boss = state.boss!;
  const rules = currentBossRules(state);
  updateEnemyMovement(state, profile, dt, frozen);

  // The survive clock runs regardless of Freeze - freezing the adds is
  // meant to buy breathing room, not to stall the fight it's meant to win.
  boss.surviveRemainingMs = Math.max(0, boss.surviveRemainingMs - dt * 1000);
  boss.progress = 1 - boss.surviveRemainingMs / boss.surviveTotalMs;

  const nextPhase = phaseIndexForProgress(rules.phases, boss.progress);
  if (nextPhase !== boss.phaseIndex) enterBossPhase(state, nextPhase);
  const phase = currentBossPhase(state);

  if (!boss.inFinale && boss.surviveRemainingMs <= boss.surviveTotalMs * FINALE_REMAINING_THRESHOLD) {
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

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    if (hasRoom(state)) spawnBossAdd(state, profile);
    const multiplier = boss.inFinale ? FINALE_ADD_INTERVAL_MULTIPLIER : 1;
    state.spawnTimer = randRange(phase.addInterval[0], phase.addInterval[1]) * multiplier;
  }

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

  if (state.stagePhase === 'level') updateLevelPhase(state, profile, dtSec, frozen);
  else if (state.boss) updateBossPhase(state, profile, dtSec, frozen);

  handleImpacts(state, profile);
}
