/**
 * APNG chunk parsing: bytes in, one standalone PNG per animation frame out.
 *
 * Deliberately pure and DOM-free. The browser half (apng.ts) needs
 * `createImageBitmap`, which cannot run under the node test environment -
 * keeping the byte work in here is what makes the format handling testable
 * at all.
 *
 * The trick this module rests on: an APNG frame is a PNG image whose pixel
 * data lives in `fdAT` chunks instead of `IDAT` ones. So rather than
 * inflating anything ourselves, we re-wrap each frame's data as an ordinary
 * single-frame PNG and let the browser's own decoder do the work.
 *
 * APNG is the only animated format this game uses; there is no GIF path
 * here and none should be added.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Ancillary chunks that change how IDAT is interpreted, so each rebuilt
 * frame has to carry them. Anything else before the first IDAT is metadata
 * we can safely drop. */
const CARRIED_CHUNKS = new Set(['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT']);

export interface ApngFrame {
	/**
	 * A complete, standalone PNG containing only this frame's sub-image.
	 * Backed by its own ArrayBuffer (it is assembled here, never a view into
	 * the input), which is what lets it go straight into a Blob.
	 */
	bytes: Uint8Array<ArrayBuffer>;
	/** Where the sub-image sits within the full canvas. */
	x: number;
	y: number;
	w: number;
	h: number;
	delayMs: number;
	/** 0 NONE, 1 BACKGROUND, 2 PREVIOUS - what to do with this frame's
	 * region before the next frame is drawn. */
	disposeOp: number;
	/** 0 SOURCE (replace), 1 OVER (alpha-composite). */
	blendOp: number;
}

export interface ParsedApng {
	width: number;
	height: number;
	frames: ApngFrame[];
	/** 0 means loop forever. */
	playCount: number;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function u32(value: number): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff
	]);
}

function buildChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
	const body = concat([Uint8Array.from([...type].map((ch) => ch.charCodeAt(0))), data]);
	return concat([u32(data.length), body, u32(crc32(body))]);
}

interface RawChunk {
	type: string;
	data: Uint8Array;
}

function readChunks(bytes: Uint8Array): RawChunk[] {
	for (let i = 0; i < SIGNATURE.length; i++) {
		if (bytes[i] !== SIGNATURE[i]) throw new Error('Not a PNG: bad signature.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks: RawChunk[] = [];
	let offset = SIGNATURE.length;

	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7]
		);
		const dataStart = offset + 8;
		if (dataStart + length > bytes.length) throw new Error(`Truncated ${type} chunk.`);
		chunks.push({ type, data: bytes.subarray(dataStart, dataStart + length) });
		offset = dataStart + length + 4; // + CRC
		if (type === 'IEND') break;
	}
	return chunks;
}

/** Per spec a delay_den of 0 means hundredths of a second. */
function delayToMs(num: number, den: number): number {
	return (num / (den === 0 ? 100 : den)) * 1000;
}

export function parseApng(bytes: Uint8Array): ParsedApng {
	const chunks = readChunks(bytes);

	const ihdr = chunks.find((c) => c.type === 'IHDR');
	if (!ihdr) throw new Error('PNG has no IHDR.');
	const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
	const width = ihdrView.getUint32(0);
	const height = ihdrView.getUint32(4);
	/** bit depth, colour type, compression, filter, interlace - copied
	 * verbatim into every rebuilt frame. */
	const format = ihdr.data.subarray(8, 13);

	const actl = chunks.find((c) => c.type === 'acTL');
	const playCount = actl
		? new DataView(actl.data.buffer, actl.data.byteOffset, actl.data.byteLength).getUint32(4)
		: 1;

	const carried: Uint8Array[] = [];
	for (const chunk of chunks) {
		if (chunk.type === 'IDAT' || chunk.type === 'fcTL') break;
		if (CARRIED_CHUNKS.has(chunk.type)) carried.push(buildChunk(chunk.type, chunk.data));
	}

	interface Pending {
		x: number;
		y: number;
		w: number;
		h: number;
		delayMs: number;
		disposeOp: number;
		blendOp: number;
		parts: Uint8Array[];
	}
	const pendings: Pending[] = [];
	let current: Pending | null = null;
	/** IDAT belongs to the animation only if an fcTL was seen first; if the
	 * first fcTL comes after IDAT, the default image is not a frame. */
	let sawFcTlBeforeIdat = false;
	let sawIdat = false;
	const strayIdat: Uint8Array[] = [];

	for (const chunk of chunks) {
		if (chunk.type === 'fcTL') {
			const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
			if (!sawIdat) sawFcTlBeforeIdat = true;
			current = {
				w: view.getUint32(4),
				h: view.getUint32(8),
				x: view.getUint32(12),
				y: view.getUint32(16),
				delayMs: delayToMs(view.getUint16(20), view.getUint16(22)),
				disposeOp: chunk.data[24],
				blendOp: chunk.data[25],
				parts: []
			};
			pendings.push(current);
		} else if (chunk.type === 'IDAT') {
			sawIdat = true;
			if (current && sawFcTlBeforeIdat) current.parts.push(chunk.data);
			else strayIdat.push(chunk.data);
		} else if (chunk.type === 'fdAT') {
			// The first 4 bytes are the sequence number, not image data.
			if (current) current.parts.push(chunk.data.subarray(4));
		}
	}

	// A plain PNG (or an APNG whose default image is not part of the
	// animation) still yields one drawable frame, so callers never need a
	// separate static-image path.
	if (pendings.length === 0 || pendings.every((p) => p.parts.length === 0)) {
		if (strayIdat.length === 0) throw new Error('PNG has no image data.');
		return {
			width,
			height,
			playCount,
			frames: [
				{
					bytes: rebuild(format, width, height, carried, strayIdat),
					x: 0,
					y: 0,
					w: width,
					h: height,
					delayMs: 0,
					disposeOp: 0,
					blendOp: 0
				}
			]
		};
	}

	const frames = pendings
		.filter((p) => p.parts.length > 0)
		.map((p) => ({
			bytes: rebuild(format, p.w, p.h, carried, p.parts),
			x: p.x,
			y: p.y,
			w: p.w,
			h: p.h,
			delayMs: p.delayMs,
			disposeOp: p.disposeOp,
			blendOp: p.blendOp
		}));

	return { width, height, playCount, frames };
}

/** Wraps one frame's compressed data back up as an ordinary PNG. */
function rebuild(
	format: Uint8Array,
	w: number,
	h: number,
	carried: Uint8Array[],
	parts: Uint8Array[]
): Uint8Array<ArrayBuffer> {
	return concat([
		Uint8Array.from(SIGNATURE),
		buildChunk('IHDR', concat([u32(w), u32(h), format])),
		...carried,
		buildChunk('IDAT', concat(parts)),
		buildChunk('IEND', new Uint8Array(0))
	]);
}
