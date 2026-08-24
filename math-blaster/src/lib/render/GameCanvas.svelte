<script lang="ts">
  import { onMount } from 'svelte';
  import type { RuntimeState, EnemyInstance, PlayerState, BossState } from '../runtime/RuntimeState';
  import type { StageTheme } from '../levels/LevelDefinition';
  import { SPRITES } from '../sprites';
  import { drawSprite, spriteSize } from './spriteCanvas';
  import { resolveTarget, type Target } from '../targeting';
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
    theme: StageTheme;
  }
  let { runtime, theme }: Props = $props();

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

    document.fonts?.ready?.then(() => {
      fontsReady = true;
    });

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

  function drawBackground(ctx: CanvasRenderingContext2D) {
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    grad.addColorStop(0, theme.sky1);
    grad.addColorStop(1, theme.sky2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    const groundY = px(IMPACT_LINE_PCT, LOGICAL_H);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, groundY, LOGICAL_W, LOGICAL_H - groundY);

    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(LOGICAL_W, groundY);
    ctx.stroke();
    ctx.restore();
  }

  function drawHpBar(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, height: number, ratio: number, isBoss: boolean) {
    const x = cx - width / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y, width, height);
    const fillW = width * Math.max(0, Math.min(1, ratio));
    const grad = ctx.createLinearGradient(x, 0, x + width, 0);
    if (isBoss) {
      grad.addColorStop(0, '#f87171');
      grad.addColorStop(1, '#fbbf24');
    } else {
      grad.addColorStop(0, '#4ade80');
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

    ctx.fillStyle = big ? '#fef08a' : '#fff9e6';
    ctx.strokeStyle = '#14213d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#14213d';
    ctx.fillText(text, cx, y + boxH / 2 + 1);
  }

  function drawReticle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: { width: number; height: number }, nowMs: number) {
    ctx.save();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.lineDashOffset = -((nowMs / 30) % 13);
    const pad = 8;
    ctx.strokeRect(cx - size.width / 2 - pad, cy - pad, size.width + pad * 2, size.height + pad * 2);
    ctx.restore();
  }

  function flashFilter(active: boolean): string {
    return active ? 'brightness(2.2) saturate(0.4)' : '';
  }

  function drawEnemy(ctx: CanvasRenderingContext2D, enemy: EnemyInstance, target: Target, nowMs: number) {
    const x = px(enemy.xPct, LOGICAL_W);
    const y = px(enemy.y, LOGICAL_H);
    const sprite = SPRITES[enemy.kind];
    const pixel = enemy.mini ? 3 : 4.5;
    const size = spriteSize(sprite, pixel);
    const isTargeted = target.kind === 'enemy' && target.enemy.uid === enemy.uid;

    if (enemy.hp < enemy.maxHp) {
      drawHpBar(ctx, x, y - 10, 40, 6, enemy.hp / enemy.maxHp, false);
    }

    drawSprite(ctx, sprite, x, y, pixel, { centerX: true, filter: flashFilter(isFlashing(enemy.uid, nowMs)) });

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

  function drawBoss(ctx: CanvasRenderingContext2D, boss: BossState, target: Target, nowMs: number) {
    const x = px(boss.xPct, LOGICAL_W);
    const y = px(BOSS_Y_PCT, LOGICAL_H);
    const sprite = SPRITES[boss.sprite];
    const pixel = 7;
    const size = spriteSize(sprite, pixel);
    const isTargeted = target.kind === 'boss';

    drawHpBar(ctx, x, y - 14, 96, 9, boss.hp / boss.maxHp, true);
    drawSprite(ctx, sprite, x, y, pixel, { centerX: true, filter: flashFilter(isFlashing('boss', nowMs)) });
    drawLabel(ctx, x, y + size.height + 8, boss.problem.displayText, true);

    if (isTargeted) drawReticle(ctx, x, y + size.height / 2, size, nowMs);
  }

  function drawPlayer(ctx: CanvasRenderingContext2D, player: PlayerState) {
    const x = px(player.xPct, LOGICAL_W);
    const y = px(PLAYER_Y_PCT, LOGICAL_H);
    drawSprite(ctx, SPRITES.player, x, y, 5, { centerX: true });

    const text = player.inputBuffer || '·';
    ctx.font = labelFont(15);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 10;
    const boxH = 22;
    const boxW = ctx.measureText(text).width + padX * 2;
    const bx = x - boxW / 2;
    const by = y - boxH - 4;

    ctx.fillStyle = player.inputBuffer ? '#fde68a' : '#ffffff';
    ctx.strokeStyle = '#14213d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#14213d';
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
    ctx.strokeStyle = '#14213d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - boxW / 2, y - boxH / 2, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#14213d';
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

    ctx.fillStyle = '#fff9e6';
    ctx.strokeStyle = '#14213d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - totalW / 2 - 6, y - boxH / 2, totalW + 12, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    let cx = x - totalW / 2;
    for (let i = 0; i < f.answerDigits.length; i++) {
      ctx.fillStyle = f.digitMatches[i] ? '#16a34a' : '#94a3b8';
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
      const y = px(f.y, LOGICAL_H) - t * 40;

      if (f.kind === 'text') drawTextFloat(ctx, f, x, y, alpha);
      else drawDigitFloat(ctx, f, x, y, alpha);
    }
  }

  function getShakeOffset(nowMs: number): { x: number; y: number } {
    if (nowMs > shakeUntilMs) return { x: 0, y: 0 };
    const remainingMs = shakeUntilMs - nowMs;
    const intensity = Math.min(6, remainingMs / 40);
    return { x: (Math.random() - 0.5) * intensity * 2, y: (Math.random() - 0.5) * intensity * 2 };
  }

  function draw(ctx: CanvasRenderingContext2D, nowMs: number) {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    const shake = getShakeOffset(nowMs);
    ctx.save();
    ctx.translate(shake.x, shake.y);

    drawBackground(ctx);

    const target = resolveTarget(runtime.player, runtime.enemies, runtime.boss);

    if (runtime.boss) drawBoss(ctx, runtime.boss, target, nowMs);
    for (const enemy of runtime.enemies) drawEnemy(ctx, enemy, target, nowMs);
    drawPlayer(ctx, runtime.player);
    drawFloatTexts(ctx, nowMs);

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
