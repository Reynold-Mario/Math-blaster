import type { GruntKind, BossSpriteKind } from '../levels/enemyArchetypes';
import { decodeApng, type DecodedAnimation } from './apng';

/**
 * The sprite atlas: what art exists, how big it is on screen, and which
 * frame of it to draw right now.
 *
 * Replaces the old spriteCanvas.ts, which rasterized numeric pixel grids at
 * runtime. The grids now live in tools/spriteFrames.mjs and are baked into
 * animated PNGs at build time; this module just loads them.
 *
 * Two rules worth keeping:
 *
 * 1. ANIMATION STATE LIVES HERE, NEVER ON THE GAME STATE. Which frame an
 *    enemy is showing is a pure function of the clock and the enemy's uid
 *    (see `spritePhase`), so `EnemyInstance` gains no animation fields and
 *    the renderer stays a pure function of (runtime, theme, nowMs). If you
 *    find yourself adding a `frame` to an entity, stop.
 * 2. `spriteSize()` RETURNS THE ON-SCREEN FOOTPRINT, and it must work
 *    before the assets have loaded. Every overlay in GameCanvas - the
 *    problem label, the reticle box, the shield bubble, the layer pips, the
 *    boss weak point - is positioned from it, so if it changed once decode
 *    finished the entire HUD would jump. That is why native sizes are
 *    declared statically below rather than read off the decoded images.
 */

export type SpriteKey = GruntKind | BossSpriteKind | 'player' | 'explosion' | 'muzzle' | 'bolt';

interface SpriteMeta {
	/** Native frame size in the APNG, in art pixels. Must match the authored
	 * size in tools/spriteFrames.mjs - checked on load. */
	nativeW: number;
	nativeH: number;
	/**
	 * On-screen art pixels per native pixel. Always an INTEGER: the old
	 * pipeline rasterized at fractional sizes (grunts were 4.5), which is
	 * fine when you are drawing rectangles but turns into uneven pixel widths
	 * once you are scaling a bitmap with smoothing off.
	 */
	scale: number;
}

/**
 * Native sizes and scales are chosen so the on-screen footprints match what
 * the procedural sprites drew, to within a pixel or two - the layout around
 * them was tuned against those sizes.
 */
const SPRITE_META: Record<SpriteKey, SpriteMeta> = {
	drone: { nativeW: 32, nativeH: 24, scale: 2 }, // 64x48, was 63x45
	swarmer: { nativeW: 36, nativeH: 28, scale: 2 }, // 72x56, was 72x54
	hulk: { nativeW: 32, nativeH: 32, scale: 2 }, // 64x64, was 63x63
	// 19 rows, not 30: the player is drawn top-anchored at 88% of a 320-tall
	// canvas, so 38px is all that is ever visible. See the note on `player`
	// in tools/spriteFrames.mjs.
	player: { nativeW: 36, nativeH: 19, scale: 2 }, // 72x38 of a 72x60 slot
	dreadnought: { nativeW: 35, nativeH: 30, scale: 4 }, // 140x120, was 140x119
	leviathan: { nativeW: 35, nativeH: 35, scale: 4 }, // 140x140, was 140x140
	explosion: { nativeW: 32, nativeH: 32, scale: 2 },
	muzzle: { nativeW: 16, nativeH: 16, scale: 2 },
	bolt: { nativeW: 8, nativeH: 16, scale: 2 }
};

const SPRITE_KEYS = Object.keys(SPRITE_META) as SpriteKey[];

/** Assets are served from public/, so they are fetched by URL rather than
 * imported. Importing them would inline the small ones into the JS bundle
 * (Vite's default assetsInlineLimit) and would break `npm test`'s
 * type-check, which runs without vite/client's asset module declarations. */
const ASSET_BASE = `${import.meta.env.BASE_URL}sprites/`;

const decoded = new Map<SpriteKey, DecodedAnimation>();
let loadStarted = false;

/**
 * Decodes every sprite. Resolves once they are all in, or once they have all
 * failed - it never rejects, because a missing sprite must not take the game
 * down with it. Safe to call more than once.
 */
export async function loadSpriteAtlas(): Promise<void> {
	if (loadStarted) return;
	loadStarted = true;

	const results = await Promise.allSettled(
		SPRITE_KEYS.map(async (key) => {
			const animation = await decodeApng(`${ASSET_BASE}${key}.apng`);
			const meta = SPRITE_META[key];
			if (animation.width !== meta.nativeW || animation.height !== meta.nativeH) {
				// Not fatal - it will just draw at the wrong size - but it means the
				// atlas and the art pipeline have drifted apart.
				console.warn(
					`[sprites] ${key} is ${animation.width}x${animation.height} but the atlas says ` +
						`${meta.nativeW}x${meta.nativeH}. Re-run \`npm run sprites\` or fix SPRITE_META.`
				);
			}
			decoded.set(key, animation);
		})
	);

	const failures = results.filter((r) => r.status === 'rejected');
	if (failures.length > 0) {
		console.error(
			`[sprites] ${failures.length}/${SPRITE_KEYS.length} sprites failed to decode; ` +
				'drawing silhouettes instead.',
			failures.map((f) => (f as PromiseRejectedResult).reason)
		);
	}
}

/** The on-screen size of a sprite. Available before the art has loaded -
 * see the note at the top of this file. */
export function spriteSize(
	key: SpriteKey,
	scale: number = SPRITE_META[key].scale
): { width: number; height: number } {
	const meta = SPRITE_META[key];
	return { width: meta.nativeW * scale, height: meta.nativeH * scale };
}

/** The canonical on-screen scale for a sprite. `mini` enemies halve it,
 * which is what `mini` meant in the old pipeline too. */
export function spriteScale(key: SpriteKey, mini = false): number {
	return mini ? SPRITE_META[key].scale / 2 : SPRITE_META[key].scale;
}

/** How long one full cycle takes. Used to size one-shot effects' lifetimes
 * so they are driven by the art rather than by a duplicated constant. */
export function animationDurationMs(key: SpriteKey): number {
	return decoded.get(key)?.totalMs ?? 0;
}

/**
 * How many frames a sprite's art actually has, or 0 before it has decoded.
 *
 * Exists for reduced motion: `GameCanvas` draws ONE still frame of a one-shot
 * effect instead of playing it, and the frame worth showing is the middle one
 * (an explosion's first frame is a spark and its last is smoke). Picking that
 * needs the count, and the count belongs here with everything else about what
 * art exists.
 */
export function frameCount(key: SpriteKey): number {
	return decoded.get(key)?.frames.length ?? 0;
}

/**
 * A per-entity offset into the animation cycle, derived from the entity's
 * uid. Without it, a formation of six identical drifters blinks and breathes
 * in perfect unison, which reads as obviously mechanical.
 *
 * A cheap integer hash rather than a random number, because it must be
 * stable across frames and must not add state anywhere.
 */
export function spritePhase(uid: number): number {
	const scrambled = (Math.imul(uid, 2654435761) >>> 0) % 1000;
	return scrambled;
}

/** The looping frame for a sprite at `nowMs`, offset by `phaseMs`. */
export function frameIndexAt(key: SpriteKey, nowMs: number, phaseMs = 0): number {
	const animation = decoded.get(key);
	if (!animation) return 0;
	return frameAtElapsed(animation, (nowMs + phaseMs) % animation.totalMs);
}

/**
 * The frame for a one-shot effect that started `elapsedMs` ago, or -1 once
 * it has finished playing. Callers use the -1 to know when to drop the
 * effect, so its lifetime comes from the art's own timing.
 */
export function frameIndexOnce(key: SpriteKey, elapsedMs: number): number {
	const animation = decoded.get(key);
	if (!animation) return -1;
	if (elapsedMs >= animation.totalMs) return -1;
	return frameAtElapsed(animation, Math.max(0, elapsedMs));
}

function frameAtElapsed(animation: DecodedAnimation, elapsedMs: number): number {
	const { frameEndsMs } = animation;
	for (let i = 0; i < frameEndsMs.length; i++) {
		if (elapsedMs < frameEndsMs[i]) return i;
	}
	return frameEndsMs.length - 1;
}

export interface DrawSpriteOptions {
	/** CSS filter syntax, applied via the context's own filter property -
	 * this is how the 150ms hit flash tints a sprite. */
	filter?: string;
	/** Centers the sprite horizontally on x. y remains the TOP edge. */
	centerX?: boolean;
	/** Which frame to draw. Defaults to the first. */
	frame?: number;
	/** 0-1, for effects that fade out. */
	alpha?: number;
}

/**
 * Draws one frame of a sprite at (x, y), scaled by `scale`.
 *
 * Destination coordinates are rounded: positions arrive as percentages of
 * the logical canvas and are therefore fractional, and a bitmap drawn on a
 * half-pixel with smoothing off gets its columns unevenly doubled.
 */
export function drawSprite(
	ctx: CanvasRenderingContext2D,
	key: SpriteKey,
	x: number,
	y: number,
	scale: number = SPRITE_META[key].scale,
	options: DrawSpriteOptions = {}
): void {
	const { width, height } = spriteSize(key, scale);
	const drawX = Math.round(options.centerX ? x - width / 2 : x);
	const drawY = Math.round(y);

	const animation = decoded.get(key);
	const needsState = options.filter || options.alpha !== undefined;
	if (needsState) ctx.save();
	if (options.filter) ctx.filter = options.filter;
	if (options.alpha !== undefined) ctx.globalAlpha = options.alpha;

	if (animation) {
		const index = Math.min(animation.frames.length - 1, Math.max(0, options.frame ?? 0));
		ctx.drawImage(animation.frames[index], drawX, drawY, width, height);
	} else {
		drawSilhouette(ctx, drawX, drawY, width, height);
	}

	if (needsState) ctx.restore();
}

/**
 * What gets drawn when the art is missing - still loading, or failed to
 * decode. A plain shape, deliberately: the fallback for a broken APNG is a
 * canvas primitive, never a different image format.
 */
function drawSilhouette(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number
): void {
	ctx.save();
	ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
	ctx.strokeStyle = 'rgba(20, 33, 61, 0.7)';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.roundRect(x + 1, y + 1, width - 2, height - 2, 4);
	ctx.fill();
	ctx.stroke();
	ctx.restore();
}
