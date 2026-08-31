import { createRunQueue, PENDING_RUNS_KEY } from './runQueue';
import type { StorageLike } from './localStorageStore';
import type { RemoteProgression, RunSubmission, RunSubmitResult } from './RemoteProgression';

/**
 * The queue that stands between a finished run and the server.
 *
 * Two of these properties are the reason it exists rather than the game calling
 * `submitRun` directly: the run is persisted BEFORE the network is touched, and
 * the idempotency key is stable across retries. Both fail silently - the first
 * as practice that quietly vanishes when a tab closes, the second as a doubled
 * mastery record - so both are pinned.
 */

function fakeStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	const storage: StorageLike = {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v)
	};
	return {
		storage,
		stored: (): RunSubmission[] => {
			const raw = map.get(PENDING_RUNS_KEY);
			return raw === undefined ? [] : (JSON.parse(raw) as RunSubmission[]);
		}
	};
}

function fakeRemote(results: RunSubmitResult[] = []) {
	const seen: RunSubmission[] = [];
	let pendingForever = false;
	const remote: RemoteProgression = {
		currentProfileId: async () => 'p1',
		read: async () => null,
		write: async () => ({ outcome: 'written', revision: 1 }),
		submitRun: async (run) => {
			seen.push(run);
			if (pendingForever) return new Promise<RunSubmitResult>(() => {});
			return results.shift() ?? { outcome: 'submitted' };
		}
	};
	return {
		remote,
		seen,
		hang: () => void (pendingForever = true)
	};
}

const RUN = {
	gameSlug: 'math-blaster',
	gradeLevel: 'K',
	waveReached: 7,
	score: 100,
	bossesDefeated: 1,
	durationMs: 1000,
	mastery: [{ topicId: 't1', attempts: 3, correct: 2 }],
	achievements: [] as string[]
};

async function settle(): Promise<void> {
	for (let i = 0; i < 25; i += 1) await Promise.resolve();
}
async function advance(ms: number): Promise<void> {
	jest.advanceTimersByTime(ms);
	await settle();
}

let keyCounter = 0;
const nextKey = () => `key-${++keyCounter}`;

beforeEach(() => {
	jest.useFakeTimers();
	keyCounter = 0;
});
afterEach(() => jest.useRealTimers());

describe('createRunQueue', () => {
	it('persists the run BEFORE the network is touched', async () => {
		const fs = fakeStorage();
		const r = fakeRemote();
		r.hang(); // submitRun never resolves
		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });

		q.submit(RUN);

		// Synchronously after submit, with the request still in flight: the run is
		// already on disk. This is what makes a closed tab survivable.
		expect(fs.stored()).toHaveLength(1);
		expect(fs.stored()[0]?.idempotencyKey).toBe('key-1');
		await settle();
	});

	it('drops a run once submitted', async () => {
		const fs = fakeStorage();
		const r = fakeRemote([{ outcome: 'submitted' }]);
		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });

		q.submit(RUN);
		await settle();

		expect(q.pending()).toBe(0);
		expect(fs.stored()).toHaveLength(0);
	});

	it('KEEPS THE SAME IDEMPOTENCY KEY ACROSS RETRIES', async () => {
		const fs = fakeStorage();
		const r = fakeRemote([
			{ outcome: 'unavailable' },
			{ outcome: 'unavailable' },
			{ outcome: 'submitted' }
		]);
		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });

		q.submit(RUN);
		await settle();
		await advance(3000);
		await advance(6000);

		// Three attempts, ONE key. A fresh key per attempt would make the server's
		// uniqueness constraint useless and double the child's practice record.
		expect(r.seen).toHaveLength(3);
		expect(new Set(r.seen.map((s) => s.idempotencyKey)).size).toBe(1);
		expect(q.pending()).toBe(0);
	});

	it('backs off rather than retrying at a fixed interval', async () => {
		const fs = fakeStorage();
		const r = fakeRemote([
			{ outcome: 'unavailable' },
			{ outcome: 'unavailable' },
			{ outcome: 'unavailable' }
		]);
		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });

		q.submit(RUN);
		await settle();
		expect(r.seen).toHaveLength(1);

		await advance(3000);
		expect(r.seen).toHaveLength(2);
		await advance(3000);
		expect(r.seen).toHaveLength(2); // doubled to 6s
		await advance(3000);
		expect(r.seen).toHaveLength(3);
	});

	it('drops a rejected run and reports it rather than retrying forever', async () => {
		const fs = fakeStorage();
		const r = fakeRemote([{ outcome: 'rejected', reason: '22023: bad payload' }]);
		const errors: string[] = [];
		const q = createRunQueue({
			remote: r.remote,
			storage: fs.storage,
			newKey: nextKey,
			onError: (where) => void errors.push(where)
		});

		q.submit(RUN);
		await settle();
		await advance(60000);

		// Terminal, so it must not occupy the queue - every later run would be
		// stuck behind it. But it is reported: a silently discarded run is a
		// child's practice vanishing with no trace.
		expect(q.pending()).toBe(0);
		expect(r.seen).toHaveLength(1);
		expect(errors).toContain('runQueue rejected');
	});

	it('sends a run left over from a previous session on construction', async () => {
		const leftover: RunSubmission[] = [{ ...RUN, idempotencyKey: 'from-last-time' }];
		const fs = fakeStorage({ [PENDING_RUNS_KEY]: JSON.stringify(leftover) });
		const r = fakeRemote([{ outcome: 'submitted' }]);

		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });
		await settle();

		// The payoff for persisting first: the tab closed, the run survived.
		expect(r.seen.map((s) => s.idempotencyKey)).toEqual(['from-last-time']);
		expect(q.pending()).toBe(0);
	});

	it('drains oldest first, one at a time', async () => {
		const fs = fakeStorage();
		const r = fakeRemote();
		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });

		q.submit(RUN);
		q.submit(RUN);
		q.submit(RUN);
		await settle();

		expect(r.seen.map((s) => s.idempotencyKey)).toEqual(['key-1', 'key-2', 'key-3']);
	});

	it('discards a persisted entry with no idempotency key instead of sending it', async () => {
		const fs = fakeStorage({
			[PENDING_RUNS_KEY]: JSON.stringify([{ ...RUN }, { ...RUN, idempotencyKey: 'good' }])
		});
		const r = fakeRemote();
		createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });
		await settle();

		// A run with no key cannot be deduplicated by the server, so sending it
		// risks doubling a practice record. Dropping it is the safe direction.
		expect(r.seen.map((s) => s.idempotencyKey)).toEqual(['good']);
	});

	it('survives a corrupt stored value', async () => {
		const fs = fakeStorage({ [PENDING_RUNS_KEY]: '{not json' });
		const r = fakeRemote();
		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });
		await settle();

		expect(q.pending()).toBe(0);
		q.submit(RUN);
		await settle();
		expect(r.seen).toHaveLength(1);
	});

	it('drops the oldest at the ceiling, and says so', async () => {
		const fs = fakeStorage();
		const r = fakeRemote();
		r.hang();
		const errors: string[] = [];
		const q = createRunQueue({
			remote: r.remote,
			storage: fs.storage,
			newKey: nextKey,
			maxQueued: 3,
			onError: (where) => void errors.push(where)
		});

		for (let i = 0; i < 5; i += 1) q.submit(RUN);

		expect(q.pending()).toBe(3);
		expect(fs.stored().map((s) => s.idempotencyKey)).toEqual(['key-3', 'key-4', 'key-5']);
		expect(errors).toContain('runQueue overflow');
		await settle();
	});

	it('stores and sends nothing with no remote configured', async () => {
		const fs = fakeStorage();
		const q = createRunQueue({ remote: null, storage: fs.storage, newKey: nextKey });

		q.submit(RUN);
		await settle();

		expect(q.pending()).toBe(0);
		expect(fs.stored()).toHaveLength(0);
	});

	it('stops after dispose', async () => {
		const fs = fakeStorage();
		const r = fakeRemote([{ outcome: 'unavailable' }]);
		const q = createRunQueue({ remote: r.remote, storage: fs.storage, newKey: nextKey });

		q.submit(RUN);
		await settle();
		expect(r.seen).toHaveLength(1);

		q.dispose();
		await advance(120000);
		expect(r.seen).toHaveLength(1);
	});
});

/**
 * Moving the queue once the device learns who is playing.
 *
 * A queued run is worse to mis-attribute than a profile is: `submit_run()`
 * writes it into a child's permanent practice record, where a profile only
 * decides how much currency they have.
 */
describe('rekey', () => {
	const RUN = {
		gameSlug: 'math-blaster',
		gradeLevel: 'K',
		waveReached: 4,
		score: 10,
		bossesDefeated: 0,
		durationMs: 1000,
		mastery: [],
		achievements: []
	};
	const ADA_KEY = `${PENDING_RUNS_KEY}.ada`;

	function queueAt(map: Map<string, string>, key: string): RunSubmission[] {
		const raw = map.get(key);
		return raw === undefined ? [] : (JSON.parse(raw) as RunSubmission[]);
	}

	function storageWithMap(seed: Record<string, string> = {}) {
		const map = new Map(Object.entries(seed));
		const storage: StorageLike = {
			getItem: (k) => map.get(k) ?? null,
			setItem: (k, v) => void map.set(k, v)
		};
		return { storage, map };
	}

	it('carries banked runs to the learner that claimed the device', () => {
		const { storage, map } = storageWithMap();
		const queue = createRunQueue({
			remote: fakeRemote([{ outcome: 'unavailable' }]).remote,
			storage
		});
		queue.submit(RUN);

		queue.rekey(ADA_KEY, true);

		expect(queueAt(map, ADA_KEY)).toHaveLength(1);
		expect(queue.pending()).toBe(1);
	});

	it('leaves them behind for a learner that did not', () => {
		const { storage, map } = storageWithMap();
		const queue = createRunQueue({
			remote: fakeRemote([{ outcome: 'unavailable' }]).remote,
			storage
		});
		queue.submit(RUN);

		queue.rekey(`${PENDING_RUNS_KEY}.bo`, false);

		// Still on disk under the anonymous key rather than dropped - they are
		// somebody's practice, just not this child's.
		expect(queueAt(map, PENDING_RUNS_KEY)).toHaveLength(1);
		expect(queueAt(map, `${PENDING_RUNS_KEY}.bo`)).toHaveLength(0);
		expect(queue.pending()).toBe(0);
	});

	it('keeps the idempotency key across the move', () => {
		// A fresh key per attempt would defeat `submit_run()`'s dedupe and double
		// a child's practice record.
		const { storage, map } = storageWithMap();
		const queue = createRunQueue({
			remote: fakeRemote([{ outcome: 'unavailable' }]).remote,
			storage
		});
		queue.submit(RUN);
		const before = queueAt(map, PENDING_RUNS_KEY)[0].idempotencyKey;

		queue.rekey(ADA_KEY, true);

		expect(queueAt(map, ADA_KEY)[0].idempotencyKey).toBe(before);
	});

	it('puts runs already waiting in the learner slot first', () => {
		const existing = [{ ...RUN, idempotencyKey: 'older' }];
		const { storage, map } = storageWithMap({ [ADA_KEY]: JSON.stringify(existing) });
		const queue = createRunQueue({
			remote: fakeRemote([{ outcome: 'unavailable' }]).remote,
			storage
		});
		queue.submit(RUN);

		queue.rekey(ADA_KEY, true);

		// They have been waiting longer.
		expect(queueAt(map, ADA_KEY).map((r) => r.idempotencyKey)[0]).toBe('older');
		expect(queue.pending()).toBe(2);
	});

	it('does nothing when the key has not changed', () => {
		const { storage, map } = storageWithMap();
		const queue = createRunQueue({
			remote: fakeRemote([{ outcome: 'unavailable' }]).remote,
			storage
		});
		queue.submit(RUN);
		queue.rekey(PENDING_RUNS_KEY, true);
		expect(queueAt(map, PENDING_RUNS_KEY)).toHaveLength(1);
	});
});
