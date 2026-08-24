<script lang="ts">
  import { onMount } from 'svelte';
  import GameCanvas from './render/GameCanvas.svelte';
  import SkillTreeScreen from './skills/SkillTreeScreen.svelte';
  import { InputManager } from './input/InputManager';
  import {
    createInitialRuntimeState,
    resetRun,
    advanceToNextStage,
    tick,
    handleInputAction,
  } from './runtime/gameFlow';
  import type { RuntimeState } from './runtime/RuntimeState';
  import type { PlayerProfile } from './runtime/PlayerProfile';
  import { loadPlayerProfile, savePlayerProfile } from './runtime/PlayerProfile';
  import { installSkillTreeDebugTools } from './runtime/devTools';
  import { purchaseNextInstallment, type SkillNode } from './skills/SkillTree';
  import type { BaseSkillEffect } from './skills/baseSkillTree';
  import { GAME_LEVELS } from './levels/gameLevels';
  import type { StageTheme } from './levels/LevelDefinition';
  import { gameEvents, type GameEvent } from './events';
  import { wireAudioToEvents, setMuted, isMuted } from './audio';
  import type { GamePhase } from './types';

  let phase = $state<GamePhase>('boot');
  let runtime = $state<RuntimeState>(createInitialRuntimeState());
  let profile = $state<PlayerProfile>(loadPlayerProfile());
  let countdownValue = $state(3);
  let muted = $state(isMuted());
  let finalScore = $state(0);

  const input = new InputManager();
  let stageWrapperEl: HTMLDivElement | undefined = $state();
  let dragging = false;

  const currentLevelDef = $derived(GAME_LEVELS[runtime.stageIndex]);
  const isBossPhase = $derived(runtime.stagePhase === 'boss' && runtime.boss !== null);
  const stageName = $derived(isBossPhase ? runtime.boss!.name : currentLevelDef.name);
  const currentTheme = $derived(
    (isBossPhase && currentLevelDef.boss?.theme ? currentLevelDef.boss.theme : currentLevelDef.theme) as StageTheme
  );
  const nextStageName = $derived.by(() => {
    const n = GAME_LEVELS[runtime.stageIndex + 1];
    return n ? n.name : '';
  });
  const secondsRemaining = $derived(Math.max(0, Math.ceil(runtime.timeRemainingMs / 1000)));
  const timeLow = $derived(runtime.timeRemainingMs <= 10000);

  function skillLevel(id: string): number {
    return profile.skillProgress[id] ?? 0;
  }
  function skillReady(id: string): boolean {
    return skillLevel(id) > 0 && (runtime.skillCooldowns[id] ?? 0) <= 0;
  }

  function endRun(p: 'gameover' | 'victory') {
    finalScore = runtime.score;
    phase = p;
  }

  function handleFlowEvent(event: GameEvent) {
    switch (event.type) {
      case 'stage-cleared':
        phase = 'stageClear';
        break;
      case 'victory':
        endRun('victory');
        break;
      case 'game-over':
        endRun('gameover');
        break;
      case 'currency-earned':
        savePlayerProfile(profile);
        break;
      default:
        break;
    }
  }

  function goToSkillTree() {
    phase = 'skillTree';
  }
  /** Owns the actual profile mutation for a skill purchase - SkillTreeScreen
   * only reads `profile` (via props) and calls back here, so Svelte's
   * ownership checks never see a child mutating a prop it doesn't own. */
  function purchaseSkill(node: SkillNode<BaseSkillEffect>) {
    const result = purchaseNextInstallment(node, profile.skillProgress, profile.skillSubProgress, profile.currency);
    if (!result) return;
    profile.skillProgress = result.progress;
    profile.skillSubProgress = result.subProgress;
    profile.currency -= result.pointsSpent;
    savePlayerProfile(profile);
  }
  function startRun() {
    resetRun(runtime, profile);
    countdownValue = 3;
    phase = 'countdown';
  }
  function continueRun() {
    advanceToNextStage(runtime);
    countdownValue = 3;
    phase = 'countdown';
  }
  function toggleMute() {
    muted = !muted;
    setMuted(muted);
  }

  function pointerXPct(e: PointerEvent): number {
    if (!stageWrapperEl) return 50;
    const rect = stageWrapperEl.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * 100;
  }
  function onPointerDown(e: PointerEvent) {
    if (phase !== 'playing') return;
    dragging = true;
    input.dragTo(pointerXPct(e));
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    input.dragTo(pointerXPct(e));
  }
  function onPointerUp() {
    dragging = false;
  }

  function handleUIKeydown(e: KeyboardEvent) {
    if (phase === 'boot' && (e.key === 'Enter' || e.key === ' ')) {
      goToSkillTree();
      e.preventDefault();
    } else if (phase === 'stageClear' && (e.key === 'Enter' || e.key === ' ')) {
      continueRun();
      e.preventDefault();
    }
  }

  $effect(() => {
    if (phase !== 'countdown') return;
    if (countdownValue <= 0) {
      phase = 'playing';
      return;
    }
    const t = setTimeout(() => {
      countdownValue -= 1;
    }, 700);
    return () => clearTimeout(t);
  });

  onMount(() => {
    if (import.meta.env.DEV) installSkillTreeDebugTools(profile);

    const unbindKeyboard = input.attachKeyboard(window);
    const unbindAudio = wireAudioToEvents();
    const unbindFlow = gameEvents.on(handleFlowEvent);
    const unbindInput = input.on((action) => {
      if (phase === 'playing') handleInputAction(runtime, profile, action);
    });

    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      if (phase === 'playing') tick(runtime, profile, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      unbindKeyboard();
      unbindAudio();
      unbindFlow();
      unbindInput();
      cancelAnimationFrame(raf);
    };
  });
</script>

<svelte:window onkeydown={handleUIKeydown} />

<div class="game-root">
  {#if phase === 'boot'}
    <div class="boot">
      <h1 class="title">Pixel Math<br />Blaster</h1>
      <p class="tagline">Drag or use ◀▶ to line up, type the answer, hit FIRE!</p>
      <ul class="howto">
        <li>🎯 Exact answers deal big damage</li>
        <li>👍 Close and partial answers still help - no penalties for trying</li>
        <li>⏱ Race the clock - enemies that get through cost you time</li>
        <li>💰 Defeat enemies to earn currency for permanent upgrades</li>
      </ul>
      <button class="big-btn" onclick={goToSkillTree}>Press Start ▶</button>
      <div class="mini-scores currency-note">💰 {profile.currency} banked</div>
    </div>
  {:else if phase === 'skillTree'}
    <SkillTreeScreen profile={profile} onPlay={startRun} onPurchase={purchaseSkill} />
  {:else}
    <div class="hud">
      <div class="hud-left">
        <div class="timer" class:low={timeLow}>⏱ {secondsRemaining}s</div>
        <div class="score">Score: {runtime.score}</div>
      </div>
      <div class="hud-mid">
        <div class="stage-world">{currentLevelDef.world}</div>
        <div class="stage-name">{stageName}</div>
        {#if isBossPhase}
          <div class="bar boss"><div class="fill" style="width:{(runtime.boss!.hp / runtime.boss!.maxHp) * 100}%"></div></div>
        {:else}
          <div class="bar level"><div class="fill" style="width:{(runtime.enemiesDefeated / currentLevelDef.enemiesToClear) * 100}%"></div></div>
          <div class="stage-progress">{runtime.enemiesDefeated}/{currentLevelDef.enemiesToClear} defeated</div>
        {/if}
      </div>
      <div class="hud-right">
        <div class="currency">💰 {profile.currency}</div>
        <button class="mute-btn" onclick={toggleMute} aria-label="Toggle sound">{muted ? '🔇' : '🔊'}</button>
      </div>
    </div>

    <div
      class="stage-wrapper"
      bind:this={stageWrapperEl}
      role="application"
      aria-label="Game play area - drag to move, tap FIRE to shoot"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointerleave={onPointerUp}
    >
      <GameCanvas runtime={runtime} theme={currentTheme} />

      {#if phase === 'countdown'}
        <div class="overlay">
          <div class="countdown-num">{countdownValue > 0 ? countdownValue : 'GO!'}</div>
        </div>
      {/if}

      {#if phase === 'stageClear'}
        <div class="overlay">
          <h2>Stage Clear! 🎉</h2>
          <p>{currentLevelDef.name} complete.</p>
          {#if nextStageName}<p class="next-up">Next up: {nextStageName}</p>{/if}
          <button class="big-btn" onclick={continueRun}>Continue ▶</button>
        </div>
      {/if}

      {#if phase === 'gameover' || phase === 'victory'}
        <div class="overlay">
          <h2>{phase === 'victory' ? 'You defeated the Math Overlord! 🏆' : "Time's Up!"}</h2>
          <p>Final Score: {finalScore}</p>
          <p class="currency-note">💰 {profile.currency} total banked</p>
          <button class="big-btn" onclick={startRun}>Play Again ▶</button>
          <button class="big-btn" onclick={goToSkillTree}>Skill Tree ▶</button>
        </div>
      {/if}
    </div>

    {#if phase === 'playing'}
      <div class="controls">
        <div class="move-controls">
          <button
            class="move-btn"
            onpointerdown={() => input.pressMove('left')}
            onpointerup={() => input.releaseMove('left')}
            onpointerleave={() => input.releaseMove('left')}
          >◀</button>
          <button
            class="move-btn"
            onpointerdown={() => input.pressMove('right')}
            onpointerup={() => input.releaseMove('right')}
            onpointerleave={() => input.releaseMove('right')}
          >▶</button>
        </div>
        <div class="keypad">
          {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'FIRE'] as d}
            {#if d === '⌫'}
              <button class="key wide" onclick={() => input.pressBackspace()}>⌫</button>
            {:else if d === 'FIRE'}
              <button class="key fire wide" onclick={() => input.pressFire()}>FIRE</button>
            {:else}
              <button class="key" onclick={() => input.pressDigit(d)}>{d}</button>
            {/if}
          {/each}
        </div>
        <div class="skills-bar">
          <button
            class="skill"
            class:ready={skillReady('freeze')}
            disabled={skillLevel('freeze') === 0 || !skillReady('freeze')}
            onclick={() => input.pressSkill('freeze')}
          >
            <span class="icon">❄</span>
            <span class="name">Freeze</span>
            {#if skillLevel('freeze') === 0}<span class="locked">🔒</span>{/if}
          </button>
          <button
            class="skill"
            class:ready={skillReady('bomb')}
            disabled={skillLevel('bomb') === 0 || !skillReady('bomb')}
            onclick={() => input.pressSkill('bomb')}
          >
            <span class="icon">💥</span>
            <span class="name">Bomb</span>
            {#if skillLevel('bomb') === 0}<span class="locked">🔒</span>{/if}
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .game-root {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    font-family: 'Baloo 2', sans-serif;
    color: var(--ink);
  }

  .boot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px 16px;
    text-align: center;
  }
  .title {
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(22px, 6vw, 34px);
    line-height: 1.5;
    text-shadow: 3px 3px 0 var(--marquee-yellow);
    margin: 0;
  }
  .tagline {
    font-weight: 700;
    font-size: 15px;
    margin: 0;
  }
  .howto {
    list-style: none;
    padding: 12px 16px;
    margin: 0;
    background: var(--panel);
    border: 3px solid var(--ink);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    text-align: left;
  }
  .big-btn {
    font-family: 'Press Start 2P', monospace;
    font-size: 14px;
    padding: 14px 22px;
    background: var(--marquee-red);
    color: #fff;
    border: 3px solid var(--ink);
    border-radius: 10px;
    cursor: pointer;
    box-shadow: 0 4px 0 rgba(0, 0, 0, 0.3);
  }
  .big-btn:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.3);
  }
  .currency-note {
    font-family: 'Press Start 2P', monospace;
    font-size: 11px;
    padding: 6px 12px;
  }

  .hud {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    background: var(--panel);
    border: 3px solid var(--ink);
    border-radius: 10px;
  }
  .hud-left,
  .hud-right {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 84px;
  }
  .hud-right {
    align-items: flex-end;
  }
  .timer {
    font-family: 'Press Start 2P', monospace;
    font-size: 13px;
  }
  .timer.low {
    color: var(--marquee-red);
    animation: pulse 0.6s infinite alternate;
  }
  @keyframes pulse {
    from { opacity: 1; }
    to { opacity: 0.55; }
  }
  .score {
    font-family: 'Press Start 2P', monospace;
    font-size: 10px;
  }
  .currency {
    font-weight: 700;
    font-size: 13px;
  }
  .hud-mid {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .stage-world {
    font-size: 11px;
    font-weight: 700;
    opacity: 0.8;
  }
  .stage-name {
    font-family: 'Press Start 2P', monospace;
    font-size: 11px;
  }
  .stage-progress {
    font-size: 11px;
    font-weight: 700;
  }
  .bar {
    width: 100%;
    max-width: 260px;
    height: 10px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 5px;
    overflow: hidden;
    border: 2px solid var(--ink);
  }
  .bar .fill {
    height: 100%;
  }
  .bar.level .fill {
    background: linear-gradient(90deg, #4ade80, #22c55e);
  }
  .bar.boss .fill {
    background: linear-gradient(90deg, #f87171, #fbbf24);
    transition: width 0.2s;
  }
  .mute-btn {
    border: 3px solid var(--ink);
    background: #fff;
    border-radius: 8px;
    width: 40px;
    height: 40px;
    font-size: 16px;
    cursor: pointer;
  }

  .stage-wrapper {
    position: relative;
    border: 4px solid var(--ink);
    border-radius: 14px;
    overflow: hidden;
    touch-action: none;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: rgba(20, 33, 61, 0.82);
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
    padding: 16px;
    z-index: 10;
  }
  .overlay h2 {
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(14px, 4vw, 20px);
    margin: 0;
  }
  .next-up {
    opacity: 0.85;
    font-size: 13px;
  }
  .countdown-num {
    font-family: 'Press Start 2P', monospace;
    font-size: 48px;
    color: var(--marquee-yellow);
    text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.4);
  }

  .mini-scores {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 8px 16px;
  }

  .controls {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
  }
  .move-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .move-btn {
    width: 54px;
    height: 44px;
    border-radius: 8px;
    border: 3px solid var(--ink);
    background: #fff;
    font-size: 16px;
    cursor: pointer;
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.25);
    touch-action: none;
  }
  .move-btn:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
  }
  .keypad {
    display: grid;
    grid-template-columns: repeat(3, 54px);
    gap: 6px;
  }
  .key {
    height: 44px;
    border-radius: 8px;
    border: 3px solid var(--ink);
    background: #fff;
    font-family: 'Press Start 2P', monospace;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.25);
  }
  .key:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
  }
  .key.fire {
    background: var(--marquee-red);
    color: #fff;
  }
  .skills-bar {
    display: flex;
    gap: 8px;
  }
  .skill {
    position: relative;
    width: 62px;
    height: 62px;
    border-radius: 12px;
    border: 3px solid var(--ink);
    background: #64748b;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #fff;
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.3);
  }
  .skill.ready {
    background: #f59e0b;
  }
  .skill:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }
  .skill .icon {
    font-size: 20px;
  }
  .skill .name {
    font-family: 'Baloo 2', sans-serif;
    font-size: 9px;
    font-weight: 700;
  }
  .skill .locked {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 10px;
  }
</style>
