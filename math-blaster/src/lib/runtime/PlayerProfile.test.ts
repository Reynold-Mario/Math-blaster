import { createEmptyProfile, loadPlayerProfile, savePlayerProfile, DEFAULT_GRADE } from './PlayerProfile';

/**
 * Loading a profile is the one place untrusted data enters the game: it is
 * whatever happens to be in localStorage, which a player can edit and a
 * previous version of the game may have written in a different shape.
 *
 * Two fields now gate real things - `highestWaveReached` decides what a
 * player may skip to, and `selectedGrade` decides which maths they are
 * asked - so both need to degrade to something sane rather than being
 * trusted.
 */

const STORAGE_KEY = 'pixelMathBlaster.profile.v1';

/**
 * A minimal localStorage, rather than pulling in jsdom for two methods.
 * PlayerProfile only ever calls getItem/setItem, and it feature-detects
 * `window` - so this is the whole of the surface under test.
 */
const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
});
afterAll(() => delete (globalThis as { window?: unknown }).window);

function storeRaw(value: string): void {
  store.set(STORAGE_KEY, value);
}

beforeEach(() => store.clear());

describe('a fresh profile', () => {
  it('starts with nothing banked and nothing unlocked', () => {
    const profile = createEmptyProfile();
    expect(profile.currency).toBe(0);
    expect(profile.skillProgress).toEqual({});
    expect(profile.skillSubProgress).toEqual({});
    expect(profile.selectedGrade).toBe(DEFAULT_GRADE);
    expect(profile.highestWaveReached).toBe(1);
  });

  it('is what an empty store loads as', () => {
    expect(loadPlayerProfile()).toEqual(createEmptyProfile());
  });
});

describe('round-tripping', () => {
  it('preserves everything that persists', () => {
    const profile = createEmptyProfile();
    profile.currency = 420;
    profile.skillProgress = { checkpoint: 2 };
    profile.skillSubProgress = { checkpoint: 1 };
    profile.selectedGrade = '2';
    profile.highestWaveReached = 17;

    savePlayerProfile(profile);
    expect(loadPlayerProfile()).toEqual(profile);
  });
});

describe('surviving a bad payload', () => {
  it('falls back cleanly on unparseable JSON', () => {
    storeRaw('{not json');
    expect(loadPlayerProfile()).toEqual(createEmptyProfile());
  });

  it('fills in fields a older save never had', () => {
    // A profile written before grades or the wave record existed.
    storeRaw(JSON.stringify({ currency: 50, skillProgress: { dodge: 1 }, skillSubProgress: {} }));
    const loaded = loadPlayerProfile();
    expect(loaded.currency).toBe(50);
    expect(loaded.skillProgress).toEqual({ dodge: 1 });
    expect(loaded.selectedGrade).toBe(DEFAULT_GRADE);
    expect(loaded.highestWaveReached).toBe(1);
  });

  it('rejects a grade that is not a real grade', () => {
    // Otherwise an unknown grade reaches the curriculum ladder and the run
    // has no problems in it.
    for (const selectedGrade of ['13', 'kindergarten', '', 7, null, {}]) {
      storeRaw(JSON.stringify({ selectedGrade }));
      expect(loadPlayerProfile().selectedGrade).toBe(DEFAULT_GRADE);
    }
  });

  it('accepts every real grade', () => {
    for (const grade of ['K', '1', '2', '3', '9']) {
      storeRaw(JSON.stringify({ selectedGrade: grade }));
      expect(loadPlayerProfile().selectedGrade).toBe(grade);
    }
  });

  it('refuses a wave record that would unlock arbitrary waves', () => {
    // This value is the ceiling on what a player may skip to, so a
    // hand-edited or corrupted profile must not be able to raise it to
    // something nonsensical and stay there.
    for (const highestWaveReached of ['999', null, NaN, Infinity, -Infinity, {}, undefined]) {
      storeRaw(JSON.stringify({ highestWaveReached }));
      expect(loadPlayerProfile().highestWaveReached).toBe(1);
    }
  });

  it('floors a fractional or sub-1 wave record', () => {
    storeRaw(JSON.stringify({ highestWaveReached: 12.9 }));
    expect(loadPlayerProfile().highestWaveReached).toBe(12);
    storeRaw(JSON.stringify({ highestWaveReached: 0 }));
    expect(loadPlayerProfile().highestWaveReached).toBe(1);
    storeRaw(JSON.stringify({ highestWaveReached: -40 }));
    expect(loadPlayerProfile().highestWaveReached).toBe(1);
  });

  it('ignores a non-object skill map rather than trusting it', () => {
    storeRaw(JSON.stringify({ skillProgress: 'all of them', skillSubProgress: 5 }));
    const loaded = loadPlayerProfile();
    expect(loaded.skillProgress).toEqual({});
    expect(loaded.skillSubProgress).toEqual({});
  });
});
