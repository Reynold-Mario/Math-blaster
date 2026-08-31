import type {
	MergeHint,
	ProgressionCodec,
	ProgressionHandle,
	ProgressionStore
} from './ProgressionStore';
import type { RemoteProgression } from './RemoteProgression';

/**
 * A `ProgressionStore` that keeps a remote copy in step, WITHOUT becoming the
 * boot path.
 *
 * It wraps another store - the localStorage one - rather than replacing it, and
 * that composition is the whole design:
 *
 * - **`current` is still synchronous**, because it is the cache's `current`.
 *   There is no loading phase, no spinner, and no `0 banked` flash while a
 *   fetch is in flight. A signed-out player, an offline player and a player on
 *   a dead network all get exactly today's game.
 * - **The network is an UPDATE, never the source.** The remote read happens in
 *   the background and arrives through `onRemote`, which `Game.svelte` only
 *   acts on at a safe phase. Nothing here can land mid-`tick()` and race
 *   `awardCurrency()`.
 * - **Every failure is silent to the player.** Offline, signed out, a 5xx, a
 *   conflict: all of them degrade to "the local game keeps working and we try
 *   again". A sync problem must never cost a wave.
 *
 * With `remote: null` this is a transparent pass-through, which is what makes
 * it safe to wire in before any credentials exist.
 */

/**
 * Trailing debounce on the PUSH, deliberately slower than the cache's 2s.
 *
 * The cache absorbs the per-kill write rate; this only has to keep the server
 * roughly current. Every extra second here is a request not made.
 */
const PUSH_DEBOUNCE_MS = 5000;
/** ...and the same hard deadline reasoning as the cache: a busy run must not
 * be able to postpone the write forever. */
const PUSH_MAX_WAIT_MS = 30000;
/** First retry delay after an `unavailable` write. Doubles, capped. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;

export interface SupabaseProgressionStoreOptions {
	/** The synchronous cache, and the boot path. In the game this is
	 * `createLocalStorageStore`. */
	cache: ProgressionStore;
	/**
	 * `null` means "no remote configured" and makes this a pass-through.
	 *
	 * That is the state the game ships in until credentials exist, so it is the
	 * path that must be boringly safe rather than an afterthought.
	 */
	remote: RemoteProgression | null;
	pushDebounceMs?: number;
	pushMaxWaitMs?: number;
	retryBaseMs?: number;
	retryMaxMs?: number;
	now?(): number;
	/**
	 * Subscribe to "the signed-in identity may have changed". Returns an
	 * unsubscribe, which `dispose()` calls.
	 *
	 * Without it the remote read happens exactly once, at `open()`, so a sign-in
	 * landing afterwards is invisible until the next boot - which is why the dev
	 * console used to tell you to reload the page.
	 *
	 * **Fire it for every auth event; do not try to filter here.** This store
	 * decides what an event MEANS by comparing the profile id it actually
	 * observes, so a caller that filtered would need its own idea of the current
	 * identity kept in step with this one's. Over-notifying costs one read.
	 */
	onIdentityChange?(listener: () => void): () => void;
	/**
	 * Where sync failures go. Reported, never thrown: `put()` is called from the
	 * game loop and an exception escaping it would take the run down over a
	 * failed HTTP request.
	 */
	onError?(where: string, error: unknown): void;
}

/**
 * Deep equality by value, INDEPENDENT OF KEY ORDER.
 *
 * `JSON.stringify` was the obvious thing here and it was wrong. The codec's
 * `parse` and `merge` build their objects with different literal key orders -
 * Math Blaster's `parse` opens with `currency`, its `merge` opens with
 * `earnedTotal` - so two semantically identical profiles stringified to
 * different text, the "nothing to say" check never fired, and every signed-in
 * player pushed a redundant write on EVERY BOOT. Harmless to the data because
 * the triggers are monotone, but it burned a revision each time, which makes
 * real conflict detection noisier, and it defeated the one property this guard
 * exists to provide.
 *
 * Caught by watching a real boot bump `revision` 5 -> 6 with byte-identical
 * state; the unit tests missed it because the test codec happened to emit its
 * keys in the same order from both methods.
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function createSupabaseProgressionStore(
	options: SupabaseProgressionStoreOptions
): ProgressionStore {
	const {
		cache,
		remote,
		pushDebounceMs = PUSH_DEBOUNCE_MS,
		pushMaxWaitMs = PUSH_MAX_WAIT_MS,
		retryBaseMs = RETRY_BASE_MS,
		retryMaxMs = RETRY_MAX_MS,
		now = () => Date.now(),
		onIdentityChange,
		onError = () => {}
	} = options;

	return {
		open<S>(codec: ProgressionCodec<S>): ProgressionHandle<S> {
			const inner = cache.open(codec);
			if (remote === null) return inner;

			const listeners = new Set<(merged: S) => void>();

			/**
			 * What we intend to send next, which is NOT the same as the cache's
			 * state.
			 *
			 * The cache only learns about a merge when the game calls `put()` after
			 * applying it, so pushing straight from `inner.current` would send a copy
			 * that predates the merge. Holding the outgoing value here keeps the two
			 * independent and means nothing has to write the cache from a background
			 * task - which is the exact race the seam exists to prevent.
			 */
			let outgoing: S | null = null;
			/** The revision we last READ. `null` = no row seen yet, so a write
			 * inserts rather than updating. */
			let lastRevision: number | null = null;
			let rowKnown = false;

			let timer: ReturnType<typeof setTimeout> | null = null;
			let pendingSince: number | null = null;
			let retryDelay = retryBaseMs;
			let inFlight = false;
			let disposed = false;

			/**
			 * The last merge we produced, replayed to any listener that subscribes
			 * afterwards.
			 *
			 * `Game.svelte` constructs the store during component init and subscribes
			 * in `onMount`, so a fast boot fetch can resolve before anyone is
			 * listening. Without this the very first sync - the one that restores a
			 * returning player on a new device - is the one that gets dropped.
			 */
			let lastEmitted: S | null = null;

			/**
			 * The profile the state in hand belongs to, once anything has been read.
			 *
			 * **THIS, AND NOT THE EVENT THAT WOKE US, DECIDES WHETHER A SYNC MERGES
			 * OR ADOPTS.** Supabase's auth listener fires for token refreshes and for
			 * `INITIAL_SESSION` as well as for a real sign-in, so a store that
			 * adopted whenever it was notified would wipe a playing child's profile
			 * to empty on a routine refresh. Comparing the id cannot be fooled in
			 * either direction and costs one read.
			 *
			 * Deliberately NOT cleared on sign-out. Signing out must leave the local
			 * game exactly as it is, and remembering who we were is what makes
			 * signing back in as the same person a merge and as somebody else an
			 * adopt.
			 */
			let syncedProfileId: string | null = null;
			/**
			 * Which identity the in-flight sync belongs to. An identity change bumps
			 * it and every `await` re-checks it, so a read already in flight for the
			 * previous identity abandons itself rather than emitting one child's
			 * profile into another's session. `disposed` cannot express this: the
			 * handle is alive, it is the ANSWER that went stale.
			 */
			let epoch = 0;
			/** One sync at a time - enforced in `syncFromRemote` and nowhere else. */
			let syncing = false;
			/** Set only by that guard, so today it is never true. See the comment
			 * there for the caller it is waiting for. */
			let resyncQueued = false;

			function emit(merged: S): void {
				lastEmitted = merged;
				for (const fn of listeners) {
					try {
						fn(merged);
					} catch (error) {
						// A listener throwing is the listener's problem. Swallowing it
						// here keeps one bad subscriber from stopping the others.
						onError('onRemote listener', error);
					}
				}
			}

			function clearTimer(): void {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
			}

			function schedulePush(): void {
				if (disposed || outgoing === null) return;
				const at = now();
				if (pendingSince === null) pendingSince = at;
				const dueAt = Math.min(at + pushDebounceMs, pendingSince + pushMaxWaitMs);
				clearTimer();
				timer = setTimeout(() => void push(), Math.max(0, dueAt - at));
			}

			function scheduleRetry(): void {
				if (disposed || outgoing === null) return;
				clearTimer();
				const delay = retryDelay;
				retryDelay = Math.min(retryDelay * 2, retryMaxMs);
				timer = setTimeout(() => void push(), delay);
			}

			/**
			 * Which side of a merge holds the newer PREFERENCE.
			 *
			 * Monotone fields do not care - `max` is the same answer either way. This
			 * is only about `selectedGrade`, and the schema already answers it:
			 * `grade_source = 'platform'` means something upstream knows the child's
			 * grade and outranks the local picker; `'self'` means the local pick IS
			 * the record, so the local copy wins.
			 *
			 * If a SECOND preference field ever appears, this stops being adequate -
			 * one hint cannot speak for two preferences with different authorities,
			 * and that is the point at which the merge needs per-field rules rather
			 * than a hint.
			 */
			function hintFor(gradeSource: 'self' | 'platform' | null): MergeHint {
				return gradeSource === 'platform' ? 'b-is-newer' : 'a-is-newer';
			}

			async function syncFromRemote(): Promise<void> {
				if (remote === null || disposed) return;
				if (syncing) {
					// Asked again while one is running: it gets its own pass afterwards
					// rather than racing this one, because two concurrent reads can
					// resolve out of order and the loser lands a stale merge over the
					// winner.
					//
					// NO CURRENT CALLER REACHES THIS, and that is worth stating rather
					// than leaving for someone to discover. Every path in bumps `epoch`
					// first, so a superseded sync abandons itself at its first check -
					// before it reads - and the newest request is always the one that
					// runs. This exists for the caller that does NOT bump: "we are back
					// online, re-read" is the obvious one to add to the `online`
					// handler below, and without this guard it would read concurrently
					// with a sync already in flight at the same epoch.
					resyncQueued = true;
					return;
				}
				syncing = true;
				const mine = epoch;
				// Not simply `disposed`: an identity change mid-read invalidates the
				// answer without ending the handle.
				const stale = () => disposed || epoch !== mine;
				try {
					const profileId = await remote.currentProfileId();
					// Signed out is the default state, not a failure. Note what is NOT
					// done here: `syncedProfileId` is left alone.
					if (profileId === null || stale()) return;

					// ADOPT, NEVER MERGE, ACROSS AN IDENTITY BOUNDARY. `inner.current`
					// still holds the previous identity's state - the cache is keyed by
					// learner, not by session - so offering it to the merge is exactly
					// how one child's currency lands on another's account.
					const adopting = syncedProfileId !== null && syncedProfileId !== profileId;
					if (adopting) {
						// Everything below belonged to the previous identity's row.
						outgoing = null;
						lastEmitted = null;
						lastRevision = null;
						rowKnown = false;
						pendingSince = null;
						retryDelay = retryBaseMs;
						clearTimer();
					}
					syncedProfileId = profileId;

					const snapshot = await remote.read(codec.gameSlug);
					if (stale()) return;

					if (snapshot === null) {
						rowKnown = true;
						lastRevision = null;
						if (adopting) {
							// Never played on this account, and the state in hand is not
							// theirs to seed it with. Tell the game to start clean and let
							// the first `put()` insert - pushing `empty()` here would spend
							// a write to say nothing.
							emit(codec.empty());
							return;
						}
						// Never played on this account. Our local copy is the only copy,
						// so seed the row from it.
						outgoing = inner.current;
						schedulePush();
						return;
					}

					rowKnown = true;
					lastRevision = snapshot.revision;

					const local = adopting ? codec.empty() : inner.current;
					const incoming = codec.parse(snapshot.state);
					// Adopting means we hold nothing of our own, so every PREFERENCE has
					// to come from the row. Left on `hintFor`, a `'self'` row would lose
					// its own grade to `empty()`'s default - the merge would be reading a
					// local pick that is not a pick at all.
					let merged = codec.merge(
						local,
						incoming,
						adopting ? 'b-is-newer' : hintFor(snapshot.gradeSource)
					);

					// A grade the platform asserts outranks the local picker, and the
					// codec decides where it lands - this store does not know what field
					// a game keeps a grade in. Validation stays downstream, in the game's
					// own `resolveGrade()`.
					if (
						snapshot.gradeSource === 'platform' &&
						snapshot.gradeLevel !== null &&
						codec.applyPlatformGrade !== undefined
					) {
						merged = codec.applyPlatformGrade(merged, snapshot.gradeLevel);
					}

					emit(merged);

					// Push only if we actually know something the server does not.
					// Re-sending an identical payload would burn a request and a
					// revision bump for nothing. Compared by VALUE - see stableStringify:
					// a string compare here silently pushed on every boot.
					if (stableStringify(merged) !== stableStringify(incoming)) {
						outgoing = merged;
						schedulePush();
					}
				} catch (error) {
					onError('syncFromRemote', error);
				} finally {
					syncing = false;
					if (!disposed && resyncQueued) {
						resyncQueued = false;
						void syncFromRemote();
					}
				}
			}

			async function push(): Promise<void> {
				if (remote === null || disposed || inFlight) return;
				const payload = outgoing;
				if (payload === null) return;

				inFlight = true;
				clearTimer();
				pendingSince = null;
				try {
					const profileId = await remote.currentProfileId();
					if (profileId === null || disposed) {
						// Signed out. Keep the payload: if a session appears later, the
						// next `put()` sends it. Do not retry on a timer - there is
						// nothing to wait for.
						return;
					}
					// NEVER WRITE ACROSS AN IDENTITY BOUNDARY. An identity can change
					// between the `put()` that queued this payload and the debounced push
					// that sends it, and the payload belongs to whoever was signed in at
					// the time. Dropping it loses nothing - the cache already has it, and
					// the sync that follows the change decides what the new identity's
					// row should say. This is the guard that makes the window between the
					// auth event and that sync safe.
					if (syncedProfileId !== null && profileId !== syncedProfileId) {
						outgoing = null;
						return;
					}

					const result = await remote.write({
						gameSlug: codec.gameSlug,
						state: payload,
						stateVersion: codec.stateVersion,
						furthest: codec.furthest(payload),
						expectedRevision: rowKnown ? lastRevision : null
					});
					if (disposed) return;

					if (result.outcome === 'written') {
						lastRevision = result.revision;
						rowKnown = true;
						retryDelay = retryBaseMs;
						// Only clear the payload if nothing newer arrived while the
						// request was in flight.
						if (outgoing === payload) outgoing = null;
						return;
					}

					if (result.outcome === 'conflict') {
						// Somebody else wrote. Re-read and re-merge through the GAME's
						// merge - never clobber, and never retry the same payload, which
						// would just conflict again.
						const snapshot = await remote.read(codec.gameSlug);
						if (disposed) return;
						if (snapshot === null) {
							// The row went away underneath us. Treat it as an insert.
							lastRevision = null;
							rowKnown = false;
							scheduleRetry();
							return;
						}
						lastRevision = snapshot.revision;
						rowKnown = true;
						const incoming = codec.parse(snapshot.state);
						// `payload` holds work the server has not seen, so the local side
						// is the newer writer for preference purposes.
						const merged = codec.merge(payload, incoming, 'a-is-newer');
						outgoing = merged;
						emit(merged);
						retryDelay = retryBaseMs;
						scheduleRetry();
						return;
					}

					// unavailable: same payload, later.
					scheduleRetry();
				} catch (error) {
					onError('push', error);
					scheduleRetry();
				} finally {
					inFlight = false;
				}
			}

			// Coming back online is a much better retry trigger than a timer that
			// happened to be counting down, so take both.
			const onOnline = () => {
				retryDelay = retryBaseMs;
				if (outgoing !== null) void push();
			};
			if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

			// A sign-in after boot is otherwise invisible until the next one. The
			// listener only says "look again" - `syncFromRemote` works out whether
			// anything actually changed.
			const unbindIdentity =
				onIdentityChange?.(() => {
					// Bump first: this invalidates any read already in flight for the
					// identity we are leaving, whether or not a fresh sync starts now.
					epoch += 1;
					void syncFromRemote();
				}) ?? null;

			// Kick the boot read off without awaiting it. Nothing below this line
			// depends on it having finished, which is the property that keeps boot
			// synchronous.
			void syncFromRemote();

			return {
				get current(): S {
					return inner.current;
				},
				put(next: S): void {
					inner.put(next);
					outgoing = next;
					schedulePush();
				},
				flush(): void {
					inner.flush();
					// Fire and forget. `flush()` is synchronous by contract - the
					// moments that call it (a purchase, game over, `pagehide`) cannot
					// wait on a round trip, and the cache has already taken the write.
					void push();
				},
				onRemote(fn: (merged: S) => void): () => void {
					listeners.add(fn);
					// Replay, so a subscriber that arrived after the boot fetch still
					// hears about it.
					if (lastEmitted !== null) {
						try {
							fn(lastEmitted);
						} catch (error) {
							onError('onRemote replay', error);
						}
					}
					return () => void listeners.delete(fn);
				},
				dispose(): void {
					disposed = true;
					clearTimer();
					listeners.clear();
					if (unbindIdentity !== null) unbindIdentity();
					if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
					inner.dispose();
				}
			};
		}
	};
}
