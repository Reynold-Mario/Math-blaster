import type { RuntimeState, EnemyInstance } from './RuntimeState';
import type { PlayerProfile } from './PlayerProfile';
import type { GruntKind } from '../levels/LevelDefinition';
import type { AnswerResult } from '../math/evaluator';
import type { InputAction } from '../input/InputManager';

import { GAME_LEVELS } from '../levels/gameLevels';
import { generateProblem, generateBossProblem, buildAuthoredProblem } from '../levels/problemGenerators';
import { evaluateAnswer } from '../math/evaluator';
import { resolveGruntHit, resolveBossHit } from '../combat';
import { resolveTarget, ALIGNMENT_TOLERANCE_PCT } from '../targeting';
import { gameEvents } from '../events';
import { currentEffect } from '../skills/SkillTree';
import { findBaseSkillNode } from '../skills/baseSkillTree';

// Must match GameCanvas.svelte's own IMPACT_LINE_PCT constant.
const IMPACT_LINE_PCT = 86;
const BASE_TIMER_MS = 30000;
const BASE_IMPACT_TIME_PENALTY_MS = 5000;
const BASE_CURRENCY_PER_KILL = 5;
const BASE_PLAYER_SPEED_PCT_PER_SEC = 55;
const BOSS_DRIFT_SPEED_PCT_PER_SEC = 14;
const FINALE_HP_THRESHOLD = 0.15;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function currentLevel(state: RuntimeState) {
  return GAME_LEVELS[state.stageIndex];
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
function currentEnemyHpMultiplier(profile: PlayerProfile): number {
  const effect = currentEffect(findBaseSkillNode('health-pool')!, profile.skillProgress);
  return effect.kind === 'health' ? effect.enemyHpMultiplier : 1;
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
  return effect.kind === 'armor' ? effect.damageReduction : 0;
}
function currentBountyBonus(profile: PlayerProfile): number {
  const effect = currentEffect(findBaseSkillNode('bounty')!, profile.skillProgress);
  return effect.kind === 'bounty' ? effect.bonusPerKill : 0;
}
function startingTimeMs(profile: PlayerProfile): number {
  const moreTime = currentEffect(findBaseSkillNode('more-time')!, profile.skillProgress);
  const health = currentEffect(findBaseSkillNode('health-pool')!, profile.skillProgress);
  const moreTimeBonus = moreTime.kind === 'moreTime' ? moreTime.bonusMs : 0;
  const healthBonus = health.kind === 'health' ? health.bonusTimeMs : 0;
  return BASE_TIMER_MS + moreTimeBonus + healthBonus;
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
  const level = currentLevel(state);
  state.spawnTimer = randRange(level.arcadeDifficulty.spawnInterval[0], level.arcadeDifficulty.spawnInterval[1]);
  gameEvents.emit({ type: 'level-started', stageId: level.id });
}

/** Called by the Svelte layer once the player dismisses a "stage clear"
 * screen - gameFlow itself never auto-advances, so that pause is always
 * player-driven. */
export function advanceToNextStage(state: RuntimeState): void {
  setupStage(state, state.stageIndex + 1);
}

// --- Spawning ---

let uidCounter = 0;

function spawnGrunt(state: RuntimeState, profile: PlayerProfile, mini: boolean): void {
  const level = currentLevel(state);
  const problem = generateProblem(level.curriculum);
  const baseMaxHp = mini ? 60 : 100;
  const maxHp = Math.round(baseMaxHp * currentEnemyHpMultiplier(profile));
  const [minSpeed, maxSpeed] = level.arcadeDifficulty.fallSpeed;
  state.enemies.push({
    uid: ++uidCounter,
    kind: level.grunt,
    mini,
    problem,
    hp: maxHp,
    maxHp,
    xPct: randInt(10, 90),
    y: 0,
    speed: randRange(minSpeed, maxSpeed) * currentEnemySpeedMultiplier(profile),
    frozen: false,
    burnUntilMs: 0,
  });
}

function spawnBossAdd(state: RuntimeState, profile: PlayerProfile): void {
  const bossRules = currentLevel(state).boss!;
  const boss = state.boss!;
  const problem = generateBossProblem(bossRules.scope, boss.progress);
  const addKind: GruntKind = bossRules.sprite === 'boss1' ? 'slime' : 'robot';
  const maxHp = Math.round(100 * currentEnemyHpMultiplier(profile));
  const [minSpeed, maxSpeed] = bossRules.arcadeDifficulty.fallSpeed;
  state.enemies.push({
    uid: ++uidCounter,
    kind: addKind,
    mini: true,
    problem,
    hp: maxHp,
    maxHp,
    xPct: randInt(10, 90),
    y: 0,
    speed: randRange(minSpeed, maxSpeed) * currentEnemySpeedMultiplier(profile),
    frozen: false,
    burnUntilMs: 0,
  });
}

function tryReinforce(state: RuntimeState, profile: PlayerProfile): void {
  const level = currentLevel(state);
  if (state.enemies.length >= level.arcadeDifficulty.maxConcurrent) return;
  spawnGrunt(state, profile, true);
  const spawned = state.enemies[state.enemies.length - 1];
  gameEvents.emit({ type: 'reinforcement-spawned', xPct: spawned.xPct });
}

function tryReinforceBossAdd(state: RuntimeState, profile: PlayerProfile): void {
  const bossRules = currentLevel(state).boss!;
  if (state.enemies.length >= bossRules.arcadeDifficulty.maxConcurrent) return;
  spawnBossAdd(state, profile);
  const spawned = state.enemies[state.enemies.length - 1];
  gameEvents.emit({ type: 'reinforcement-spawned', xPct: spawned.xPct });
}

// --- Combat resolution ---

function emitHitEvent(result: AnswerResult, xPct: number, y: number, damage: number, targetId: number | 'boss'): void {
  switch (result.verdict) {
    case 'exact':
      gameEvents.emit({ type: 'hit-exact', xPct, y, damage, targetId });
      break;
    case 'equivalent':
      gameEvents.emit({ type: 'hit-equivalent', xPct, y, damage, targetId });
      break;
    case 'close':
      gameEvents.emit({ type: 'hit-close', xPct, y, damage, targetId });
      break;
    case 'partial':
      gameEvents.emit({
        type: 'hit-partial',
        xPct,
        y,
        damage,
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

function awardCurrency(profile: PlayerProfile): void {
  const amount = BASE_CURRENCY_PER_KILL + currentBountyBonus(profile);
  profile.currency += amount;
  gameEvents.emit({ type: 'currency-earned', amount, total: profile.currency });
}

function removeEnemyAndScore(state: RuntimeState, profile: PlayerProfile, enemy: EnemyInstance): void {
  state.enemies = state.enemies.filter((e) => e.uid !== enemy.uid);
  state.score += 10;
  awardCurrency(profile);
  gameEvents.emit({ type: 'enemy-defeated', xPct: enemy.xPct, y: enemy.y, kind: enemy.kind });

  if (state.stagePhase === 'level') {
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
  emitHitEvent(result, enemy.xPct, enemy.y, outcome.damage, enemy.uid);
  enemy.hp = Math.max(0, enemy.hp - outcome.damage);

  if (outcome.damage > 0) {
    const burn = currentEffect(findBaseSkillNode('burn')!, profile.skillProgress);
    if (burn.kind === 'burn' && burn.chance > 0 && Math.random() < burn.chance) {
      enemy.burnUntilMs = performance.now() + burn.durationSec * 1000;
    }
  }

  const defeated = outcome.defeated;
  if (defeated) removeEnemyAndScore(state, profile, enemy);
  if (outcome.reinforce) tryReinforce(state, profile);
  return { defeated };
}

function resolveEnemyShot(state: RuntimeState, profile: PlayerProfile, primary: EnemyInstance, result: AnswerResult): void {
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

function refreshBossProblem(state: RuntimeState): void {
  const boss = state.boss!;
  const bossRules = currentLevel(state).boss!;
  boss.problem = boss.inFinale
    ? buildAuthoredProblem(bossRules.finaleProblem)
    : generateBossProblem(bossRules.scope, boss.progress);
}

/** Applies boss-hp damage bookkeeping, checks for defeat/finale
 * threshold. Returns false once the boss is defeated (and already
 * cleaned up), so callers know not to continue with a refresh/reinforce
 * step. */
function checkBossHpAndAdvance(state: RuntimeState): boolean {
  const boss = state.boss!;
  boss.progress = 1 - boss.hp / boss.maxHp;

  if (boss.hp <= 0) {
    onBossDefeated(state);
    return false;
  }
  if (!boss.inFinale && boss.hp / boss.maxHp <= FINALE_HP_THRESHOLD) {
    boss.inFinale = true;
    state.enemies = [];
    gameEvents.emit({ type: 'boss-finale-started' });
  }
  return true;
}

function resolveBossAddShot(state: RuntimeState, profile: PlayerProfile, add: EnemyInstance, result: AnswerResult): void {
  const boss = state.boss!;
  const outcome = resolveBossHit(result, boss, boss.missStreak);
  boss.missStreak = outcome.missStreak;
  emitHitEvent(result, add.xPct, add.y, outcome.damage, 'boss');
  boss.hp = Math.max(0, boss.hp - outcome.damage);

  const progressed = result.verdict !== 'incorrect' && result.verdict !== 'invalid';
  if (progressed) {
    state.enemies = state.enemies.filter((e) => e.uid !== add.uid);
    awardCurrency(profile);
  }

  const stillAlive = checkBossHpAndAdvance(state);
  if (stillAlive && progressed) refreshBossProblem(state);
  if (stillAlive && outcome.reinforce) tryReinforceBossAdd(state, profile);
}

function resolveBossDirectShot(state: RuntimeState, profile: PlayerProfile, result: AnswerResult): void {
  const boss = state.boss!;
  const outcome = resolveBossHit(result, boss, boss.missStreak);
  boss.missStreak = outcome.missStreak;
  emitHitEvent(result, boss.xPct, 12, outcome.damage, 'boss');
  boss.hp = Math.max(0, boss.hp - outcome.damage);

  const progressed = result.verdict !== 'incorrect' && result.verdict !== 'invalid';
  const stillAlive = checkBossHpAndAdvance(state);
  if (stillAlive && progressed) refreshBossProblem(state);
  if (stillAlive && outcome.reinforce) tryReinforceBossAdd(state, profile);
}

function startBossPhase(state: RuntimeState, profile: PlayerProfile): void {
  const bossRules = currentLevel(state).boss;
  if (!bossRules) {
    advanceStageOrEndRun(state);
    return;
  }
  state.stagePhase = 'boss';
  state.enemies = [];
  state.boss = {
    name: bossRules.name,
    sprite: bossRules.sprite,
    hp: Math.round(bossRules.hp * currentEnemyHpMultiplier(profile)),
    maxHp: Math.round(bossRules.hp * currentEnemyHpMultiplier(profile)),
    xPct: 50,
    driftDirection: 1,
    driftSpeed: BOSS_DRIFT_SPEED_PCT_PER_SEC,
    problem: generateBossProblem(bossRules.scope, 0),
    progress: 0,
    missStreak: 0,
    inFinale: false,
  };
  state.spawnTimer = randRange(bossRules.arcadeDifficulty.spawnInterval[0], bossRules.arcadeDifficulty.spawnInterval[1]);
}

function onBossDefeated(state: RuntimeState): void {
  state.enemies = [];
  state.boss = null;
  gameEvents.emit({ type: 'boss-defeated' });
  advanceStageOrEndRun(state);
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

  if (target.kind === 'none') return;

  if (target.kind === 'boss') {
    resolveBossDirectShot(state, profile, evaluateAnswer(guess, state.boss!.problem));
  } else if (state.stagePhase === 'boss') {
    resolveBossAddShot(state, profile, target.enemy, evaluateAnswer(guess, target.enemy.problem));
  } else {
    resolveEnemyShot(state, profile, target.enemy, evaluateAnswer(guess, target.enemy.problem));
  }
}

function applyBomb(state: RuntimeState, profile: PlayerProfile, damage: number): void {
  if (state.stagePhase === 'boss' && state.boss) {
    const boss = state.boss;
    const n = state.enemies.length;
    boss.hp = Math.max(0, boss.hp - n * Math.round(boss.maxHp * 0.05));
    for (let i = 0; i < n; i++) awardCurrency(profile);
    state.enemies = [];
    checkBossHpAndAdvance(state);
  } else {
    for (const enemy of state.enemies) enemy.hp = Math.max(0, enemy.hp - damage);
    const dead = state.enemies.filter((e) => e.hp <= 0);
    state.enemies = state.enemies.filter((e) => e.hp > 0);
    for (const enemy of dead) {
      state.score += 10;
      state.enemiesDefeated++;
      awardCurrency(profile);
      gameEvents.emit({ type: 'enemy-defeated', xPct: enemy.xPct, y: enemy.y, kind: enemy.kind });
    }
    if (state.enemiesDefeated >= currentLevel(state).enemiesToClear) startBossPhase(state, profile);
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
    if (effect.damage <= 0) return; // level 0 - not yet purchased
    applyBomb(state, profile, effect.damage);
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
    enemy.y += enemy.speed * (burning ? slowMultiplier : 1) * dt;
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
  const level = currentLevel(state);
  updateEnemyMovement(state, profile, dt, frozen);
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    if (state.enemies.length < level.arcadeDifficulty.maxConcurrent) spawnGrunt(state, profile, false);
    state.spawnTimer = randRange(level.arcadeDifficulty.spawnInterval[0], level.arcadeDifficulty.spawnInterval[1]);
  }
}

function updateBossPhase(state: RuntimeState, profile: PlayerProfile, dt: number, frozen: boolean): void {
  const bossRules = currentLevel(state).boss!;
  const boss = state.boss!;
  updateEnemyMovement(state, profile, dt, frozen);

  if (!frozen) {
    boss.xPct += boss.driftDirection * boss.driftSpeed * dt;
    if (boss.xPct > 90) {
      boss.xPct = 90;
      boss.driftDirection = -1;
    } else if (boss.xPct < 10) {
      boss.xPct = 10;
      boss.driftDirection = 1;
    }
  }

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    if (state.enemies.length < bossRules.arcadeDifficulty.maxConcurrent) spawnBossAdd(state, profile);
    state.spawnTimer = randRange(bossRules.arcadeDifficulty.spawnInterval[0], bossRules.arcadeDifficulty.spawnInterval[1]);
  }
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
  else updateBossPhase(state, profile, dtSec, frozen);

  handleImpacts(state, profile);
}
