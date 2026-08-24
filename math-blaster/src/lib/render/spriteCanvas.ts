import type { SpriteDef } from '../sprites';

/**
 * Pixel sprites are cheap to draw directly (a handful of fillRect calls
 * per sprite), but at dozens of enemies and 60fps it adds up - so each
 * sprite is rasterized once per pixel size into an offscreen canvas and
 * reused with drawImage from then on, which is dramatically cheaper than
 * re-issuing every fillRect call every frame.
 */
const bitmapCache = new Map<string, HTMLCanvasElement>();

function cacheKey(sprite: SpriteDef, pixel: number): string {
  // Sprites are static module-level objects, so identity + pixel size is
  // a stable, unique key without needing to hash the grid contents.
  return `${sprite.w}x${sprite.h}@${pixel}:${spriteIds.get(sprite) ?? registerSprite(sprite)}`;
}

let nextSpriteId = 1;
const spriteIds = new WeakMap<SpriteDef, number>();
function registerSprite(sprite: SpriteDef): number {
  const id = nextSpriteId++;
  spriteIds.set(sprite, id);
  return id;
}

function rasterize(sprite: SpriteDef, pixel: number): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = sprite.w * pixel;
  off.height = sprite.h * pixel;
  const octx = off.getContext('2d')!;
  octx.imageSmoothingEnabled = false;
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const cell = sprite.grid[y][x];
      if (cell === 0) continue;
      octx.fillStyle = sprite.palette[cell];
      octx.fillRect(x * pixel, y * pixel, pixel, pixel);
    }
  }
  return off;
}

function getBitmap(sprite: SpriteDef, pixel: number): HTMLCanvasElement {
  const key = cacheKey(sprite, pixel);
  let bmp = bitmapCache.get(key);
  if (!bmp) {
    bmp = rasterize(sprite, pixel);
    bitmapCache.set(key, bmp);
  }
  return bmp;
}

export interface DrawSpriteOptions {
  /** CSS filter syntax, e.g. 'hue-rotate(65deg)' - applied via the canvas
   * context's own filter property, same syntax the old DOM version used. */
  filter?: string;
  /** Centers the sprite horizontally on (x, y) instead of drawing from
   * the top-left corner - convenient for entities tracked by a single
   * anchor point. */
  centerX?: boolean;
}

/** Draws a sprite at (x, y) in canvas pixels, at the given on-screen pixel
 * size (each logical sprite pixel becomes a `pixel`-sized square). */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteDef,
  x: number,
  y: number,
  pixel: number,
  options: DrawSpriteOptions = {}
): void {
  const bmp = getBitmap(sprite, pixel);
  const drawX = options.centerX ? x - bmp.width / 2 : x;
  if (options.filter) {
    ctx.save();
    ctx.filter = options.filter;
    ctx.drawImage(bmp, drawX, y);
    ctx.restore();
  } else {
    ctx.drawImage(bmp, drawX, y);
  }
}

/** The rendered pixel dimensions of a sprite at a given size, without
 * drawing it - useful for layout (e.g. positioning a label above it). */
export function spriteSize(sprite: SpriteDef, pixel: number): { width: number; height: number } {
  return { width: sprite.w * pixel, height: sprite.h * pixel };
}

/** Clears the bitmap cache - exposed mainly for tests; the cache is
 * otherwise unbounded but small (one entry per sprite/size combination
 * actually used, not per enemy instance). */
export function clearSpriteCache(): void {
  bitmapCache.clear();
}
