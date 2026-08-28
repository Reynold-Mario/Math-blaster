<script lang="ts">
  import { onMount } from 'svelte';
  import type { RuntimeState, EnemyInstance, PlayerState, BossState } from '../runtime/RuntimeState';
  import type { Backdrop } from '../levels/LevelDefinition';
  import {
    loadSpriteAtlas, drawSprite, spriteSize, spriteScale, spritePhase,
    frameIndexAt, frameIndexOnce, animationDurationMs, frameCount, type SpriteKey,
  } from './spriteAtlas';
  import { resolveTarget, weakPointXPct, type Target } from '../targeting';
  import { gameEvents, type GameEvent } from '../events';

  // Fixed logical resolution the whole scene is drawn at; the canvas
  // element itself scales responsively via CSS while staying crisp.
  const LOGICAL_W = 400;
  const LOGICAL_H = 320;

  const IMPACT_LINE_PCT = 86; // must match the orchestration layer's impact threshold
  const BOSS_Y_PCT = 12;
  const PLAYER_Y_PCT = 88;
  const FLOAT_DURATION_MS = 900;
  const FLASH_DURATION_MS = 150;
  const SHAKE_DURATION_MS = 260;

  interface Props {
    runtime: RuntimeState;
    theme: Backdrop;
    /**
     * Resolved by `packages/motion` and PASSED IN rather than read here, so this
     * component still draws from its props alone - the same reason `theme`
     * arrives this way instead of the canvas asking which wave it is.
     */
    reducedMotion: boolean;
  }
  let { runtime, theme, reducedMotion }: Props = $props();

  /* ------------------------------------------------------------------------
   * REDUCED MOTION, AND THE RULE IT FOLLOWS.
   *
   * `prefers-reduced-motion` is a safety setting here rather than a taste one:
   * for a photosensitive or vestibular child, three-layer parallax under a
   * screen shake under a 150ms hit flash is a hazard. So:
   *
   *   TAKE AWAY WHAT MOVES OR REPEATS. KEEP WHAT APPEARS, SAYS SOMETHING, AND
   *   GOES.
   *
   * Applied consistently that comes out as:
   *
   *   frozen  the parallax starfield; every looping sprite (each enemy holds
   *           the frame its own uid picked, so a formation still looks varied
   *           rather than stamped); the reticle's marching dashes; the shield
   *           and weak-point pulses
   *   gone    screen shake, the hit flash, and the muzzle and bolt of a shot
   *   still   an explosion - one frame, for the same beat the animation had
   *   kept    float text and banners in full. They are the information, and a
   *           fade is not movement; only their 40px rise is dropped.
   *
   * WHAT IS NOT NEGOTIABLE is the enemies' descent. It is the game rather than
   * an effect, and the setting is deliberately honest about only reaching
   * effects - a version where nothing falls is a different game, not a calmer
   * one. Nothing in here touches `runtime`.
   *
   * The hit flash is the one real loss: it said "your shot landed on THIS
   * target". What carries that instead is the float text, already drawn at the
   * target's own position. A brightness jump per hit, several a second while a
   * child holds FIRE, is precisely the luminance strobe the setting exists to
   * prevent.
   * --------------------------------------------------------------------- */

  /**
   * The clock every AMBIENT loop reads - anything whose whole job is to keep
   * changing while nothing is happening. Frozen under reduced motion, so every
   * `% totalMs` and every `Math.sin()` downstream resolves to a constant and no
   * call site has to learn that the setting exists.
   *
   * LIFETIMES MUST NOT USE IT. Floats, banners and one-shots all measure
   * `nowMs - createdAt` against real time; freezing that would strand every one
   * of them on screen forever.
   */
  function animClock(nowMs: number): number {
    return reducedMotion ? 0 : nowMs;
  }

  let canvasEl: HTMLCanvasElement;
  let fontsReady = false;

  // Presentation-only transient state, derived entirely from gameEvents -
  // none of this lives in RuntimeState, and nothing here feeds back into
  // gameplay logic.
  interface TextFloatFx {
    id: number;
    kind: 'text';
    xPct: number;
    y: number;
    text: string;
    color: string;
    createdAt: number;
  }
  interface DigitFloatFx {
    id: number;
    kind: 'digits';
    xPct: number;
    y: number;
    answerDigits: string;
    digitMatches: boolean[];
    createdAt: number;
  }
  type FloatFx = TextFloatFx | DigitFloatFx;
  let floatTexts: FloatFx[] = [];
  let floatIdCounter = 0;
  const flashUntil = new Map<string, number>();
  let shakeUntilMs = 0;

  /** A sprite animation played through exactly once at a fixed spot -
   * explosions, muzzle flashes, the bolt. It ends when the art runs out
   * (`frameIndexOnce` returns -1), so a lifetime is never duplicated here
   * as a constant. */
  interface OneShotFx {
    id: number;
    sprite: SpriteKey;
    xPct: number;
    /** Percent of canvas height, matching how enemies report position. */
    y: number;
    scale: number;
    createdAt: number;
    /** Percent of canvas height travelled per second - the bolt rises, the
     * rest stay put. */
    riseRatePct: number;
    /** CSS filter, for reusing one animation in more than one colour. */
    filter?: string;
  }
  let oneShots: OneShotFx[] = [];

  /**
   * The two one-shots one trigger-pull produces. Under reduced motion these are
   * SUPPRESSED where an explosion is merely frozen, and the difference is rate:
   * a child holding FIRE emits several a second, so even a still frame
   * appearing and vanishing that often is a strobe. A kill is rare enough to
   * keep, and is the one worth keeping.
   */
  const SHOT_COSMETICS: ReadonlySet<SpriteKey> = new Set<SpriteKey>(['muzzle', 'bolt']);

  function pushOneShot(fx: Omit<OneShotFx, 'id' | 'createdAt'>) {
    if (reducedMotion && SHOT_COSMETICS.has(fx.sprite)) return;
    oneShots.push({ ...fx, id: ++floatIdCounter, createdAt: performance.now() });
  }

  function pushFloat(xPct: number, y: number, text: string, color: string) {
    floatTexts.push({ id: ++floatIdCounter, kind: 'text', xPct, y, text, color, createdAt: performance.now() });
  }
  /** The "distinct visual indication" for a partial-credit hit: the
   * correct answer's digits, with the ones the player already had right
   * highlighted - more informative than a flat "Partial!" label. */
  function pushDigitFloat(xPct: number, y: number, answerDigits: string, digitMatches: boolean[]) {
    floatTexts.push({ id: ++floatIdCounter, kind: 'digits', xPct, y, answerDigits, digitMatches, createdAt: performance.now() });
  }
  function flashTarget(id: number | 'boss') {
    flashUntil.set(String(id), performance.now() + FLASH_DURATION_MS);
  }
  function isFlashing(id: number | 'boss', nowMs: number): boolean {
    const until = flashUntil.get(String(id));
    return until !== undefined && nowMs < until;
  }
  function triggerShake() {
    shakeUntilMs = performance.now() + SHAKE_DURATION_MS;
  }

  const COLOR_EXACT = '#86efac';
  const COLOR_CLOSE = '#fde68a';
  const COLOR_PARTIAL = '#fdba74';
  const COLOR_MISS = '#fca5a5';
  const COLOR_INFO = '#bae6fd';
  const COLOR_SHIELD = '#67e8f9';
  const COLOR_COMBO = '#f0abfc';

  /** A banner shown across the top for a beat - phase changes and wave
   * warnings need to be readable without competing with the hit floats
   * that cluster around wherever the player is aiming. */
  let bannerText = '';
  let bannerColor = COLOR_INFO;
  let bannerUntilMs = 0;
  const BANNER_DURATION_MS = 1400;

  function pushBanner(text: string, color: string) {
    bannerText = text;
    bannerColor = color;
    bannerUntilMs = performance.now() + BANNER_DURATION_MS;
  }

  function handleGameEvent(event: GameEvent) {
    switch (event.type) {
      case 'hit-exact':
      case 'hit-equivalent':
        pushFloat(event.xPct, event.y, 'HIT!', COLOR_EXACT);
        flashTarget(event.targetId);
        break;
      case 'hit-close':
        pushFloat(event.xPct, event.y, 'Close!', COLOR_CLOSE);
        flashTarget(event.targetId);
        break;
      case 'hit-partial':
        pushDigitFloat(event.xPct, event.y, event.answerDigits, event.digitMatches);
        flashTarget(event.targetId);
        break;
      case 'hit-incorrect':
        pushFloat(event.xPct, event.y, 'Miss', COLOR_MISS);
        break;
      case 'hit-invalid':
        break;
      case 'shield-blocked':
        pushFloat(event.xPct, event.y, 'BLOCKED', COLOR_SHIELD);
        break;
      case 'shield-broken':
        pushFloat(event.xPct, event.y, 'SHIELD DOWN!', COLOR_SHIELD);
        flashTarget(event.targetId);
        // Reuses the explosion, hue-shifted to the shield colour rather
        // than spending another sprite on a once-per-fight event.
        pushOneShot({ sprite: 'explosion', xPct: event.xPct, y: event.y, scale: 2, riseRatePct: 0, filter: 'hue-rotate(150deg) saturate(1.4)' });
        break;
      case 'enemy-layer-broken':
        pushFloat(event.xPct, event.y, `${event.layersRemaining} LEFT`, COLOR_PARTIAL);
        break;
      case 'enemy-knockback':
        // Reads as ground gained rather than damage dealt - what a
        // close-but-not-exact answer actually buys is time.
        pushFloat(event.xPct, event.y, 'PUSHED BACK!', COLOR_CLOSE);
        break;
      case 'enemy-split':
        pushFloat(event.xPct, event.y, 'SPLIT!', COLOR_PARTIAL);
        break;
      case 'enemy-defeated':
        // An answered enemy used to simply disappear between frames. The
        // event has always been on the bus; nothing was listening for it.
        pushOneShot({ sprite: 'explosion', xPct: event.xPct, y: event.y, scale: 2, riseRatePct: 0 });
        break;
      case 'shot-fired':
        pushOneShot({ sprite: 'muzzle', xPct: event.xPct, y: PLAYER_Y_PCT + 1, scale: 2, riseRatePct: 0 });
        // Cosmetic only: shots resolve instantly in the game rules, so this
        // never reports a hit and nothing waits for it to arrive.
        pushOneShot({ sprite: 'bolt', xPct: event.xPct, y: PLAYER_Y_PCT - 6, scale: 2, riseRatePct: -220 });
        break;
      case 'wave-announced':
        pushBanner(event.isBoss ? `WAVE ${event.waveNumber} - BOSS` : `WAVE ${event.waveNumber}`, event.isBoss ? COLOR_MISS : COLOR_INFO);
        if (event.isBoss) triggerShake();
        break;
      case 'wave-cleared':
        // Reports the wave that just ended; `wave-announced` names the one
        // coming next a beat later.
        pushBanner(`WAVE ${event.waveNumber} CLEAR!`, COLOR_EXACT);
        break;
      case 'time-gained':
        pushFloat(50, 70, `+${(event.amountMs / 1000).toFixed(1)}s`, COLOR_EXACT);
        break;
      case 'wave-record':
        // Nothing drawn: it fires on nearly every wave of a good run, and
        // the wave number in the HUD already says how far they've got.
        break;
      case 'boss-defeated':
        // The stage-clear screen used to report how a fight was won. There
        // isn't one any more, so the banner has to carry it - including the
        // fact that outlasting a boss pays nothing, which is otherwise
        // invisible: no float text appears for a payout that never happened.
        if (event.by === 'mastery') {
          pushBanner(`MASTERED - ${event.bestCombo} IN A ROW!`, COLOR_COMBO);
          // Only a mastery finish is a kill; an escaped boss leaves under
          // its own power, so it gets no explosion.
          pushOneShot({ sprite: 'explosion', xPct: 50, y: BOSS_Y_PCT + 8, scale: 5, riseRatePct: 0 });
          triggerShake();
        } else {
          pushBanner('BOSS ESCAPED - NO BOUNTY', COLOR_MISS);
        }
        break;
      case 'boss-phase-changed':
        pushBanner(event.name.toUpperCase(), COLOR_MISS);
        triggerShake();
        break;
      case 'boss-shield-raised':
        pushBanner('SHIELD UP - HIT THE WEAK POINT', COLOR_SHIELD);
        break;
      case 'boss-combo':
        pushFloat(50, 26, `COMBO ${event.combo}/${event.required}`, COLOR_COMBO);
        break;
      case 'boss-combo-broken':
        if (event.lostCombo > 1) pushFloat(50, 26, 'COMBO LOST', COLOR_MISS);
        break;
      case 'boss-timer-cut':
        pushFloat(50, 20, `-${(event.amountMs / 1000).toFixed(1)}s`, COLOR_EXACT);
        break;
      case 'boss-finale-started':
        pushBanner('FINAL ATTACK!', COLOR_MISS);
        triggerShake();
        break;
      case 'impact-avoided':
        pushFloat(50, 78, 'Dodged!', COLOR_INFO);
        break;
      case 'skill-used':
        pushFloat(50, 8, event.skill, COLOR_INFO);
        break;
      case 'time-lost':
        pushFloat(50, 78, `-${(event.amountMs / 1000).toFixed(1)}s`, COLOR_MISS);
        triggerShake();
        break;
      default:
        break;
    }
  }

  onMount(() => {
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvasEl.width = LOGICAL_W * dpr;
    canvasEl.height = LOGICAL_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Sprites are pixel art scaled by whole numbers, so every interpolated
    // sample is wrong. Without this the DPR transform resamples every
    // sprite, every frame - it was the one real per-frame cost in here.
    ctx.imageSmoothingEnabled = false;

    document.fonts?.ready?.then(() => {
      fontsReady = true;
    });

    // Same shape as the font gate above: start it, draw silhouettes until
    // it lands. In practice it resolves during the boot screen, long before
    // anything is on the canvas.
    void loadSpriteAtlas();

    starLayers = buildStarLayers();

    const unsubscribe = gameEvents.on(handleGameEvent);

    let raf = 0;
    const loop = () => {
      draw(ctx, performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  });

  function px(pct: number, span: number): number {
    return (pct / 100) * span;
  }

  /**
   * Parallax star layers. Far/dim/slow through near/bright/fast - the
   * difference in rates is the whole effect, so keep them spread apart.
   * Speeds are logical px per second, downward, which reads as the ship
   * making way rather than the stars falling.
   */
  const STAR_LAYERS = [
    { count: 110, size: 1, alpha: 0.4, speed: 5 },
    { count: 50, size: 1, alpha: 0.72, speed: 13 },
    { count: 18, size: 2, alpha: 0.95, speed: 26 },
  ];
  let starLayers: HTMLCanvasElement[] = [];

  /** Deterministic PRNG. The starfield must be identical on every frame and
   * every run - Math.random() here would make the sky boil. */
  function mulberry32(seed: number): () => number {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Rendered once, then scrolled with drawImage. Re-issuing a few hundred
   * fillRects per frame would cost more than the whole rest of the scene. */
  function buildStarLayers(): HTMLCanvasElement[] {
    return STAR_LAYERS.map((layer, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = LOGICAL_W;
      canvas.height = LOGICAL_H;
      const lctx = canvas.getContext('2d')!;
      const random = mulberry32(0x5eed + index * 7919);
      for (let i = 0; i < layer.count; i++) {
        // A little alpha variation stops a layer reading as a regular grid.
        lctx.fillStyle = `rgba(255,255,255,${(layer.alpha * (0.55 + random() * 0.45)).toFixed(3)})`;
        lctx.fillRect(
          Math.floor(random() * LOGICAL_W),
          Math.floor(random() * LOGICAL_H),
          layer.size,
          layer.size
        );
      }
      return canvas;
    });
  }

  /**
   * The sky and nebula gradients, cached by the colours they were built
   * from. The backdrop blends continuously with the wave number, so these
   * change a few times a run - rebuilding them 60 times a second (which is
   * what the old code did with the sky gradient) is pure waste.
   */
  let gradientCache: { key: string; sky: CanvasGradient; nebula: CanvasGradient } | null = null;

  function backdropGradients(ctx: CanvasRenderingContext2D) {
    const key = `${theme.sky1}|${theme.sky2}`;
    if (gradientCache?.key === key) return gradientCache;

    const sky = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    sky.addColorStop(0, theme.sky1);
    sky.addColorStop(1, theme.sky2);

    // A soft bloom of the rung's own colour, high and off-centre, so the
    // sky has some structure behind the stars instead of a flat ramp.
    const nebula = ctx.createRadialGradient(LOGICAL_W * 0.68, LOGICAL_H * 0.16, 8, LOGICAL_W * 0.68, LOGICAL_H * 0.16, LOGICAL_W * 0.62);
    nebula.addColorStop(0, theme.sky1);
    nebula.addColorStop(1, 'rgba(0,0,0,0)');

    gradientCache = { key, sky, nebula };
    return gradientCache;
  }

  function drawBackground(ctx: CanvasRenderingContext2D, nowMs: number) {
    const { sky, nebula } = backdropGradients(ctx);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Kept low on purpose: the bloom paints sky1 back over itself, so on the
    // brighter rungs (Ember Nebula, Golden Nebula) a heavier alpha washes the
    // top half out and starts competing with the problem the player is
    // reading. It is meant to add structure, not light.
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.restore();

    // Each layer is drawn twice, offset by a screen height, so the scroll
    // wraps without a seam.
    for (let i = 0; i < starLayers.length; i++) {
      const offset = ((animClock(nowMs) / 1000) * STAR_LAYERS[i].speed) % LOGICAL_H;
      ctx.drawImage(starLayers[i], 0, Math.round(offset) - LOGICAL_H);
      ctx.drawImage(starLayers[i], 0, Math.round(offset));
    }

    // The planet below. `Backdrop.ground` kept its name through the space
    // retheme - it is still "the band under the line they must not cross".
    const groundY = px(IMPACT_LINE_PCT, LOGICAL_H);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, groundY, LOGICAL_W, LOGICAL_H - groundY);

    ctx.save();
    // A lit limb along the top edge, which is what makes the band read as a
    // world rather than a rectangle.
    ctx.fillStyle = 'rgba(226,232,240,0.22)';
    ctx.fillRect(0, groundY, LOGICAL_W, 2);

    // Light, not black: the impact line has to show against a dark sky.
    ctx.strokeStyle = 'rgba(226,232,240,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(LOGICAL_W, groundY);
    ctx.stroke();
    ctx.restore();
  }

  /** A generic 0-1 meter. Named for what it is rather than what it once
   * drew - the only meter left in the game is the boss's survive clock;
   * nothing here has health. */
  function drawMeterBar(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, height: number, ratio: number, isBoss: boolean) {
    const x = cx - width / 2;
    ctx.fillStyle = 'rgba(8,12,26,0.6)';
    ctx.fillRect(x, y, width, height);
    const fillW = width * Math.max(0, Math.min(1, ratio));
    const grad = ctx.createLinearGradient(x, 0, x + width, 0);
    if (isBoss) {
      grad.addColorStop(0, '#f87171');
      grad.addColorStop(1, '#fbbf24');
    } else {
      grad.addColorStop(0, '#3ddc97');
      grad.addColorStop(1, '#86efac');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, fillW, height);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  }

  function labelFont(size: number): string {
    return `${size}px ${fontsReady ? "'Press Start 2P', " : ''}monospace`;
  }

  function drawLabel(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, big: boolean) {
    const fontSize = big ? 13 : 11;
    ctx.font = labelFont(fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = big ? 9 : 6;
    const boxH = big ? 24 : 20;
    const textW = ctx.measureText(text).width;
    const boxW = textW + padX * 2;
    const x = cx - boxW / 2;

    ctx.fillStyle = big ? '#dbeafe' : '#eef4ff';
    ctx.strokeStyle = '#0b1226';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#101a30';
    ctx.fillText(text, cx, y + boxH / 2 + 1);
  }

  function drawReticle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: { width: number; height: number }, nowMs: number) {
    ctx.save();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.lineDashOffset = -((animClock(nowMs) / 30) % 13);
    const pad = 8;
    ctx.strokeRect(cx - size.width / 2 - pad, cy - pad, size.width + pad * 2, size.height + pad * 2);
    ctx.restore();
  }

  function flashFilter(active: boolean): string {
    return active && !reducedMotion ? 'brightness(2.2) saturate(0.4)' : '';
  }

  /** A translucent bubble around whatever is still shielded. Drawn rather
   * than sprited so it works for every enemy silhouette and for both
   * bosses without needing new pixel art. */
  function drawShieldBubble(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: { width: number; height: number },
    nowMs: number
  ) {
    const pulse = 0.55 + 0.25 * Math.sin(animClock(nowMs) / 180);
    ctx.save();
    ctx.strokeStyle = COLOR_SHIELD;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, size.width / 2 + 7, size.height / 2 + 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = pulse * 0.16;
    ctx.fillStyle = COLOR_SHIELD;
    ctx.fill();
    ctx.restore();
  }

  /** One pip per remaining layer, so "this one needs two more answers" is
   * visible before the player commits to a target rather than only after
   * they've spent a shot on it. */
  function drawLayerPips(ctx: CanvasRenderingContext2D, cx: number, y: number, remaining: number, total: number) {
    const pip = 5;
    const gap = 3;
    const totalW = total * pip + (total - 1) * gap;
    let x = cx - totalW / 2;
    for (let i = 0; i < total; i++) {
      ctx.fillStyle = i < remaining ? '#fbbf24' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, pip, pip);
      ctx.strokeStyle = 'rgba(8,12,26,0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, pip - 1, pip - 1);
      x += pip + gap;
    }
  }

  function drawEnemy(ctx: CanvasRenderingContext2D, enemy: EnemyInstance, target: Target, nowMs: number) {
    const x = px(enemy.xPct, LOGICAL_W);
    const y = px(enemy.y, LOGICAL_H);
    const scale = spriteScale(enemy.kind, enemy.mini);
    const size = spriteSize(enemy.kind, scale);
    const isTargeted = target.kind === 'enemy' && target.enemy.uid === enemy.uid;

    if (enemy.layersTotal > 1) {
      drawLayerPips(ctx, x, y - 19, enemy.layersRemaining, enemy.layersTotal);
    }

    // The uid-derived phase is what stops six identical drifters breathing
    // in unison. It needs no state on the enemy itself.
    drawSprite(ctx, enemy.kind, x, y, scale, {
      centerX: true,
      filter: flashFilter(isFlashing(enemy.uid, nowMs)),
      frame: frameIndexAt(enemy.kind, animClock(nowMs), spritePhase(enemy.uid)),
    });
    if (enemy.shielded) drawShieldBubble(ctx, x, y + size.height / 2, size, nowMs);

    if (enemy.frozen) {
      ctx.save();
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('❄', x + size.width / 2 + 4, y - 2);
      ctx.restore();
    }

    drawLabel(ctx, x, y + size.height + 6, enemy.problem.displayText, false);

    if (isTargeted) drawReticle(ctx, x, y + size.height / 2, size, nowMs);
  }

  /** The combo track, drawn as pips under the survive bar. This is the
   * second win condition, so it needs to be as legible as the first. */
  function drawComboPips(ctx: CanvasRenderingContext2D, cx: number, y: number, combo: number, required: number) {
    const pip = 6;
    const gap = 4;
    const totalW = required * pip + (required - 1) * gap;
    let x = cx - totalW / 2;
    for (let i = 0; i < required; i++) {
      ctx.fillStyle = i < combo ? COLOR_COMBO : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(x + pip / 2, y + pip / 2, pip / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(8,12,26,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      x += pip + gap;
    }
  }

  /** The exposed weak point: the only place a shielded boss can be hurt,
   * and the reason its position matters. Drawn from the same
   * weakPointXPct() the targeting rules use, so what the player aims at is
   * exactly what they see. */
  function drawWeakPoint(ctx: CanvasRenderingContext2D, boss: BossState, targeted: boolean, nowMs: number) {
    const x = px(weakPointXPct(boss), LOGICAL_W);
    const y = px(BOSS_Y_PCT, LOGICAL_H) + spriteSize(boss.sprite).height / 2;
    const pulse = 5 + 2.5 * Math.sin(animClock(nowMs) / 120);

    ctx.save();
    ctx.fillStyle = '#f87171';
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (targeted) drawReticle(ctx, x, y - 10, { width: 20, height: 20 }, nowMs);
  }

  function drawBoss(ctx: CanvasRenderingContext2D, boss: BossState, target: Target, nowMs: number) {
    const x = px(boss.xPct, LOGICAL_W);
    const y = px(BOSS_Y_PCT, LOGICAL_H);
    const scale = spriteScale(boss.sprite);
    const size = spriteSize(boss.sprite, scale);
    const isTargeted = target.kind === 'boss';

    // The bar is the survive clock, not health - it drains toward the
    // player winning rather than toward the boss dying.
    drawMeterBar(ctx, x, y - 22, 96, 9, boss.surviveRemainingMs / boss.surviveTotalMs, true);
    drawComboPips(ctx, x, y - 10, boss.combo, boss.comboRequired);

    drawSprite(ctx, boss.sprite, x, y, scale, {
      centerX: true,
      filter: flashFilter(isFlashing('boss', nowMs)),
      frame: frameIndexAt(boss.sprite, animClock(nowMs)),
    });

    if (!boss.vulnerable) {
      drawShieldBubble(ctx, x, y + size.height / 2, size, nowMs);
      drawWeakPoint(ctx, boss, target.kind === 'boss-weak-point', nowMs);
    }

    drawLabel(ctx, x, y + size.height + 8, boss.problem.displayText, true);

    if (isTargeted) drawReticle(ctx, x, y + size.height / 2, size, nowMs);
  }

  function drawBanner(ctx: CanvasRenderingContext2D, nowMs: number) {
    if (nowMs > bannerUntilMs || !bannerText) return;
    const remaining = (bannerUntilMs - nowMs) / BANNER_DURATION_MS;

    ctx.save();
    ctx.globalAlpha = Math.min(1, remaining * 2.5);
    ctx.font = labelFont(11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const boxW = ctx.measureText(bannerText).width + 18;
    const boxH = 22;
    const x = LOGICAL_W / 2 - boxW / 2;
    const y = 6;

    ctx.fillStyle = 'rgba(8, 12, 26, 0.88)';
    ctx.strokeStyle = bannerColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = bannerColor;
    ctx.fillText(bannerText, LOGICAL_W / 2, y + boxH / 2 + 1);
    ctx.restore();
  }

  function drawPlayer(ctx: CanvasRenderingContext2D, player: PlayerState, nowMs: number) {
    const x = px(player.xPct, LOGICAL_W);
    const y = px(PLAYER_Y_PCT, LOGICAL_H);
    drawSprite(ctx, 'player', x, y, spriteScale('player'), {
      centerX: true,
      frame: frameIndexAt('player', animClock(nowMs)),
    });

    const text = player.inputBuffer || '·';
    ctx.font = labelFont(15);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 10;
    const boxH = 22;
    const boxW = ctx.measureText(text).width + padX * 2;
    const bx = x - boxW / 2;
    const by = y - boxH - 4;

    ctx.fillStyle = player.inputBuffer ? '#a5f3fc' : '#eef4ff';
    ctx.strokeStyle = '#0b1226';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#101a30';
    ctx.fillText(text, x, by + boxH / 2 + 1);
  }

  function drawTextFloat(ctx: CanvasRenderingContext2D, f: TextFloatFx, x: number, y: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = labelFont(12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 7;
    const boxH = 22;
    const boxW = ctx.measureText(f.text).width + padX * 2;
    ctx.fillStyle = f.color;
    ctx.strokeStyle = '#0b1226';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - boxW / 2, y - boxH / 2, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#101a30';
    ctx.fillText(f.text, x, y + 1);
    ctx.restore();
  }

  /** Shows the correct answer's digits, greying in the ones the player
   * already had right - the "distinct visual indication" a flat
   * "Partial!" label can't give. */
  function drawDigitFloat(ctx: CanvasRenderingContext2D, f: DigitFloatFx, x: number, y: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = labelFont(13);
    ctx.textBaseline = 'middle';
    const digitWidths = f.answerDigits.split('').map((ch) => ctx.measureText(ch).width + 5);
    const totalW = digitWidths.reduce((a, b) => a + b, 0);
    const boxH = 24;

    ctx.fillStyle = '#eef4ff';
    ctx.strokeStyle = '#0b1226';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - totalW / 2 - 6, y - boxH / 2, totalW + 12, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    let cx = x - totalW / 2;
    for (let i = 0; i < f.answerDigits.length; i++) {
      ctx.fillStyle = f.digitMatches[i] ? '#16a34a' : '#7f8ea8';
      ctx.fillText(f.answerDigits[i], cx + digitWidths[i] / 2, y + 1);
      cx += digitWidths[i];
    }
    ctx.restore();
  }

  function drawFloatTexts(ctx: CanvasRenderingContext2D, nowMs: number) {
    floatTexts = floatTexts.filter((f) => nowMs - f.createdAt <= FLOAT_DURATION_MS);
    for (const f of floatTexts) {
      const t = (nowMs - f.createdAt) / FLOAT_DURATION_MS;
      const alpha = 1 - t;
      const x = px(f.xPct, LOGICAL_W);
      // The rise is the only movement here. The fade stays: it is what stops
      // labels piling up, and it is not motion.
      const y = px(f.y, LOGICAL_H) - (reducedMotion ? 0 : t * 40);

      if (f.kind === 'text') drawTextFloat(ctx, f, x, y, alpha);
      else drawDigitFloat(ctx, f, x, y, alpha);
    }
  }

  /**
   * Plays each one-shot through once and drops it when its art runs out.
   * Pruned here rather than on a timer for the same reason drawFloatTexts
   * does it: the draw pass is the only place that knows what is still
   * visible.
   */
  function drawOneShots(ctx: CanvasRenderingContext2D, nowMs: number) {
    const alive: OneShotFx[] = [];
    for (const fx of oneShots) {
      const elapsed = nowMs - fx.createdAt;
      const playing = frameIndexOnce(fx.sprite, elapsed);
      if (playing < 0) {
        // -1 also means "not decoded yet"; either way there is nothing to
        // draw and nothing to wait for.
        if (animationDurationMs(fx.sprite) === 0 && elapsed < 500) alive.push(fx);
        continue;
      }
      alive.push(fx);

      // Under reduced motion the effect is ONE frame held for the life the art
      // would have taken - so the lifetime still comes from the art rather than
      // from a second constant. The middle frame is the one that reads as
      // "something happened here"; the first is a spark and the last is smoke.
      const frame = reducedMotion ? Math.floor(frameCount(fx.sprite) / 2) : playing;
      const size = spriteSize(fx.sprite, fx.scale);
      // Only the bolt travels, and the bolt is already suppressed at the push -
      // this keeps the arithmetic true on its own rather than depending on that.
      const yPct = fx.y + (reducedMotion ? 0 : (fx.riseRatePct * elapsed) / 1000);
      drawSprite(ctx, fx.sprite, px(fx.xPct, LOGICAL_W), px(yPct, LOGICAL_H) - size.height / 2, fx.scale, {
        centerX: true,
        frame,
        filter: fx.filter,
      });
    }
    oneShots = alive;
  }

  /** `flashUntil` is keyed by enemy uid and enemies are endless, so without
   * this the map grows for the whole run. */
  function pruneFlashes(nowMs: number) {
    for (const [key, until] of flashUntil) {
      if (nowMs >= until) flashUntil.delete(key);
    }
  }

  function getShakeOffset(nowMs: number): { x: number; y: number } {
    if (reducedMotion || nowMs > shakeUntilMs) return { x: 0, y: 0 };
    const remainingMs = shakeUntilMs - nowMs;
    const intensity = Math.min(6, remainingMs / 40);
    return { x: (Math.random() - 0.5) * intensity * 2, y: (Math.random() - 0.5) * intensity * 2 };
  }

  function draw(ctx: CanvasRenderingContext2D, nowMs: number) {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    const shake = getShakeOffset(nowMs);
    ctx.save();
    ctx.translate(shake.x, shake.y);

    drawBackground(ctx, nowMs);

    const target = resolveTarget(runtime.player, runtime.enemies, runtime.boss);

    if (runtime.boss) drawBoss(ctx, runtime.boss, target, nowMs);
    for (const enemy of runtime.enemies) drawEnemy(ctx, enemy, target, nowMs);
    drawPlayer(ctx, runtime.player, nowMs);
    // Above the sprites, below the text: an explosion should cover the
    // thing it destroyed but never the problem the player is reading.
    drawOneShots(ctx, nowMs);
    drawFloatTexts(ctx, nowMs);
    pruneFlashes(nowMs);
    drawBanner(ctx, nowMs);

    ctx.restore();
  }
</script>

<canvas bind:this={canvasEl} class="game-canvas" aria-label="Game scene"></canvas>

<style>
  .game-canvas {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 400 / 320;
    image-rendering: pixelated;
    touch-action: none;
    border-radius: 10px;
  }
</style>
