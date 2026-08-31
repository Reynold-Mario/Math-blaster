import { mergeProfiles, profileCodec, PROFILE_STORAGE_KEY } from './profileCodec';
import { createLocalStorageStore, type StorageLike } from './localStorageStore';
import { createEmptyProfile, type PlayerProfile } from '../runtime/PlayerProfile';

/**
 * The merge is the part a generic store could not have written, and the
 * part whose bugs are silent: a wrong answer here does not crash, it just
 * quietly gives a player something they did not earn or takes away
 * something they did.
 */

function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
	return { ...createEmptyProfile(), ...overrides };
}

describe('the storage key', () => {
	it('has not moved', () => {
		// Every field added since v1 has been additive with a validated
		// fallback, so an old payload is incomplete rather than wrong. Bumping
		// this strands every current player's currency and skills.
		expect(PROFILE_STORAGE_KEY).toBe('pixelMathBlaster.profile.v1');
	});
});

describe('records take the high-water mark', () => {
	it('keeps the furthest wave either side reached', () => {
		const merged = mergeProfiles(
			profile({ highestWaveReached: 31 }),
			profile({ highestWaveReached: 12 }),
			'b-is-newer'
		);
		// Newer does NOT win here - this is a record, not a preference, and it
		// gates where a run may start.
		expect(merged.highestWaveReached).toBe(31);
	});

	it('keeps the higher level of every skill', () => {
		const merged = mergeProfiles(
			profile({ skillProgress: { dodge: 3, bounty: 1 } }),
			profile({ skillProgress: { dodge: 1, armor: 2 } }),
			'a-is-newer'
		);
		expect(merged.skillProgress).toEqual({ dodge: 3, bounty: 1, armor: 2 });
	});

	it('reports the furthest scalar the store promotes', () => {
		expect(profileCodec.furthest(profile({ highestWaveReached: 44 }))).toBe(44);
	});
});

describe('preferences take the newer write', () => {
	it('follows the hint for the selected grade', () => {
		// No grade is "greater". Picking the higher one would silently promote
		// a child who had just moved themselves down.
		expect(
			mergeProfiles(profile({ selectedGrade: '3' }), profile({ selectedGrade: 'K' }), 'b-is-newer')
				.selectedGrade
		).toBe('K');
		expect(
			mergeProfiles(profile({ selectedGrade: '3' }), profile({ selectedGrade: 'K' }), 'a-is-newer')
				.selectedGrade
		).toBe('3');
	});
});

describe('skillSubProgress across a level boundary', () => {
	/**
	 * THE TRAP. Installments reset to 0 the instant a level completes, so a
	 * naive `max` treats a paid-off installment as credit toward the NEXT
	 * level - a free part-payment every time two copies of a profile meet.
	 */
	it('does not resurrect a paid-off installment as credit toward the next level', () => {
		// A paid 2 installments toward dodge Lv.2 and then completed it, so
		// its installments are back to 0. B is still mid-purchase at Lv.1.
		const completed = profile({ skillProgress: { dodge: 2 }, skillSubProgress: {} });
		const midPurchase = profile({ skillProgress: { dodge: 1 }, skillSubProgress: { dodge: 2 } });

		const merged = mergeProfiles(completed, midPurchase, 'a-is-newer');
		expect(merged.skillProgress.dodge).toBe(2);
		// The naive answer is 2, which would hand the player two free
		// installments toward Lv.3.
		expect(merged.skillSubProgress.dodge ?? 0).toBe(0);
	});

	it('gives the same answer whichever order the two sides arrive in', () => {
		const completed = profile({ skillProgress: { dodge: 2 }, skillSubProgress: {} });
		const midPurchase = profile({ skillProgress: { dodge: 1 }, skillSubProgress: { dodge: 2 } });
		expect(mergeProfiles(midPurchase, completed, 'a-is-newer').skillSubProgress.dodge ?? 0).toBe(0);
	});

	it('compares installments only when the levels agree', () => {
		// Same level means both sides are paying toward the same purchase, so
		// the further-along one is genuinely further along.
		const merged = mergeProfiles(
			profile({ skillProgress: { bounty: 1 }, skillSubProgress: { bounty: 1 } }),
			profile({ skillProgress: { bounty: 1 }, skillSubProgress: { bounty: 3 } }),
			'a-is-newer'
		);
		expect(merged.skillSubProgress.bounty).toBe(3);
	});

	it('carries the higher level its own installments, high or low', () => {
		const ahead = profile({ skillProgress: { armor: 4 }, skillSubProgress: { armor: 1 } });
		const behind = profile({ skillProgress: { armor: 2 }, skillSubProgress: { armor: 9 } });
		const merged = mergeProfiles(ahead, behind, 'b-is-newer');
		expect(merged.skillProgress.armor).toBe(4);
		expect(merged.skillSubProgress.armor).toBe(1);
	});
});

describe('currency', () => {
	it('derives the balance from the two totals rather than merging it', () => {
		const a = profile({ currency: 40, earnedTotal: 100, spentTotal: 60 });
		const b = profile({ currency: 30, earnedTotal: 80, spentTotal: 50 });
		const merged = mergeProfiles(a, b, 'a-is-newer');
		expect(merged.earnedTotal).toBe(100);
		expect(merged.spentTotal).toBe(60);
		expect(merged.currency).toBe(40);
	});

	it('never hands back money that was already spent', () => {
		// Taking the larger of two BALANCES is the obvious wrong answer: A
		// spent everything, B has not spent yet, and max(0, 90) refunds A.
		const spender = profile({ currency: 0, earnedTotal: 90, spentTotal: 90 });
		const saver = profile({ currency: 90, earnedTotal: 90, spentTotal: 0 });
		expect(mergeProfiles(spender, saver, 'a-is-newer').currency).toBe(0);
	});

	it('under-counts concurrent earning rather than minting currency', () => {
		// The deliberate direction to be wrong in: 100 here and 50 there
		// merges to 100, not 150. Losing some currency is survivable; minting
		// it on every sync is not.
		const merged = mergeProfiles(
			profile({ currency: 100, earnedTotal: 100 }),
			profile({ currency: 50, earnedTotal: 50 }),
			'a-is-newer'
		);
		expect(merged.currency).toBe(100);
	});

	it('keeps the balance non-negative and spent within earned', () => {
		const merged = mergeProfiles(
			profile({ earnedTotal: 10, spentTotal: 10 }),
			profile({ earnedTotal: 5, spentTotal: 5 }),
			'a-is-newer'
		);
		expect(merged.spentTotal).toBeLessThanOrEqual(merged.earnedTotal);
		expect(merged.currency).toBeGreaterThanOrEqual(0);
	});
});

describe('merging with nothing', () => {
	it('leaves a real profile untouched against an empty one', () => {
		// The first sync on a new device: an empty remote must not erase a
		// local profile.
		const real = profile({
			currency: 250,
			earnedTotal: 400,
			spentTotal: 150,
			skillProgress: { dodge: 2 },
			skillSubProgress: { dodge: 1 },
			selectedGrade: '2',
			highestWaveReached: 22
		});
		expect(mergeProfiles(real, createEmptyProfile(), 'a-is-newer')).toEqual(real);
	});

	it('is idempotent against itself', () => {
		const real = profile({
			currency: 20,
			earnedTotal: 20,
			skillProgress: { bounty: 1 },
			highestWaveReached: 9
		});
		expect(mergeProfiles(real, real, 'a-is-newer')).toEqual(real);
	});
});

describe('an existing player, through the real store', () => {
	/**
	 * The migration that matters: someone who has been playing since before
	 * any of this existed opens the game and finds everything where they
	 * left it. Nothing here is a unit - it is the codec, the key and the
	 * store together, because that combination is what a returning player
	 * actually meets.
	 */
	function storeWith(raw: string) {
		const map = new Map([[PROFILE_STORAGE_KEY, raw]]);
		const storage: StorageLike = {
			getItem: (k) => map.get(k) ?? null,
			setItem: (k, v) => void map.set(k, v)
		};
		return {
			map,
			handle: createLocalStorageStore({ storage, keyFor: () => PROFILE_STORAGE_KEY }).open(
				profileCodec
			)
		};
	}

	it('loads a v1 profile with its currency and skills intact', () => {
		const { handle } = storeWith(
			JSON.stringify({
				currency: 640,
				skillProgress: { dodge: 3, 'more-time': 2 },
				skillSubProgress: { bounty: 1 },
				selectedGrade: '1',
				highestWaveReached: 26
			})
		);
		expect(handle.current.currency).toBe(640);
		expect(handle.current.skillProgress).toEqual({ dodge: 3, 'more-time': 2 });
		expect(handle.current.skillSubProgress).toEqual({ bounty: 1 });
		expect(handle.current.selectedGrade).toBe('1');
		expect(handle.current.highestWaveReached).toBe(26);
		// The fields that did not exist when this was written, seeded so the
		// balance and the totals agree from the very first load.
		expect(handle.current.earnedTotal).toBe(640);
		expect(handle.current.spentTotal).toBe(0);
	});

	it('writes back a shape it can read again', () => {
		const { map, handle } = storeWith(JSON.stringify({ currency: 100 }));
		const next = { ...handle.current, currency: 90, spentTotal: 10 };
		handle.put(next);
		handle.flush();
		expect(profileCodec.parse(JSON.parse(map.get(PROFILE_STORAGE_KEY)!))).toEqual(next);
	});
});
