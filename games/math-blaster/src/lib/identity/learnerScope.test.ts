import { CLAIM_MARKER_KEY, claimAnonymousSave, learnerScopedKey } from './learnerScope';
import type { StorageLike } from '../progression/localStorageStore';

function fakeStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	const storage: StorageLike = {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v)
	};
	return { storage, marker: () => map.get(CLAIM_MARKER_KEY) ?? null };
}

describe('learnerScopedKey', () => {
	it('suffixes rather than replaces', () => {
		// The anonymous key holds every current player's currency and skills, so
		// it has to stay a literal prefix - moving it strands them.
		const key = learnerScopedKey('pixelMathBlaster.profile.v1', 'abc');
		expect(key.startsWith('pixelMathBlaster.profile.v1')).toBe(true);
		expect(key).not.toBe('pixelMathBlaster.profile.v1');
	});
});

describe('claimAnonymousSave', () => {
	it('gives the anonymous save to the first learner, and to nobody else', () => {
		const { storage, marker } = fakeStorage();

		expect(claimAnonymousSave(storage, 'ada')).toBe('claimed');
		expect(marker()).toBe('ada');

		// The bug this exists to prevent: a child plays signed out, a sibling
		// signs in, and the sibling inherits everything.
		expect(claimAnonymousSave(storage, 'bo')).toBe('already-claimed-by-other');
		expect(marker()).toBe('ada');
	});

	it('tells the same learner there is nothing left to carry', () => {
		// Not 'claimed' a second time: the carry-over is a one-time event, and
		// repeating it would overwrite this learner's own later progress with the
		// anonymous save every boot.
		const { storage } = fakeStorage();
		expect(claimAnonymousSave(storage, 'ada')).toBe('claimed');
		expect(claimAnonymousSave(storage, 'ada')).toBe('already-mine');
	});

	it('refuses to claim when storage is missing or throwing', () => {
		// The safe direction: the cost of not claiming is a fresh profile, where
		// the cost of claiming wrongly is somebody else's.
		expect(claimAnonymousSave(null, 'ada')).toBe('already-claimed-by-other');

		const throwing: StorageLike = {
			getItem: () => {
				throw new Error('private mode');
			},
			setItem: () => {
				throw new Error('private mode');
			}
		};
		expect(claimAnonymousSave(throwing, 'ada')).toBe('already-claimed-by-other');
	});

	it('treats an empty marker as unclaimed', () => {
		const { storage } = fakeStorage({ [CLAIM_MARKER_KEY]: '' });
		expect(claimAnonymousSave(storage, 'ada')).toBe('claimed');
	});
});
