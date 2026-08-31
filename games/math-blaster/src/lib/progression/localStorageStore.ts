import type { ProgressionCodec, ProgressionHandle, ProgressionStore } from './ProgressionStore';

/**
 * A `ProgressionStore` backed by localStorage.
 *
 * It owns everything the game used to do inline: the key, the `window`
 * guard, JSON in both directions, and both try/catches. The codec owns
 * validation and knows nothing about storage.
 *
 * **Writes are debounced.** `Game.svelte` saves on every `currency-earned`
 * event - once per kill, 50-150 writes a run. That is free against
 * localStorage and catastrophic against a network, and the debounce lives
 * here rather than at the call sites so the networked store inherits it
 * instead of reinventing it.
 */

/** Trailing edge: quiet for this long and the write goes out. */
const DEBOUNCE_MS = 2000;
/** ...but never sit on a change longer than this, however busy the run is.
 * Bounds what a crash or a killed tab can cost to one wave's worth of
 * currency rather than a whole run's. */
const MAX_WAIT_MS = 15000;

/** The half of `Storage` this actually uses. Injectable so the tests need
 * neither jsdom nor a hand-stubbed global - `testEnvironment` stays node. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface LocalStorageStoreOptions {
	/**
	 * Which key a game's state lives under.
	 *
	 * Defaults to a namespaced key, because all games now share one origin
	 * and an unprefixed key is a collision waiting to happen. Math Blaster
	 * overrides it: its payload shape is unchanged, so by the game's own
	 * versioning rule the existing `pixelMathBlaster.profile.v1` must not
	 * move or every current player loses their currency and skills.
	 */
	keyFor?(gameSlug: string): string;
	storage?: StorageLike | null;
	debounceMs?: number;
	maxWaitMs?: number;
	now?(): number;
}

function defaultStorage(): StorageLike | null {
	// Not `window.localStorage` guarded by a try alone: in a non-browser
	// context (jest, SSR, a build script) `window` is not defined at all.
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage;
	} catch {
		// Storage can be present but throw on access - Safari in private mode
		// has historically done exactly this.
		return null;
	}
}

export function createLocalStorageStore(options: LocalStorageStoreOptions = {}): ProgressionStore {
	const keyFor = options.keyFor ?? ((gameSlug: string) => `${gameSlug}.progress.v1`);
	const storage = options.storage === undefined ? defaultStorage() : options.storage;
	const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
	const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
	const now = options.now ?? (() => Date.now());

	return {
		open<S>(codec: ProgressionCodec<S>): ProgressionHandle<S> {
			const key = keyFor(codec.gameSlug);

			// The boot read, and the only one. Synchronous by construction.
			let state = read();
			let timer: ReturnType<typeof setTimeout> | null = null;
			let pendingSince: number | null = null;
			const remoteListeners = new Set<(merged: S) => void>();

			function read(): S {
				if (!storage) return codec.empty();
				let raw: string | null;
				try {
					raw = storage.getItem(key);
				} catch {
					return codec.empty();
				}
				if (raw === null) return codec.empty();
				try {
					// parse() is contractually total, so the only thing that can
					// throw here is JSON.parse on a truncated or hand-edited value.
					return codec.parse(JSON.parse(raw));
				} catch {
					return codec.empty();
				}
			}

			function write(): void {
				if (!storage) return;
				try {
					storage.setItem(key, JSON.stringify(state));
				} catch {
					// Quota exceeded, or storage disabled mid-session. The run keeps
					// going on the in-memory copy; losing a save is not worth losing
					// a wave over.
				}
			}

			function flush(): void {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
				if (pendingSince === null) return;
				pendingSince = null;
				write();
			}

			function schedule(): void {
				const at = now();
				if (pendingSince === null) pendingSince = at;
				// Trailing edge, except that the oldest unwritten change sets a
				// hard deadline. Without the deadline a run that never goes quiet
				// for two seconds would never write at all.
				const dueAt = Math.min(at + debounceMs, pendingSince + maxWaitMs);
				if (timer !== null) clearTimeout(timer);
				timer = setTimeout(flush, Math.max(0, dueAt - at));
			}

			// `pagehide`, NOT `beforeunload`: the latter is unreliable on iOS
			// Safari and it opts the page out of the back/forward cache.
			const onPageHide = () => flush();
			if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

			return {
				get current(): S {
					return state;
				},
				put(next: S): void {
					state = next;
					schedule();
				},
				flush,
				onRemote(fn: (merged: S) => void): () => void {
					remoteListeners.add(fn);
					return () => void remoteListeners.delete(fn);
				},
				dispose(): void {
					flush();
					remoteListeners.clear();
					if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
				}
			};
		}
	};
}
