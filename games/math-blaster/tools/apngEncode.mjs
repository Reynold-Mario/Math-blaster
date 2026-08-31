/**
 * A minimal APNG writer. APNG only - this project never emits GIF, and there
 * is deliberately no second format here to fall back to.
 *
 * Deliberately unoptimised: every frame is written full-size with
 * dispose_op NONE / blend_op SOURCE, so a frame is simply "replace the
 * canvas with these pixels". That costs bytes we do not care about (sprites
 * are a few KB) and buys a writer with no inter-frame delta logic, plus a
 * decoder that never has to composite against history.
 *
 * Colour type 6 (8-bit RGBA) with filter type 0 (None) on every scanline,
 * so no predictor state either. Node's built-in zlib is the only dependency.
 */
import { deflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes) {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function u32(value) {
	return Uint8Array.from([
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff
	]);
}

function u16(value) {
	return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts) {
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** length + type + data + crc(type..data), the shape every PNG chunk takes. */
function chunk(type, data) {
	const typeBytes = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)));
	const body = concat([typeBytes, data]);
	return concat([u32(data.length), body, u32(crc32(body))]);
}

/** Raw RGBA rows, each prefixed with filter byte 0, then zlib-deflated. */
function compressRgba(rgba, width, height) {
	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0; // filter: None
		raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	return new Uint8Array(deflateSync(raw, { level: 9 }));
}

/**
 * `frames` is [{ rgba, delayMs }] where rgba is width*height*4 bytes.
 * A single frame still gets an acTL/fcTL so every asset decodes down the
 * same path rather than needing a static special case.
 */
export function encodeApng(frames, width, height) {
	if (frames.length === 0) throw new Error('encodeApng: no frames.');

	const parts = [SIGNATURE];

	parts.push(
		chunk(
			'IHDR',
			concat([
				u32(width),
				u32(height),
				Uint8Array.from([8, 6, 0, 0, 0]) // 8-bit, RGBA, deflate, filter 0, non-interlaced
			])
		)
	);

	// num_plays 0 = loop forever.
	parts.push(chunk('acTL', concat([u32(frames.length), u32(0)])));

	let sequence = 0;
	frames.forEach((frame, index) => {
		if (frame.rgba.length !== width * height * 4) {
			throw new Error(
				`encodeApng: frame ${index} is ${frame.rgba.length} bytes, expected ${width * height * 4}.`
			);
		}

		// Delays are a rational number of seconds; a 1000 denominator lets us
		// write milliseconds straight through without rounding.
		parts.push(
			chunk(
				'fcTL',
				concat([
					u32(sequence++),
					u32(width),
					u32(height),
					u32(0),
					u32(0),
					u16(frame.delayMs),
					u16(1000),
					Uint8Array.from([0, 0]) // dispose NONE, blend SOURCE
				])
			)
		);

		const compressed = compressRgba(frame.rgba, width, height);
		if (index === 0) {
			// The first frame is the PNG's own image, so it is an ordinary IDAT
			// and carries no sequence number of its own.
			parts.push(chunk('IDAT', compressed));
		} else {
			parts.push(chunk('fdAT', concat([u32(sequence++), compressed])));
		}
	});

	parts.push(chunk('IEND', new Uint8Array(0)));
	return concat(parts);
}
