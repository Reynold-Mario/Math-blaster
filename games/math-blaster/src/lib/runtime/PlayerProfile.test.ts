import { createEmptyProfile, normalizeProfile, DEFAULT_GRADE } from './PlayerProfile';

/**
 * `normalizeProfile` is the one place untrusted data enters the game: it is
 * handed whatever happened to be in storage, which a player can edit and a
 * previous version of the game may have written in a different shape.
 *
 * Two fields gate real things - `highestWaveReached` decides what a player
 * may skip to, and `selectedGrade` decides which maths they are asked - so
 * both need to degrade to something sane rather than being trusted.
 *
 * It is PURE. There is no localStorage here any more: the store owns the
 * key, the `window` guard, JSON and the try/catches, and is tested
 * separately in `progression/localStorageStore.test.ts`.
 */

describe('a fresh profile', () => {
	it('starts with nothing banked and nothing unlocked', () => {
		const profile = createEmptyProfile();
		expect(profile.currency).toBe(0);
		expect(profile.earnedTotal).toBe(0);
		expect(profile.spentTotal).toBe(0);
		expect(profile.skillProgress).toEqual({});
		expect(profile.skillSubProgress).toEqual({});
		expect(profile.selectedGrade).toBe(DEFAULT_GRADE);
		expect(profile.highestWaveReached).toBe(1);
	});

	it('is what nothing at all normalizes to', () => {
		for (const nothing of [null, undefined, 'a string', 42, []]) {
			expect(normalizeProfile(nothing)).toEqual(createEmptyProfile());
		}
	});
});

describe('round-tripping', () => {
	it('preserves everything that persists', () => {
		const profile = createEmptyProfile();
		profile.currency = 420;
		profile.earnedTotal = 900;
		profile.spentTotal = 480;
		profile.skillProgress = { checkpoint: 2 };
		profile.skillSubProgress = { checkpoint: 1 };
		profile.selectedGrade = '2';
		profile.highestWaveReached = 17;

		expect(normalizeProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
	});
});

describe('surviving a bad payload', () => {
	it('fills in fields an older save never had', () => {
		// A profile written before grades or the wave record existed.
		const loaded = normalizeProfile({
			currency: 50,
			skillProgress: { dodge: 1 },
			skillSubProgress: {}
		});
		expect(loaded.currency).toBe(50);
		expect(loaded.skillProgress).toEqual({ dodge: 1 });
		expect(loaded.selectedGrade).toBe(DEFAULT_GRADE);
		expect(loaded.highestWaveReached).toBe(1);
	});

	it('rejects a grade that is not a real grade', () => {
		// Otherwise an unknown grade reaches the curriculum ladder and the run
		// has no problems in it.
		for (const selectedGrade of ['13', 'kindergarten', '', 7, null, {}]) {
			expect(normalizeProfile({ selectedGrade }).selectedGrade).toBe(DEFAULT_GRADE);
		}
	});

	it('accepts every real grade', () => {
		for (const grade of ['K', '1', '2', '3', '9']) {
			expect(normalizeProfile({ selectedGrade: grade }).selectedGrade).toBe(grade);
		}
	});

	it('refuses a wave record that would unlock arbitrary waves', () => {
		// This value is the ceiling on what a player may skip to, so a
		// hand-edited or corrupted profile must not be able to raise it to
		// something nonsensical and stay there.
		for (const highestWaveReached of ['999', null, NaN, Infinity, -Infinity, {}, undefined]) {
			expect(normalizeProfile({ highestWaveReached }).highestWaveReached).toBe(1);
		}
	});

	it('floors a fractional or sub-1 wave record', () => {
		expect(normalizeProfile({ highestWaveReached: 12.9 }).highestWaveReached).toBe(12);
		expect(normalizeProfile({ highestWaveReached: 0 }).highestWaveReached).toBe(1);
		expect(normalizeProfile({ highestWaveReached: -40 }).highestWaveReached).toBe(1);
	});

	it('ignores a non-object skill map rather than trusting it', () => {
		const loaded = normalizeProfile({ skillProgress: 'all of them', skillSubProgress: 5 });
		expect(loaded.skillProgress).toEqual({});
		expect(loaded.skillSubProgress).toEqual({});
	});
});

describe('the lifetime totals', () => {
	/**
	 * These arrived after v1 shipped, and the storage key deliberately did
	 * NOT move - so every assertion here is about a profile that predates
	 * them loading as *incomplete* rather than as wrong.
	 */
	it('seeds a pre-totals profile from what it is holding', () => {
		// The player really did earn what is in their pocket, and had spent
		// nothing this code knows about.
		const loaded = normalizeProfile({ currency: 320, skillProgress: { dodge: 3 } });
		expect(loaded.currency).toBe(320);
		expect(loaded.earnedTotal).toBe(320);
		expect(loaded.spentTotal).toBe(0);
		// ...and the invariant the merge depends on holds from the first load.
		expect(loaded.earnedTotal - loaded.spentTotal).toBe(loaded.currency);
	});

	it('never seeds a negative total from a negative balance', () => {
		expect(normalizeProfile({ currency: -50 }).earnedTotal).toBe(0);
	});

	it('keeps spent within earned, mirroring the database CHECK', () => {
		const loaded = normalizeProfile({ currency: 0, earnedTotal: 100, spentTotal: 400 });
		expect(loaded.earnedTotal).toBe(100);
		expect(loaded.spentTotal).toBe(100);
	});

	it('coerces junk totals rather than rejecting the profile', () => {
		for (const junk of ['200', NaN, Infinity, null, {}, -7]) {
			const loaded = normalizeProfile({ currency: 10, earnedTotal: junk, spentTotal: junk });
			expect(Number.isFinite(loaded.earnedTotal)).toBe(true);
			expect(loaded.earnedTotal).toBeGreaterThanOrEqual(0);
			expect(loaded.spentTotal).toBeGreaterThanOrEqual(0);
			expect(loaded.spentTotal).toBeLessThanOrEqual(loaded.earnedTotal);
		}
	});
});
