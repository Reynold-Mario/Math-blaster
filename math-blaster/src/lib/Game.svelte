<script lang="ts">
  import { onMount } from 'svelte';
  import GameCanvas from './render/GameCanvas.svelte';
  import SkillTreeScreen from './skills/SkillTreeScreen.svelte';
  import { InputManager } from './input/InputManager';
  import { createInitialRuntimeState, resetRun, tick, handleInputAction } from './runtime/gameFlow';
  import type { RuntimeState } from './runtime/RuntimeState';
  import type { PlayerProfile } from './runtime/PlayerProfile';
  import { createLocalStorageStore } from './progression/localStorageStore';
  import { createSupabaseProgressionStore } from './progression/supabaseStore';
  import { isSupabaseConfigured, loadSupabaseRemote } from './progression/supabaseClient';
  import { createLazyRemote } from './progression/lazyRemote';
  import { createRunQueue } from './progression/runQueue';
  import { resolveGrade } from './runtime/gradeSource';
  import { profileCodec, PROFILE_STORAGE_KEY } from './progression/profileCodec';
  import { createMasteryRecorder, type TopicDelta } from './progression/MasteryRecorder';
  import {
    checkpointWave,
    freeStartWave,
    maxStartWave,
    nextSkipTarget,
    purchaseSkip,
    skipCost,
    startsOnBoss,
  } from './runtime/runSetup';
  import type { GradeLevel } from './levels/gradeTree';
  import { installSkillTreeDebugTools } from './runtime/devTools';
  import { purchaseNextInstallment, type SkillNode } from './skills/SkillTree';
  import type { BaseSkillEffect } from './skills/baseSkillTree';
  import { backdropForWave } from './levels/waveProgression';
  import type { Backdrop } from './levels/LevelDefinition';
  import { gameEvents, type GameEvent } from './events';
  import { wireAudioToEvents, setMuted, isMuted } from './audio';
  import type { GamePhase } from './types';

  /**
   * Progression reaches the game through a store rather than a module
   * function, so that a networked one can arrive without this file
   * learning that a network exists. The key is passed in because Math
   * Blaster's predates the convention and must not move.
   *
   * The networked one has now arrived, and note how little changed: the
   * Supabase store WRAPS the localStorage one rather than replacing it, so
   * localStorage is still the boot path and `progress.current` is still
   * synchronous. With no credentials `isSupabaseConfigured()` is false and the
   * whole thing is a pass-through - which is the state the game ships in today,
   * and the reason wiring this up cannot regress anything.
   *
   * `createLazyRemote` is what keeps the Supabase client out of the main
   * bundle: nothing is imported until the store asks its first question, so
   * with credentials configured the game is playable WHILE the client loads
   * rather than after it.
   */
  // Sync failures are never the player's problem: the run keeps going on the
  // local copy. In dev they should still be visible, because "it silently
  // stopped syncing" is otherwise indistinguishable from "it is working".
  const reportSyncError = (where: string, error: unknown) => {
    if (import.meta.env.DEV) console.error(`[progression:${where}]`, error);
  };
  /** One remote, shared by the profile store and the run queue, so the client
   * chunk is fetched once rather than per consumer. */
  const remote = isSupabaseConfigured() ? createLazyRemote(loadSupabaseRemote) : null;
  const store = createSupabaseProgressionStore({
    cache: createLocalStorageStore({ keyFor: () => PROFILE_STORAGE_KEY }),
    remote,
    onError: reportSyncError,
  });
  const progress = store.open(profileCodec);
  /**
   * Finished runs. Separate from the profile store because they are append-only
   * events rather than merged state: a run either landed or it has not, and
   * `submit_run()` is idempotent on a key the queue owns.
   *
   * A signed-out player still queues. `submitRun` answers `unavailable` with no
   * session, so the run waits on disk and lands on the first boot after signing
   * in - which is the same local-first rule the profile follows.
   */
  const runs = createRunQueue({ remote, onError: reportSyncError });

  let phase = $state<GamePhase>('boot');
  let runtime = $state<RuntimeState>(createInitialRuntimeState());
  /**
   * SYNCHRONOUS at boot - `progress.current` is readable the instant the
   * handle exists, so there is no loading phase and no `0 banked` flash.
   *
   * This object is MUTATED IN PLACE and never reassigned. `installSkill-
   * TreeDebugTools` captures it by reference, so `profile = next` would
   * leave the dev tools silently holding a detached copy.
   */
  let profile = $state<PlayerProfile>(progress.current);
  let countdownValue = $state(3);
  let muted = $state(isMuted());
  let finalScore = $state(0);
  /** How far the run got, for the end-of-run readout. The wave number is
   * the score that actually means something in an endless run. */
  let finalWave = $state(1);
  /** The wave the next run will begin on. Seeded from the Checkpoint skill
   * when the run-setup screen opens, then raised by any paid skips. */
  let startWave = $state(1);

  const input = new InputManager();
  let stageWrapperEl: HTMLDivElement | undefined = $state();
  let dragging = false;

  const isBossPhase = $derived(runtime.runPhase === 'boss' && runtime.boss !== null);
  const currentTheme = $derived(
    (isBossPhase && runtime.bossRules?.theme ? runtime.bossRules.theme : backdropForWave(runtime.waveNumber)) as Backdrop
  );
  const secondsRemaining = $derived(Math.max(0, Math.ceil(runtime.timeRemainingMs / 1000)));
  const timeLow = $derived(runtime.timeRemainingMs <= 10000);
  const bossPhaseName = $derived.by(() => {
    if (!isBossPhase) return '';
    return runtime.bossRules?.phases[runtime.boss!.phaseIndex]?.name ?? '';
  });
  /** Enemies still standing in this wave. A wave ends when this hits 0, so
   * it's the honest progress readout - not a kill quota. */
  const waveRemaining = $derived(runtime.enemies.length);
  const waveCleared = $derived(Math.max(0, runtime.waveSize - waveRemaining));
  const waveProgressPct = $derived(runtime.waveSize > 0 ? (waveCleared / runtime.waveSize) * 100 : 0);
  const incoming = $derived(runtime.waveBreatherSec > 0);
  const skipTarget = $derived(nextSkipTarget(profile, startWave));
  const skipPrice = $derived(skipTarget === null ? 0 : skipCost(startWave, skipTarget));
  const canAffordSkip = $derived(skipTarget !== null && profile.currency >= skipPrice);
  const surviveSeconds = $derived(isBossPhase ? Math.max(0, Math.ceil(runtime.boss!.surviveRemainingMs / 1000)) : 0);

  function skillLevel(id: string): number {
    return profile.skillProgress[id] ?? 0;
  }
  function skillReady(id: string): boolean {
    return skillLevel(id) > 0 && (runtime.skillCooldowns[id] ?? 0) <= 0;
  }

  function endRun() {
    finalScore = runtime.score;
    finalWave = runtime.waveNumber;
    phase = 'gameover';
  }

  /** Record the change; the store decides when it actually gets written.
   * Called on every kill, which is exactly why the store debounces. */
  function save() {
    progress.put(profile);
  }
  /** ...and for the handful of moments worth a guaranteed write: money has
   * changed hands, or the run is over. Losing one of these to a closed tab
   * would be visible to the player. */
  function saveNow() {
    progress.put(profile);
    progress.flush();
  }

  function handleFlowEvent(event: GameEvent) {
    switch (event.type) {
      case 'game-over':
        endRun();
        saveNow();
        break;
      case 'boss-defeated':
        if (event.by === 'mastery') bossesDefeatedThisRun += 1;
        break;
      case 'currency-earned':
      case 'wave-record':
        // Both change what persists - currency banked, and how far a future
        // run may start from - so both are worth recording mid-run.
        save();
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
    // Keep the monotone total in step with the balance. `currency` is
    // `earnedTotal - spentTotal` by construction, and the merge relies on
    // that holding - a spend that skips this one line reappears as free
    // money the next time two copies of the profile meet.
    profile.spentTotal += result.pointsSpent;
    saveNow();
  }
  /** The grade is a profile setting, so it's owned here alongside the other
   * profile mutations - SkillTreeScreen only reads it and calls back. */
  function selectGrade(grade: GradeLevel) {
    profile.selectedGrade = grade;
    saveNow();
  }
  /** Leaving the shop picks a starting wave rather than starting the run:
   * where a run begins is a decision about the run, not a purchase. */
  function goToRunSetup() {
    startWave = freeStartWave(profile);
    phase = 'runSetup';
  }
  /** Spends currency to push the starting wave one boss interval further,
   * charged this run only. */
  function buySkip() {
    const target = nextSkipTarget(profile, startWave);
    if (target === null) return;
    const purchase = purchaseSkip(profile, startWave, target);
    if (!purchase) return;
    profile.currency = purchase.profile.currency;
    profile.spentTotal += purchase.spent;
    startWave = purchase.startWave;
    saveNow();
  }
  function startRun() {
    resetRun(runtime, profile, startWave);
    runStartedAtMs = performance.now();
    bossesDefeatedThisRun = 0;
    saveNow();
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
    }
  }

  /** Phases where nothing is being simulated, so replacing the profile
   * cannot race a mutation in flight. */
  const SAFE_TO_APPLY: GamePhase[] = ['boot', 'skillTree', 'runSetup', 'gameover'];
  let pendingRemote: PlayerProfile | null = null;
  /** The last finished run's per-topic tally. Read by the dev console
   * today; handed to the store when there is one to hand it to. */
  let lastRunMastery: TopicDelta[] = [];
  /** When the current run began, for `game_sessions.duration_ms`. Wall clock
   * rather than simulated time: the column records how long a child sat there,
   * which is not the same as how much the world advanced (the tick clamps at
   * 50ms, so a throttled tab diverges). */
  let runStartedAtMs = 0;
  /**
   * Bosses DEFEATED this run, which is not the same as bosses met.
   *
   * Only the mastery route counts. Outlasting a boss's survive clock is
   * escaping it, not killing it - the game already refuses to pay bounty or
   * run time for that, and `game_sessions.bosses_defeated` must not disagree
   * with the economy about what a defeat is.
   */
  let bossesDefeatedThisRun = 0;

  $effect(() => {
    if (pendingRemote === null || !SAFE_TO_APPLY.includes(phase)) return;
    // In place, never a reassignment - see the note on `profile`.
    Object.assign(profile, pendingRemote);
    pendingRemote = null;
  });

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
    /**
     * Tallies what each run practised. A subscriber like audio.ts, not a
     * participant: nothing in the game loop knows it is here.
     *
     * The deltas have nowhere to go yet - `skill_mastery` arrives with
     * the Supabase store. It is wired now because ATTRIBUTION is what is
     * expensive to retrofit: a run played before problems carried a topic
     * can never be recovered afterwards.
     */
    const mastery = createMasteryRecorder((deltas) => {
      lastRunMastery = deltas;
      // The deltas finally have somewhere to go. Read straight from `runtime`:
      // this fires on `game-over` before `endRun()` copies anything out, so the
      // run's own numbers are still live here.
      runs.submit({
        gameSlug: profileCodec.gameSlug,
        // The grade the run actually used, validated - not the raw preference.
        gradeLevel: resolveGrade(profile),
        waveReached: runtime.waveNumber,
        score: runtime.score,
        bossesDefeated: bossesDefeatedThisRun,
        durationMs: Math.max(0, Math.round(performance.now() - runStartedAtMs)),
        mastery: deltas,
        // Empty until ROADMAP.md PR 3 defines what an achievement may be based
        // on. `submit_run()` already accepts and de-duplicates the list, and
        // drops keys it does not recognise, so nothing here changes when they
        // arrive.
        achievements: [],
      });
    });

    if (import.meta.env.DEV) installSkillTreeDebugTools(profile, saveNow, () => mastery.tally(), () => lastRunMastery);

    // Nothing produces remote state yet - the localStorage store has no
    // "elsewhere" to hear from. It is wired now because the rule is easy to
    // get wrong later: `gameFlow` mutates `profile` directly during tick(),
    // so state landing mid-run would race awardCurrency(). Hold it until a
    // phase where nothing is being simulated.
    const unbindRemote = progress.onRemote((merged) => {
      if (SAFE_TO_APPLY.includes(phase)) Object.assign(profile, merged);
      else pendingRemote = merged;
    });

    const unbindKeyboard = input.attachKeyboard(window);
    const unbindAudio = wireAudioToEvents();
    const unbindFlow = gameEvents.on(handleFlowEvent);
    const unbindInput = input.on((action) => {
      if (phase === 'playing') handleInputAction(runtime, profile, action);
    });

    // THE SIMULATION LOOP. GameCanvas runs a second, independent rAF loop for
    // drawing - keep the two straight when debugging timing.
    //
    // The 50ms clamp stops a backgrounded tab from teleporting the world on
    // its first frame back. The side effect is that when the browser throttles
    // rAF (an unfocused window), the game advances in slow motion, while
    // anything the renderer derives from absolute `performance.now()` - the
    // starfield, the reticle dashes, the shield pulse - keeps moving at full
    // speed. That combination reads convincingly like `tick()` has thrown an
    // exception when it hasn't.
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
      unbindRemote();
      mastery.dispose();
      cancelAnimationFrame(raf);
      runs.dispose();
      progress.dispose();
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
        <li>🎯 Only an exact answer takes an enemy out</li>
        <li>👍 Close answers shove it back up the screen - no penalty for trying</li>
        <li>🛡 Shielded enemies only break on an exact answer</li>
        <li>⚡ Beat a boss with its combo - just surviving one earns nothing</li>
        <li>⏱ Race the clock - enemies that get through cost you time</li>
        <li>💰 Defeat enemies to earn currency for permanent upgrades</li>
      </ul>
      <button class="big-btn" onclick={goToSkillTree}>Press Start ▶</button>
      <div class="mini-scores currency-note">💰 {profile.currency} banked</div>
    </div>
  {:else if phase === 'skillTree'}
    <SkillTreeScreen
      profile={profile}
      onPlay={goToRunSetup}
      onPurchase={purchaseSkill}
      onSelectGrade={selectGrade}
    />
  {:else if phase === 'runSetup'}
    <div class="boot">
      <h2 class="setup-title">Ready?</h2>
      <div class="setup-panel">
        <div class="setup-row">
          <span class="setup-label">Starting wave</span>
          <span class="setup-value">{startWave}{startsOnBoss(startWave) ? ' · BOSS' : ''}</span>
        </div>
        <p class="setup-note">
          {#if checkpointWave(profile) <= 1}
            Buy Checkpoint in the shop to start later runs further in.
          {:else if freeStartWave(profile) < checkpointWave(profile)}
            Checkpoint is ready for wave {checkpointWave(profile)} — reach it once and it's yours free.
          {:else}
            Checkpoint gets you to wave {freeStartWave(profile)} free, every run.
          {/if}
        </p>
        {#if skipTarget !== null}
          <button class="skip-btn" disabled={!canAffordSkip} onclick={buySkip}>
            Skip to wave {skipTarget} · 💰 {skipPrice}
          </button>
          <p class="setup-note">Charged this run only — you keep the Checkpoint wave for free.</p>
        {:else}
          <p class="setup-note">
            Wave {maxStartWave(profile)} is as far as you have reached — get further to skip further.
          </p>
        {/if}
      </div>
      <button class="big-btn" onclick={startRun}>Play ▶</button>
      <button class="big-btn" onclick={goToSkillTree}>◀ Skill Tree</button>
    </div>
  {:else}
    <div class="hud">
      <div class="hud-left">
        <div class="timer" class:low={timeLow}>⏱ {secondsRemaining}s</div>
        <div class="score">Score: {runtime.score}</div>
      </div>
      <div class="hud-mid">
        <div class="wave-label">{isBossPhase ? 'BOSS WAVE' : incoming ? 'INCOMING' : 'WAVE'}</div>
        <div class="wave-number">WAVE {runtime.waveNumber}</div>
        {#if isBossPhase}
          <div class="bar boss">
            <div class="fill" style="width:{(runtime.boss!.surviveRemainingMs / runtime.boss!.surviveTotalMs) * 100}%"></div>
          </div>
          <div class="boss-status">
            <span class="survive">🛡 Survive {surviveSeconds}s</span>
            <span class="combo" class:hot={runtime.boss!.combo > 0}>
              ⚡ {runtime.boss!.combo}/{runtime.boss!.comboRequired}
            </span>
          </div>
          <div class="boss-phase">{runtime.boss!.inFinale ? 'FINAL ATTACK' : bossPhaseName || runtime.boss!.name}</div>
        {:else}
          <div class="bar level"><div class="fill" style="width:{waveProgressPct}%"></div></div>
          <div class="wave-progress">
            {#if incoming}wave incoming{:else}{waveRemaining} left{/if}
          </div>
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

      {#if phase === 'gameover'}
        <div class="overlay">
          <h2>Time's Up!</h2>
          <p class="next-up">You reached wave {finalWave}.</p>
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
    color: var(--text);
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
    text-shadow: 3px 3px 0 var(--accent-warm);
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
    background: var(--surface);
    border: 3px solid var(--edge);
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
    background: var(--accent-hot);
    color: #fff;
    border: 3px solid var(--edge-strong);
    border-radius: 10px;
    cursor: pointer;
    box-shadow: 0 4px 0 rgba(0, 0, 0, 0.3);
  }
  .big-btn:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.3);
  }
  .setup-title {
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(14px, 4vw, 20px);
    margin: 0;
  }
  .setup-panel {
    background: var(--surface);
    border: 3px solid var(--edge);
    border-radius: 12px;
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    min-width: 260px;
  }
  .setup-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .setup-label {
    font-size: 12px;
    font-weight: 700;
    opacity: 0.8;
  }
  .setup-value {
    font-family: 'Press Start 2P', monospace;
    font-size: 15px;
  }
  .setup-note {
    margin: 0;
    font-size: 12px;
    text-align: center;
    opacity: 0.85;
  }
  .skip-btn {
    font-family: 'Press Start 2P', monospace;
    font-size: 10px;
    padding: 10px 14px;
    border: 3px solid var(--edge-strong);
    border-radius: 8px;
    background: var(--accent-warm);
    color: var(--bg);
    cursor: pointer;
  }
  .skip-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
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
    background: var(--surface);
    border: 3px solid var(--edge);
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
    color: var(--accent-hot);
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
  .wave-label {
    font-size: 11px;
    font-weight: 700;
    opacity: 0.8;
    letter-spacing: 0.08em;
  }
  .wave-number {
    font-family: 'Press Start 2P', monospace;
    font-size: 11px;
  }
  .wave-progress {
    font-size: 11px;
    font-weight: 700;
  }
  .boss-status {
    display: flex;
    gap: 10px;
    font-size: 11px;
    font-weight: 700;
  }
  .boss-status .combo {
    opacity: 0.6;
  }
  .boss-status .combo.hot {
    opacity: 1;
    color: var(--accent-violet);
  }
  .boss-phase {
    font-family: 'Press Start 2P', monospace;
    font-size: 8px;
    opacity: 0.75;
  }
  .bar {
    width: 100%;
    max-width: 260px;
    height: 10px;
    background: rgba(255, 255, 255, 0.09);
    border-radius: 5px;
    overflow: hidden;
    border: 2px solid var(--edge);
  }
  .bar .fill {
    height: 100%;
  }
  .bar.level .fill {
    background: linear-gradient(90deg, #3ddc97, #22c55e);
  }
  .bar.boss .fill {
    background: linear-gradient(90deg, #f87171, #fbbf24);
    transition: width 0.2s;
  }
  .mute-btn {
    border: 3px solid var(--edge);
    background: var(--surface-alt);
    color: var(--text);
    border-radius: 8px;
    width: 40px;
    height: 40px;
    font-size: 16px;
    cursor: pointer;
  }

  /* Was a 4px bezel nested inside App.svelte's CRT bezel - two frames around
     one canvas. The cabinet is gone, so this is just the pointer surface now. */
  .stage-wrapper {
    position: relative;
    border-radius: 10px;
    overflow: hidden;
    touch-action: none;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: rgba(6, 10, 22, 0.86);
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
    color: var(--accent-warm);
    text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.55);
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
    border: 3px solid var(--edge);
    background: var(--surface-alt);
    color: var(--text);
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
    border: 3px solid var(--edge);
    background: var(--surface-alt);
    color: var(--text);
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
    background: var(--accent-hot);
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
    border: 3px solid var(--edge);
    background: #3a4763;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #fff;
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.3);
  }
  .skill.ready {
    background: var(--accent-warm);
    color: var(--bg);
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
