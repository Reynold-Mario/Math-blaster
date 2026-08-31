import { parseApng } from './apngParse';

/**
 * The browser half of APNG loading: fetch, split into frames (apngParse),
 * hand each frame to the browser's own PNG decoder, and composite the
 * results into one ready-to-draw ImageBitmap per frame.
 *
 * Why decode at all, rather than pointing an <img> at the APNG? Because an
 * animated <img> is driven entirely by the browser - you cannot ask it for a
 * specific frame, pause it, or start two copies at different points in the
 * cycle. Doing the work up front turns an animation into an array, which is
 * what lets a formation of identical enemies avoid animating in lockstep.
 *
 * Everything here runs once, during boot. Nothing in this module is touched
 * per frame.
 */

export interface DecodedAnimation {
	/** One full-canvas bitmap per frame, already composited. */
	frames: ImageBitmap[];
	/** Cumulative end time of each frame, so frame lookup is a scan of a
	 * pre-computed array rather than a running sum every draw. */
	frameEndsMs: number[];
	totalMs: number;
	width: number;
	height: number;
}

const DISPOSE_BACKGROUND = 1;
const DISPOSE_PREVIOUS = 2;
const BLEND_OVER = 1;

/** A frame with no authored delay (a plain PNG, or a 0 written by an
 * encoder that didn't care) would make totalMs 0 and the frame lookup
 * divide by nothing. */
const MIN_FRAME_MS = 10;

export async function decodeApng(url: string): Promise<DecodedAnimation> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const parsed = parseApng(new Uint8Array(await response.arrayBuffer()));

	const canvas = document.createElement('canvas');
	canvas.width = parsed.width;
	canvas.height = parsed.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error(`${url}: no 2D context to composite frames on.`);
	ctx.imageSmoothingEnabled = false;

	const frames: ImageBitmap[] = [];
	const frameEndsMs: number[] = [];
	let elapsed = 0;

	for (const frame of parsed.frames) {
		const subImage = await createImageBitmap(new Blob([frame.bytes], { type: 'image/png' }));

		// dispose_op PREVIOUS means "put back what was here before this frame",
		// so the state has to be captured before drawing over it.
		const snapshot =
			frame.disposeOp === DISPOSE_PREVIOUS
				? ctx.getImageData(0, 0, parsed.width, parsed.height)
				: null;

		// SOURCE replaces the region outright; OVER composites onto it. Only
		// SOURCE needs the region cleared first.
		if (frame.blendOp !== BLEND_OVER) ctx.clearRect(frame.x, frame.y, frame.w, frame.h);
		ctx.drawImage(subImage, frame.x, frame.y);
		subImage.close();

		frames.push(await createImageBitmap(canvas));

		elapsed += Math.max(MIN_FRAME_MS, frame.delayMs);
		frameEndsMs.push(elapsed);

		if (frame.disposeOp === DISPOSE_BACKGROUND) ctx.clearRect(frame.x, frame.y, frame.w, frame.h);
		else if (snapshot) ctx.putImageData(snapshot, 0, 0);
	}

	if (frames.length === 0) throw new Error(`${url}: decoded to no frames.`);

	return { frames, frameEndsMs, totalMs: elapsed, width: parsed.width, height: parsed.height };
}
