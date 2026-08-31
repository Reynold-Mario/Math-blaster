/**
 * THE ART SOURCE. This is where the pixel grids that used to live in
 * src/lib/sprites.ts now live.
 *
 * The composition approach is unchanged - silhouettes are built from
 * ellipse/rect helpers rather than hand-typed pixel arrays, so they stay
 * clean and symmetric - but it runs at BUILD time and each builder emits N
 * frames instead of one. The runtime loads the resulting APNGs and generates
 * nothing.
 *
 * Native sizes are larger than the old grids (a grunt was 14x10, drawn at
 * 4.5 screen px per art px; it is now 32x24 drawn at 2). Same on-screen
 * footprint, more than four times the detail to animate with.
 *
 * Shared palette roles: 1 hull, 2 dark/shade, 3 glass/glow, 4 core/sensor,
 * 5 accent, 6 accent2, 7 accent3. 0 is transparent. Palette values accept
 * #rgb, #rrggbb and #rrggbbaa.
 *
 * HUES CARRY MEANING HERE, so don't recolour one of these in isolation:
 * the player is the only white-and-cyan thing on screen, enemies run warm
 * or violet, and the cyan of a shield bubble (COLOR_SHIELD in GameCanvas)
 * is deliberately not an enemy hull colour.
 */

// --- grid helpers -----------------------------------------------------

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
			if (inEllipse(x, y, cx, cy, rOuter, rOuter) && !inEllipse(x, y, cx, cy, rInner, rInner))
				g[y][x] = ch;
}
/** Mirrored pair, so anything symmetric is stated once. */
function pair(g, x, y, ch, w) {
	dot(g, x, y, ch);
	dot(g, w - 1 - x, y, ch);
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
	/**
	 * Drone - the baseline enemy (drifter, splitter, and spore at half scale).
	 * An alien scout saucer: it hovers rather than flies, so it bobs in place
	 * and sweeps a single eye instead of having any moving parts.
	 */
	drone: {
		w: 32,
		h: 24,
		frames: 6,
		delayMs: 130,
		palette: { 1: '#a5b4fc', 2: '#5b3aa8', 3: '#ddd6fe', 4: '#f0abfc', 5: '#facc15' },
		draw(g, i, n) {
			const bob = Math.round(wave(i, n));

			fillEllipse(g, 16, 14 + bob, 15, 4, 1); // saucer rim
			fillRect(g, 3, 15 + bob, 28, 17 + bob, 2); // underside in shadow
			fillEllipse(g, 16, 9 + bob, 8, 5, 3); // canopy dome

			// One eye, sweeping. A single sensor reads as "it is looking for you"
			// in a way two symmetrical ones do not.
			const scan = [-3, -1, 1, 3, 1, -1][i];
			fillEllipse(g, 16 + scan, 9 + bob, 2.6, 2.6, 4);

			// Three underside lamps, lit in sequence.
			[8, 16, 24].forEach((lx, k) => {
				if (k === i % 3) dot(g, lx, 18 + bob, 5);
			});
		}
	},

	/**
	 * Swarmer - the fast movers (weaver and diver). Insectoid interceptor:
	 * a narrow fuselage with wings that beat, which is what sells the weave
	 * its movement code already does.
	 */
	swarmer: {
		w: 36,
		h: 28,
		frames: 4,
		delayMs: 110,
		palette: { 1: '#fb923c', 2: '#9a4a24', 4: '#fde68a', 5: '#ea580c' },
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

			fillEllipse(g, 18, 14, 5, 9, 1); // fuselage
			fillRect(g, 16, 2, 19, 6, 5); // nose
			fillRect(g, 15, 10, 20, 12, 4); // forward sensors
			fillRect(g, 16, 22, 19, 24, 2); // tail

			// Engine flare, brightest on the down-beat.
			if (flap < -0.5) fillRect(g, 17, 25, 18, 26, 4);
		}
	},

	/**
	 * Hulk - the armoured pair (bulwark and sentinel), the enemies that take
	 * two answers. Built to look like it: a blocky gunship with side cannons,
	 * a visor that scans, and engines that flicker.
	 */
	hulk: {
		w: 32,
		h: 32,
		frames: 4,
		delayMs: 150,
		palette: { 1: '#94a3b8', 2: '#3a4763', 3: '#cbd5e1', 4: '#f97316', 5: '#fbbf24', 6: '#64748b' },
		draw(g, i) {
			fillRect(g, 7, 2, 24, 4, 6); // sensor mast
			if (i % 2 === 0) fillRect(g, 14, 0, 17, 1, 5); // mast beacon

			fillRect(g, 5, 5, 26, 21, 1); // armoured hull
			fillRect(g, 5, 5, 26, 8, 2); // upper plating
			fillRect(g, 9, 10, 22, 16, 3); // visor

			const scan = [-2, 0, 2, 0][i];
			fillRect(g, 12 + scan, 12, 14 + scan, 14, 4);
			fillRect(g, 18 + scan, 12, 20 + scan, 14, 4);

			fillRect(g, 0, 11, 3, 19, 5); // side cannons
			fillRect(g, 28, 11, 31, 19, 5);

			fillRect(g, 7, 22, 12, 29, 2); // engine housings
			fillRect(g, 19, 22, 24, 29, 2);
			// Engine flare alternates between the two nacelles.
			const lit = i % 2 === 0 ? 0 : 1;
			fillRect(g, 8 + lit * 12, 30, 11 + lit * 12, 31, 4);
		}
	},

	/**
	 * The player's interceptor. THE ONLY WHITE-AND-CYAN THING ON SCREEN -
	 * every enemy runs warm or violet, so the ship never gets lost among them.
	 *
	 * 19 rows, not 30, and that is load-bearing. The player is drawn with its
	 * TOP edge at PLAYER_Y_PCT (88% of a 320-tall canvas = y 282), so only
	 * ~38px of it is ever on screen - the old 12-row sprite had its bottom
	 * quarter clipped away and nobody noticed, because the clipped part was a
	 * plain dark bar. A thruster down there would be invisible, so the art
	 * fits the visible band instead: 19 rows x scale 2 = 38px exactly.
	 */
	player: {
		w: 36,
		h: 19,
		frames: 4,
		delayMs: 90,
		palette: { 1: '#e2e8f0', 2: '#54627e', 3: '#38bdf8', 5: '#22d3ee', 6: '#fff7d6' },
		draw(g, i) {
			fillRect(g, 16, 0, 19, 3, 3); // nose
			fillEllipse(g, 18, 9, 15, 6, 1); // hull
			fillRect(g, 14, 6, 21, 9, i % 2 === 0 ? 3 : 5); // canopy, pulsing
			fillRect(g, 0, 11, 35, 13, 2); // wings
			fillRect(g, 2, 10, 6, 10, 3); // wingtip lights
			fillRect(g, 29, 10, 33, 10, 3);

			const flame = [4, 2, 4, 3][i];
			for (let k = 0; k < flame; k++) {
				const halfW = Math.max(1, 4 - k);
				fillRect(g, 18 - halfW, 15 + k, 17 + halfW, 15 + k, k < 2 ? 6 : 5);
			}
		}
	},

	/** Dreadnought - the first boss hull. A capital ship: dorsal fin array,
	 * a bridge band, and two engine intakes that glare. */
	dreadnought: {
		w: 35,
		h: 30,
		frames: 6,
		delayMs: 140,
		palette: { 1: '#c084fc', 2: '#6b21a8', 3: '#f5d0fe', 4: '#2e1065', 6: '#fbbf24' },
		draw(g, i, n) {
			const bob = Math.round(wave(i, n)); // -1, 0 or 1
			fillEllipse(g, 17, 19 + bob, 16, 10, 1); // main hull
			fillRect(g, 2, 23 + bob, 32, 27 + bob, 1); // ventral deck
			fillRect(g, 2, 25 + bob, 32, 26 + bob, 2);

			fillRect(g, 10, 3 + bob, 24, 7 + bob, 6); // dorsal fin array
			// A glint travelling along the fins. The bob is round(sin), so it only
			// has three values - without a second cycle on a different period the
			// six frames collapse into a three-step idle.
			const fins = [
				[10, 2],
				[17, 1],
				[24, 2]
			];
			fins.forEach(([sx, sy], k) => {
				dot(g, sx, sy + bob - (k === i % 3 ? 1 : 0), 6);
			});
			fillRect(g, 8, 9 + bob, 26, 12 + bob, 6); // bridge band

			const glare = Math.abs(wave(i, n)) > 0.7 ? 1 : 0;
			for (const ex of [11, 24]) {
				fillEllipse(g, ex, 16 + bob, 3.2, 3.9, 3); // intake
				fillEllipse(g, ex, 16 + bob, 1.6 + glare, 2 + glare, 4);
			}
		}
	},

	/** Leviathan - the second boss hull. Heavier and darker than the
	 * dreadnought, with a wide green sensor band and legs that stay planted
	 * while the hull breathes. */
	leviathan: {
		w: 35,
		h: 35,
		frames: 6,
		delayMs: 140,
		palette: { 1: '#64748b', 2: '#3a4763', 3: '#86efac', 4: '#0b3d20', 5: '#f472b6', 7: '#facc15' },
		draw(g, i, n) {
			const bob = Math.round(wave(i, n));
			fillRect(g, 3, 7 + bob, 8, 11 + bob, 2); // shoulder pods
			fillRect(g, 26, 7 + bob, 31, 11 + bob, 2);
			if (i % 3 !== 2) {
				pair(g, 5, 5 + bob, 7, 35); // pod beacons
			}

			fillRect(g, 3, 10 + bob, 31, 27 + bob, 1); // hull
			fillRect(g, 3, 10 + bob, 31, 13 + bob, 2);
			fillRect(g, 9, 16 + bob, 25, 21 + bob, 3); // sensor band

			const scan = [-2, -1, 0, 1, 2, 0][i];
			fillRect(g, 12 + scan, 18 + bob, 14 + scan, 19 + bob, 4);
			fillRect(g, 20 + scan, 18 + bob, 22 + scan, 19 + bob, 4);
			fillRect(g, 14, 21 + bob, 20, 22 + bob, 4);

			fillRect(g, 0, 16 + bob, 2, 23 + bob, 5); // weapon booms
			fillRect(g, 32, 16 + bob, 34, 23 + bob, 5);
			fillRect(g, 7, 28, 14, 34, 2); // landing struts stay put
			fillRect(g, 20, 28, 27, 34, 2);
		}
	},

	/**
	 * A defeated enemy used to just vanish. This is what it does instead.
	 * The fade is baked into the palette (later frames draw with the
	 * translucent indices) so no per-frame alpha handling is needed.
	 */
	explosion: {
		w: 32,
		h: 32,
		frames: 8,
		delayMs: 55,
		palette: {
			1: '#fff7d6',
			2: '#fde047',
			3: '#fb923c',
			4: '#ef4444',
			5: '#fff7d6aa',
			6: '#fde047aa',
			7: '#fb923caa',
			8: '#ef4444aa',
			9: '#fb923c66',
			10: '#ef444455'
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
		}
	},

	/** The muzzle flash at the ship's nose when a shot is fired. */
	muzzle: {
		w: 16,
		h: 16,
		frames: 4,
		delayMs: 45,
		palette: { 1: '#fff7d6', 2: '#fde047', 3: '#67e8f9', 4: '#67e8f9aa' },
		draw(g, i) {
			const r = [2.5, 4.5, 3.5, 2][i];
			const spike = [4, 7, 5, 3][i];
			const ch = i >= 2 ? 4 : 3;
			fillRect(g, 8 - spike, 7, 7 + spike, 8, ch);
			fillRect(g, 7, 8 - spike, 8, 7 + spike, ch);
			fillEllipse(g, 8, 8, r, r, 2);
			fillEllipse(g, 8, 8, r - 1.5, r - 1.5, 1);
		}
	},

	/** The shot itself, rising from the ship. Purely cosmetic - shots resolve
	 * instantly in the game rules, so this never reports a hit. */
	bolt: {
		w: 8,
		h: 16,
		frames: 3,
		delayMs: 50,
		palette: { 1: '#fff7d6', 2: '#67e8f9', 3: '#67e8f9aa' },
		draw(g, i) {
			const jitter = [0, 1, 0][i];
			fillEllipse(g, 4, 8 + jitter, 2.5, 7, 3);
			fillEllipse(g, 4, 8 + jitter, 1.6, 5.5, 2);
			fillEllipse(g, 4, 8 + jitter, 0.9, 3.5, 1);
		}
	}
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
		parseInt(hex.slice(6, 8), 16)
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
