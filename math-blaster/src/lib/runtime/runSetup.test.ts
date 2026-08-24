import {
  SKIP_COST_PER_WAVE,
  checkpointWave,
  SKIP_STEP_WAVES,
  freeStartWave,
  maxStartWave,
  nextSkipTarget,
  purchaseSkip,
  recordWaveReached,
  skipCost,
  startsOnBoss,
} from './runSetup';
import { createEmptyProfile, type PlayerProfile } from './PlayerProfile';
import { WAVE_BOSS_INTERVAL, isBossWave } from '../levels/waveProgression';

/**
 * Where a run is allowed to begin.
 *
 * The property that matters most: neither route past the early waves can
 * ever put a player into a wave they have not personally reached. Skipping
 * skips ground already covered; it must never buy access to unseen content.
 */

function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return { ...createEmptyProfile(), ...overrides };
}

/** A profile with the progression gate and `level` of Checkpoint bought. */
function withCheckpoint(level: number, highestWaveReached = 999): PlayerProfile {
  return profile({
    highestWaveReached,
    skillProgress: { 'skills-root': 1, 'branch-progression': 1, checkpoint: level },
  });
}

describe('the free checkpoint', () => {
  it('starts everyone at wave 1 before anything is bought', () => {
    expect(freeStartWave(profile())).toBe(1);
  });

  it('grants a later wave per level', () => {
    const waves = [1, 2, 3].map((level) => freeStartWave(withCheckpoint(level)));
    expect(waves).toEqual([...waves].sort((a, b) => a - b));
    expect(waves[0]).toBeGreaterThan(1);
    expect(new Set(waves).size).toBe(3);
  });

  it('lands every level on a boss wave, which is the point of buying it', () => {
    for (const level of [1, 2, 3]) {
      expect(isBossWave(freeStartWave(withCheckpoint(level)))).toBe(true);
    }
  });

  it('is clamped by how far the player has actually reached', () => {
    // Buying Checkpoint before ever reaching wave 5 must not skip content.
    expect(freeStartWave(withCheckpoint(3, 1))).toBe(1);
    expect(freeStartWave(withCheckpoint(3, 7))).toBe(7);
  });

  it('reports the unclamped grant separately, so the UI can say which it is', () => {
    // "Hasn't bought Checkpoint" and "bought it but hasn't got there yet"
    // both clamp to wave 1, and they need different words.
    expect(checkpointWave(profile())).toBe(1);
    const bought = withCheckpoint(2, 1);
    expect(freeStartWave(bought)).toBe(1);
    expect(checkpointWave(bought)).toBeGreaterThan(1);
  });
});

describe('the paid skip', () => {
  it('charges per wave skipped', () => {
    expect(skipCost(1, 1 + SKIP_STEP_WAVES)).toBe(SKIP_STEP_WAVES * SKIP_COST_PER_WAVE);
  });

  it('charges nothing for a non-skip, so callers need no special case', () => {
    expect(skipCost(10, 10)).toBe(0);
    expect(skipCost(10, 4)).toBe(0);
  });

  it('moves in whole boss intervals', () => {
    const target = nextSkipTarget(profile({ highestWaveReached: 999 }), 1);
    expect(target).toBe(1 + SKIP_STEP_WAVES);
    expect(SKIP_STEP_WAVES).toBe(WAVE_BOSS_INTERVAL);
  });

  it('offers nothing once the player is at their ceiling', () => {
    expect(nextSkipTarget(profile({ highestWaveReached: 6 }), 6)).toBeNull();
    expect(nextSkipTarget(profile(), 1)).toBeNull();
  });

  it('spends the currency and moves the start wave', () => {
    const before = profile({ highestWaveReached: 999, currency: 500 });
    const bought = purchaseSkip(before, 1, 1 + SKIP_STEP_WAVES);

    expect(bought).not.toBeNull();
    expect(bought!.startWave).toBe(1 + SKIP_STEP_WAVES);
    expect(bought!.spent).toBe(skipCost(1, 1 + SKIP_STEP_WAVES));
    expect(bought!.profile.currency).toBe(500 - bought!.spent);
    // Pure: the caller owns the mutation.
    expect(before.currency).toBe(500);
  });

  it('refuses a skip the player cannot afford', () => {
    expect(purchaseSkip(profile({ highestWaveReached: 999, currency: 1 }), 1, 1 + SKIP_STEP_WAVES)).toBeNull();
  });

  it('refuses to skip past what the player has reached', () => {
    // The guarantee the whole feature rests on - money must not buy access
    // to a wave nobody has seen.
    const rich = profile({ highestWaveReached: 6, currency: 100000 });
    expect(purchaseSkip(rich, 1, 50)).toBeNull();
    expect(purchaseSkip(rich, 1, 7)).toBeNull();
    expect(purchaseSkip(rich, 1, 6)).not.toBeNull();
  });

  it('refuses a backwards or standing-still "skip"', () => {
    const p = profile({ highestWaveReached: 20, currency: 1000 });
    expect(purchaseSkip(p, 10, 10)).toBeNull();
    expect(purchaseSkip(p, 10, 4)).toBeNull();
  });

  it('stacks on top of the free checkpoint rather than replacing it', () => {
    const p = withCheckpoint(1, 999);
    p.currency = 1000;
    const free = freeStartWave(p);
    const bought = purchaseSkip(p, free, free + SKIP_STEP_WAVES);
    expect(bought!.startWave).toBe(free + SKIP_STEP_WAVES);
  });
});

describe('the reached-wave ceiling', () => {
  it('starts at wave 1', () => {
    expect(maxStartWave(profile())).toBe(1);
  });

  it('rises as waves are reached', () => {
    let p = profile();
    p = recordWaveReached(p, 4);
    expect(maxStartWave(p)).toBe(4);
  });

  it('never falls back', () => {
    let p = profile({ highestWaveReached: 12 });
    p = recordWaveReached(p, 3);
    expect(p.highestWaveReached).toBe(12);
  });

  it('returns the same object when nothing changed, so a save can be skipped', () => {
    const p = profile({ highestWaveReached: 12 });
    expect(recordWaveReached(p, 12)).toBe(p);
    expect(recordWaveReached(p, 1)).toBe(p);
  });

  it('never records below wave 1, whatever it is handed', () => {
    expect(maxStartWave(profile({ highestWaveReached: 0 }))).toBe(1);
    expect(maxStartWave(profile({ highestWaveReached: -5 }))).toBe(1);
  });
});

describe('labelling a start wave', () => {
  it('reports whether a start drops straight into a boss', () => {
    expect(startsOnBoss(WAVE_BOSS_INTERVAL)).toBe(true);
    expect(startsOnBoss(WAVE_BOSS_INTERVAL - 1)).toBe(false);
  });
});
