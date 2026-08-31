/**
 * Generates public/sprites/*.apng from the art source in spriteFrames.mjs.
 *
 * The output is committed, so neither `npm run build` nor CI depends on this
 * script ever running - it is the art pipeline, not a build step. Re-run it
 * (`npm run sprites`) after editing spriteFrames.mjs.
 *
 * `npm run sprites -- --preview` prints ASCII frames instead of writing
 * files, which is the quickest way to check a silhouette without opening
 * the game.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeApng } from './apngEncode.mjs';
import { SPRITE_SOURCES, rasterizeFrame, blank } from './spriteFrames.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

function preview() {
	const ramp = ' .:-=+*#%@';
	for (const [key, source] of Object.entries(SPRITE_SOURCES)) {
		console.log(
			`\n=== ${key}  ${source.w}x${source.h}  ${source.frames} frames @ ${source.delayMs}ms ===`
		);
		for (let f = 0; f < source.frames; f++) {
			const g = blank(source.w, source.h);
			source.draw(g, f, source.frames);
			console.log(`-- frame ${f}`);
			for (const row of g) {
				console.log(row.map((c) => (c === 0 ? ' ' : ramp[Math.min(ramp.length - 1, c)])).join(''));
			}
		}
	}
}

function build() {
	mkdirSync(OUT_DIR, { recursive: true });
	let total = 0;
	for (const [key, source] of Object.entries(SPRITE_SOURCES)) {
		const frames = Array.from({ length: source.frames }, (_, i) => ({
			rgba: rasterizeFrame(source, i),
			delayMs: source.delayMs
		}));
		const bytes = encodeApng(frames, source.w, source.h);
		writeFileSync(join(OUT_DIR, `${key}.apng`), bytes);
		total += bytes.length;
		console.log(
			`${key.padEnd(10)} ${source.w}x${source.h}  ${String(source.frames).padStart(2)} frames  ${String(bytes.length).padStart(6)} bytes`
		);
	}
	console.log(
		`\n${Object.keys(SPRITE_SOURCES).length} sprites, ${(total / 1024).toFixed(1)} KB total -> public/sprites/`
	);
}

if (process.argv.includes('--preview')) preview();
else build();
