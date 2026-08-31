import { createPlatformGradeStore } from './platformGradeStore';
import type { ProgressionCodec, ProgressionHandle, ProgressionStore } from './ProgressionStore';
import type { IdentityResult, LearnerIdentitySource } from '../identity/LearnerIdentity';

/**
 * The layer that lets the platform's grade reach a run.
 *
 * The properties worth pinning are the ones that fail as "the grade sometimes
 * sticks": that a merge arriving afterwards does not quietly undo it, that a
 * grade the game cannot use changes nothing at all, and that none of it ever
 * writes through the cache from a background task.
 */

interface State {
	grade: string;
	coins: number;
}

const codec: ProgressionCodec<State> = {
	gameSlug: 'test',
	stateVersion: 1,
	empty: () => ({ grade: 'K', coins: 0 }),
	parse: (raw) => (raw as State) ?? { grade: 'K', coins: 0 },
	merge: (a, b) => ({ grade: b.grade, coins: Math.max(a.coins, b.coins) }),
	furthest: () => 0,
	applyPlatformGrade: (state, grade) => ({ ...state, grade })
};

/** A cache whose emits we drive by hand, so "a merge landed late" is a call. */
function fakeInner(seed: State = { grade: 'K', coins: 0 }) {
	let current = seed;
	const listeners = new Set<(s: State) => void>();
	const puts: State[] = [];
	let flushes = 0;
	let disposed = false;
	const store: ProgressionStore = {
		open: <S>(): ProgressionHandle<S> =>
			({
				get current() {
					return current;
				},
				put: (next: State) => void puts.push((current = next)),
				flush: () => void (flushes += 1),
				onRemote: (fn: (s: State) => void) => {
					listeners.add(fn);
					return () => void listeners.delete(fn);
				},
				dispose: () => void (disposed = true)
			}) as unknown as ProgressionHandle<S>
	};
	return {
		store,
		puts,
		emit: (s: State) => listeners.forEach((fn) => fn(s)),
		flushes: () => flushes,
		disposed: () => disposed,
		listenerCount: () => listeners.size
	};
}

function fixedIdentity(result: IdentityResult): LearnerIdentitySource {
	return { resolve: () => Promise.resolve(result) };
}

function identified(grade: string | null): LearnerIdentitySource {
	return fixedIdentity({
		outcome: 'identified',
		identity: { learnerId: 'l1', provider: 'vt', grade, pickedBy: 'primary' }
	});
}

/** The identity resolve is a microtask, so let it settle. */
const settled = () => Promise.resolve().then(() => undefined);

describe('createPlatformGradeStore', () => {
	it('is a transparent pass-through with no platform configured', () => {
		const inner = fakeInner();
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: null,
			mapGrade: (g) => g
		}).open(codec);
		// Not merely equivalent - the SAME handle, so a build with no platform
		// carries no extra layer at all.
		expect(handle.current).toEqual({ grade: 'K', coins: 0 });
		expect(inner.listenerCount()).toBe(0);
	});

	it('emits the platform grade once identity resolves', async () => {
		const inner = fakeInner({ grade: 'K', coins: 7 });
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: identified('2'),
			mapGrade: (g) => g
		}).open(codec);

		const seen: State[] = [];
		handle.onRemote((s) => void seen.push(s));
		await settled();

		// The grade lands; everything else on the profile is left alone.
		expect(seen).toEqual([{ grade: '2', coins: 7 }]);
	});

	it('never writes through the cache', async () => {
		const inner = fakeInner();
		createPlatformGradeStore({
			inner: inner.store,
			identity: identified('3'),
			mapGrade: (g) => g
		}).open(codec);
		await settled();

		// A background `put()` is the exact race the progression seam exists to
		// prevent. The game applies the emit and its next ordinary save persists it.
		expect(inner.puts).toEqual([]);
		expect(inner.flushes()).toBe(0);
	});

	it('re-applies the grade over a merge that arrives afterwards', async () => {
		const inner = fakeInner();
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: identified('3'),
			mapGrade: (g) => g
		}).open(codec);

		const seen: State[] = [];
		handle.onRemote((s) => void seen.push(s));
		await settled();

		// A round trip finishing after the platform answered must not undo it.
		inner.emit({ grade: '1', coins: 40 });
		expect(seen[seen.length - 1]).toEqual({ grade: '3', coins: 40 });
	});

	it('applies the grade to a merge that arrived before identity did', async () => {
		const inner = fakeInner();
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: identified('3'),
			mapGrade: (g) => g
		}).open(codec);
		const seen: State[] = [];
		handle.onRemote((s) => void seen.push(s));

		inner.emit({ grade: '1', coins: 40 });
		await settled();

		expect(seen).toEqual([
			{ grade: '1', coins: 40 },
			{ grade: '3', coins: 40 }
		]);
	});

	it('says nothing at all when the grade is absent or unusable', async () => {
		for (const [identity, mapGrade] of [
			[identified(null), (g: string) => g],
			[identified('college'), () => null]
		] as const) {
			const inner = fakeInner();
			const handle = createPlatformGradeStore({ inner: inner.store, identity, mapGrade }).open(
				codec
			);
			const seen: State[] = [];
			handle.onRemote((s) => void seen.push(s));
			await settled();

			// Silence, not a default. Overwriting a child's own pick with a value we
			// could not translate is worse than leaving it alone.
			expect(seen).toEqual([]);
		}
	});

	it('says nothing for an anonymous player', async () => {
		const inner = fakeInner();
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: fixedIdentity({ outcome: 'anonymous', reason: 'unauthenticated' }),
			mapGrade: (g) => g
		}).open(codec);
		const seen: State[] = [];
		handle.onRemote((s) => void seen.push(s));
		await settled();
		expect(seen).toEqual([]);
	});

	it('replays to a subscriber that arrived after the resolve', async () => {
		// `Game.svelte` builds the store during init and subscribes in `onMount`,
		// so a fast resolve lands before anyone is listening.
		const inner = fakeInner();
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: identified('1'),
			mapGrade: (g) => g
		}).open(codec);
		await settled();

		const seen: State[] = [];
		handle.onRemote((s) => void seen.push(s));
		expect(seen).toEqual([{ grade: '1', coins: 0 }]);
	});

	it('reports the granted grade exactly once', async () => {
		const granted: string[] = [];
		const inner = fakeInner();
		createPlatformGradeStore({
			inner: inner.store,
			identity: identified('7'),
			mapGrade: () => '3',
			onGranted: (g) => void granted.push(g)
		}).open(codec);
		await settled();

		// The mapped grade, not the raw one - the UI must show what is in force.
		expect(granted).toEqual(['3']);
	});

	it('keeps `current` synchronous and free of the platform grade at boot', () => {
		const inner = fakeInner({ grade: 'K', coins: 3 });
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: identified('3'),
			mapGrade: (g) => g
		}).open(codec);

		// Readable the instant the handle exists - there is no loading phase, and
		// at boot the platform has not spoken yet.
		expect(handle.current).toEqual({ grade: 'K', coins: 3 });
	});

	it('unsubscribes from the cache on dispose', async () => {
		const inner = fakeInner();
		const handle = createPlatformGradeStore({
			inner: inner.store,
			identity: identified('3'),
			mapGrade: (g) => g
		}).open(codec);
		await settled();

		handle.dispose();
		expect(inner.listenerCount()).toBe(0);
		expect(inner.disposed()).toBe(true);
	});
});
