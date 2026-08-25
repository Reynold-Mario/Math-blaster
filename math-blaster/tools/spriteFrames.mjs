/**
 * THE ART SOURCE. This is where the pixel grids that used to live in
 * src/lib/sprites.ts now live.
 *
 * The composition approach is unchanged - silhouettes are built from
 * ellipse/rect helpers rather than hand-typed pixel arrays, so they stay
 * clean and symmetric - but it now runs at BUILD time and each builder
 * emits N frames instead of one. The runtime loads the resulting APNGs and
 * generates nothing.
 *
 * Native sizes are larger than the old grids (a slime was 14x10, drawn at
 * 4.5 screen px per art px; it is now 32x24 drawn at 2). Same on-screen
 * footprint, more than four times the detail to animate with.
 *
 * Shared palette roles: 1 body, 2 dark/shade, 3 eyeWhite/glass,
 * 4 eyePupil, 5 accent, 6 accent2, 7 accent3. 0 is transparent.
 * Palette values accept #rgb, #rrggbb and #rrggbbaa.
 */

// --- grid helpers (ported from the old sprites.ts) ---------------------

export function blank(w, h) {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
}
function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
function fillEllipse(g, cx, cy, rx, ry, ch) {
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++) if (inEllipse(x, y, cx, cy, rx, ry)) g[y][x] = ch;
}
function fillRect(g, x0, y0, x1, y1, ch) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++)
    for (let x = Math.round(x0); x <= Math.round(x1); x++)
      if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch;
}
function dot(g, x, y, ch) {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch;
}
/** A ring, used for the explosion's expanding shell. */
function fillRing(g, cx, cy, rOuter, rInner, ch) {
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++)
      if (inEllipse(x, y, cx, cy, rOuter, rOuter) && !inEllipse(x, y, cx, cy, rInner, rInner)) g[y][x] = ch;
}

/** A phase in [0,1) for frame i, so animation reads as a cycle rather than
 * a list of hand-placed poses. */
function phase(i, count) {
  return i / count;
}
function wave(i, count) {
  return Math.sin(phase(i, count) * Math.PI * 2);
}

// --- the roster -------------------------------------------------------

/**
 * Each entry: native frame size, per-frame delay, palette, frame count and
 * a draw(grid, frameIndex, frameCount) that paints one frame.
 *
 * delayMs is per frame; the runtime honours the authored delays rather than
 * assuming a uniform frame rate.
 */
export const SPRITE_SOURCES = {
  // A slime that breathes: the body squashes and stretches while its base
  // stays planted, and it blinks once per cycle.
  slime: {
    w: 32, h: 24, frames: 6, delayMs: 130,
    palette: { 1: '#4ade80', 2: '#16a34a', 3: '#ffffff', 4: '#14213d' },
    draw(g, i, n) {
      const squash = wave(i, n);
      const ry = 9 + squash * 1.1;
      const cy = 22 - ry; // base planted: bottom of the body stays at y=22
      fillEllipse(g, 16, cy, 15 - squash * 0.8, ry, 1);
      fillRect(g, 2, 19, 29, 22, 1);
      fillRect(g, 2, 21, 29, 22, 2);

      const blinking = i === 4;
      const eyeY = cy - 2;
      for (const ex of [10.5, 21.5]) {
        if (blinking) {
          fillRect(g, ex - 3, eyeY, ex + 2, eyeY + 1, 3);
        } else {
          fillEllipse(g, ex, eyeY, 3, 3.7, 3);
          fillRect(g, ex - 1.5, eyeY - 1, ex + 0.5, eyeY + 1, 4);
        }
      }
    },
  },

  // Wings sweep up and down; the membrane is thick at the shoulder and
  // thin at the tip, which is what makes a flap read as a flap.
  bat: {
    w: 36, h: 28, frames: 4, delayMs: 110,
    palette: { 1: '#c4b5fd', 4: '#1b1b2f', 5: '#7c3aed' },
    draw(g, i, n) {
      const flap = wave(i, n);
      const span = 11;
      for (let k = 0; k <= span; k++) {
        const d = k / span; // 0 at the shoulder, 1 at the tip
        // The 2.2*d term is a resting sweep: without it the mid-flap frames
        // read as a flat plank rather than a wing.
        const yc = 14 - flap * 5.5 * d - 2.2 * d;
        const half = 3.2 - 2.2 * d;
        const leftX = span - k;
        fillRect(g, leftX, yc - half, leftX, yc + half, 5);
        fillRect(g, 35 - leftX, yc - half, 35 - leftX, yc + half, 5);
      }
      fillEllipse(g, 18, 14, 7, 7, 1);
      fillRect(g, 12, 4, 15, 8, 1); // ears
      fillRect(g, 20, 4, 23, 8, 1);
      fillRect(g, 14, 13, 16, 15, 4); // eyes
      fillRect(g, 20, 13, 22, 15, 4);
    },
  },

  // Mechanical, so it animates mechanically: a blinking antenna lamp, a
  // visor pupil that sweeps, and treads that step.
  robot: {
    w: 32, h: 32, frames: 4, delayMs: 150,
    palette: { 1: '#93c5fd', 2: '#1e3a5f', 3: '#e0f7ff', 4: '#0891b2', 5: '#fb923c', 6: '#fde68a' },
    draw(g, i) {
      fillRect(g, 7, 2, 24, 4, 6);
      if (i % 2 === 0) fillRect(g, 14, 0, 17, 1, 5); // lamp

      fillRect(g, 5, 5, 26, 21, 1);
      fillRect(g, 5, 5, 26, 8, 2);
      fillRect(g, 9, 10, 22, 16, 3);

      const scan = [-2, 0, 2, 0][i];
      fillRect(g, 12 + scan, 12, 14 + scan, 14, 4);
      fillRect(g, 18 + scan, 12, 20 + scan, 14, 4);

      fillRect(g, 0, 11, 3, 19, 5); // arms
      fillRect(g, 28, 11, 31, 19, 5);

      const step = i % 2; // treads alternate, so it walks rather than slides
      fillRect(g, 7, 22 + step, 12, 31, 2);
      fillRect(g, 19, 23 - step, 24, 31, 2);
    },
  },

  // The player finally gets a thruster - the clearest possible signal that
  // the ship is a ship and that the game is running.
  /**
   * 19 rows, not 30, and that is load-bearing. The player is drawn with its
   * TOP edge at PLAYER_Y_PCT (88% of a 320-tall canvas = y 282), so only
   * ~38px of it is ever on screen - the old 12-row sprite had its bottom
   * quarter clipped away and nobody noticed, because the clipped part was a
   * plain dark bar. A thruster down there would be invisible, so the art
   * fits the visible band instead: 19 rows x scale 2 = 38px exactly.
   */
  player: {
    w: 36, h: 19, frames: 4, delayMs: 90,
    palette: { 1: '#60a5fa', 2: '#334155', 3: '#fef08a', 5: '#f87171', 6: '#fff7d6' },
    draw(g, i) {
      fillRect(g, 16, 0, 19, 3, 5); // nose
      fillEllipse(g, 18, 9, 15, 6, 1);
      fillRect(g, 14, 6, 21, 9, i % 2 === 0 ? 3 : 6); // canopy light
      fillRect(g, 0, 11, 35, 13, 2); // wings

      const flame = [4, 2, 4, 3][i];
      for (let k = 0; k < flame; k++) {
        const halfW = Math.max(1, 4 - k);
        fillRect(g, 18 - halfW, 15 + k, 17 + halfW, 15 + k, k < 2 ? 6 : 5);
      }
    },
  },

  boss1: {
    w: 35, h: 30, frames: 6, delayMs: 140,
    palette: { 1: '#c084fc', 2: '#7e22ce', 3: '#ffffff', 4: '#2e1065', 6: '#fbbf24' },
    draw(g, i, n) {
      const bob = Math.round(wave(i, n)); // -1, 0 or 1
      fillEllipse(g, 17, 19 + bob, 16, 10, 1);
      fillRect(g, 2, 23 + bob, 32, 27 + bob, 1);
      fillRect(g, 2, 25 + bob, 32, 26 + bob, 2);

      fillRect(g, 10, 3 + bob, 24, 7 + bob, 6); // crown
      // A glint travelling along the crown. The bob is round(sin), so it
      // only has three values - without a second cycle on a different
      // period the six frames collapse into a three-step idle.
      const spikes = [[10, 2], [17, 1], [24, 2]];
      spikes.forEach(([sx, sy], k) => {
        dot(g, sx, sy + bob - (k === i % 3 ? 1 : 0), 6);
      });
      fillRect(g, 8, 9 + bob, 26, 12 + bob, 6); // brow

      // Pupils dilate through the cycle - a slow glare rather than a blink.
      const dilate = (Math.abs(wave(i, n)) > 0.7) ? 1 : 0;
      for (const ex of [11, 24]) {
        fillEllipse(g, ex, 16 + bob, 3.2, 3.9, 3);
        fillEllipse(g, ex, 16 + bob, 1.6 + dilate, 2 + dilate, 4);
      }
    },
  },

  boss2: {
    w: 35, h: 35, frames: 6, delayMs: 140,
    palette: { 1: '#64748b', 2: '#1e293b', 3: '#86efac', 4: '#0f172a', 5: '#f472b6', 7: '#facc15' },
    draw(g, i, n) {
      const bob = Math.round(wave(i, n));
      fillRect(g, 3, 7 + bob, 8, 11 + bob, 2); // shoulders
      fillRect(g, 26, 7 + bob, 31, 11 + bob, 2);
      if (i % 3 !== 2) {
        dot(g, 5, 5 + bob, 7);
        dot(g, 29, 5 + bob, 7);
      }

      fillRect(g, 3, 10 + bob, 31, 27 + bob, 1);
      fillRect(g, 3, 10 + bob, 31, 13 + bob, 2);
      fillRect(g, 9, 16 + bob, 25, 21 + bob, 3);

      const scan = [-2, -1, 0, 1, 2, 0][i];
      fillRect(g, 12 + scan, 18 + bob, 14 + scan, 19 + bob, 4);
      fillRect(g, 20 + scan, 18 + bob, 22 + scan, 19 + bob, 4);
      fillRect(g, 14, 21 + bob, 20, 22 + bob, 4);

      fillRect(g, 0, 16 + bob, 2, 23 + bob, 5); // arms
      fillRect(g, 32, 16 + bob, 34, 23 + bob, 5);
      fillRect(g, 7, 28, 14, 34, 2); // legs stay planted while the hull bobs
      fillRect(g, 20, 28, 27, 34, 2);
    },
  },

  // A defeated enemy used to just vanish. This is what it does instead.
  // The fade is baked into the palette (later frames draw with the
  // translucent indices) so no per-frame alpha handling is needed.
  explosion: {
    w: 32, h: 32, frames: 8, delayMs: 55,
    palette: {
      1: '#fff7d6', 2: '#fde047', 3: '#fb923c', 4: '#ef4444',
      5: '#fff7d6aa', 6: '#fde047aa', 7: '#fb923caa', 8: '#ef4444aa',
      9: '#fb923c66', 10: '#ef444455',
    },
    draw(g, i, n) {
      const r = 4 + (i / (n - 1)) * 12; // 4 -> 16

      if (i <= 2) {
        // A filled fireball, hottest in the middle.
        fillEllipse(g, 16, 16, r, r, 4);
        fillEllipse(g, 16, 16, r * 0.74, r * 0.74, 3);
        fillEllipse(g, 16, 16, r * 0.46, r * 0.46, 2);
        fillEllipse(g, 16, 16, r * 0.2, r * 0.2, 1);
      } else if (i <= 5) {
        // Blown open. It has to become a SHELL here rather than staying a
        // filled disc - translucent discs stacked on each other just read
        // as a muddy brown blob, which is what the first pass looked like.
        const band = i === 3 ? 0 : 4; // opaque, then the translucent copies
        fillRing(g, 16, 16, r, r - 4, 3 + band);
        fillRing(g, 16, 16, r - 1, r - 3, 2 + band);
      } else {
        // Last breath.
        fillRing(g, 16, 16, r, r - 2, i === 6 ? 9 : 10);
      }
    },
  },

  // The muzzle flash at the ship's nose when a shot is fired.
  muzzle: {
    w: 16, h: 16, frames: 4, delayMs: 45,
    palette: { 1: '#fff7d6', 2: '#fde047', 3: '#67e8f9', 4: '#67e8f9aa' },
    draw(g, i) {
      const r = [2.5, 4.5, 3.5, 2][i];
      const spike = [4, 7, 5, 3][i];
      const ch = i >= 2 ? 4 : 3;
      fillRect(g, 8 - spike, 7, 7 + spike, 8, ch);
      fillRect(g, 7, 8 - spike, 8, 7 + spike, ch);
      fillEllipse(g, 8, 8, r, r, 2);
      fillEllipse(g, 8, 8, r - 1.5, r - 1.5, 1);
    },
  },

  // The shot itself, rising from the ship. Purely cosmetic - shots resolve
  // instantly in the game rules, so this never reports a hit.
  bolt: {
    w: 8, h: 16, frames: 3, delayMs: 50,
    palette: { 1: '#fff7d6', 2: '#67e8f9', 3: '#67e8f9aa' },
    draw(g, i) {
      const jitter = [0, 1, 0][i];
      fillEllipse(g, 4, 8 + jitter, 2.5, 7, 3);
      fillEllipse(g, 4, 8 + jitter, 1.6, 5.5, 2);
      fillEllipse(g, 4, 8 + jitter, 0.9, 3.5, 1);
    },
  },
};

// --- rasterization ----------------------------------------------------

function parseHex(value) {
  let hex = value.replace('#', '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  if (hex.length === 6) hex += 'ff';
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    parseInt(hex.slice(6, 8), 16),
  ];
}

/** One frame's grid -> RGBA bytes at native resolution (1 art px = 1 px). */
export function rasterizeFrame(source, frameIndex) {
  const g = blank(source.w, source.h);
  source.draw(g, frameIndex, source.frames);

  const rgba = new Uint8Array(source.w * source.h * 4);
  const cache = new Map();
  for (let y = 0; y < source.h; y++) {
    for (let x = 0; x < source.w; x++) {
      const cell = g[y][x];
      if (cell === 0) continue;
      let colour = cache.get(cell);
      if (!colour) {
        const hex = source.palette[cell];
        if (!hex) throw new Error(`Palette has no entry ${cell}.`);
        colour = parseHex(hex);
        cache.set(cell, colour);
      }
      rgba.set(colour, (y * source.w + x) * 4);
    }
  }
  return rgba;
}
