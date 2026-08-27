import { GAME_LEVELS } from './gameLevels';
import { phaseIndexForProgress, type BossPhase } from './LevelDefinition';
import { enemyArchetype } from './enemyArchetypes';

function phase(overrides: Partial<BossPhase> = {}): BossPhase {
  return {
    name: 'Phase',
    weight: 1,
    driftSpeed: 10,
    addInterval: [2, 3],
    addArchetype: 'spore',
    vulnerableSec: 5,
    shieldedSec: 4,
    ...overrides,
  };
}

describe('phaseIndexForProgress', () => {
  const three = [phase({ name: 'a' }), phase({ name: 'b' }), phase({ name: 'c' })];

  it('starts on the first phase and ends on the last', () => {
    expect(phaseIndexForProgress(three, 0)).toBe(0);
    expect(phaseIndexForProgress(three, 1)).toBe(2);
  });

  it('splits equal weights into equal slices of the fight', () => {
    expect(phaseIndexForProgress(three, 0.32)).toBe(0);
    expect(phaseIndexForProgress(three, 0.5)).toBe(1);
    expect(phaseIndexForProgress(three, 0.9)).toBe(2);
  });

  it('reads weights as proportions, not absolute durations', () => {
    const weighted = [phase({ weight: 3 }), phase({ weight: 1 })];
    expect(phaseIndexForProgress(weighted, 0.7)).toBe(0);
    expect(phaseIndexForProgress(weighted, 0.8)).toBe(1);
  });

  it('clamps progress that has run past either end', () => {
    expect(phaseIndexForProgress(three, -1)).toBe(0);
    expect(phaseIndexForProgress(three, 4)).toBe(2);
  });

  it('never advances past a single-phase fight', () => {
    expect(phaseIndexForProgress([phase()], 0.99)).toBe(0);
  });
});

describe('authored levels', () => {
  it.each(GAME_LEVELS.map((l) => [l.id, l] as const))('%s has a usable wave plan', (_id, level) => {
    expect(level.waves.waves.length).toBeGreaterThan(0);
    for (const wave of level.waves.waves) {
      expect(wave.archetypes.length).toBeGreaterThan(0);
      expect(wave.gapSec).toBeGreaterThan(0);
      for (const id of wave.archetypes) expect(enemyArchetype(id)).toBeDefined();
    }
  });

  it.each(GAME_LEVELS.filter((l) => l.boss).map((l) => [l.id, l.boss!] as const))(
    '%s boss is winnable by both routes',
    (_id, boss) => {
      expect(boss.phases.length).toBeGreaterThan(0);
      expect(boss.surviveSec).toBeGreaterThan(0);
      expect(boss.comboToDefeat).toBeGreaterThan(0);
      expect(boss.scope.length).toBeGreaterThan(0);
    }
  );

  it.each(GAME_LEVELS.filter((l) => l.boss).map((l) => [l.id, l.boss!] as const))(
    '%s boss opens unshielded, so weak points are introduced rather than sprung',
    (_id, boss) => {
      expect(boss.phases[0].shieldedSec).toBe(0);
    }
  );

  it.each(GAME_LEVELS.filter((l) => l.boss).map((l) => [l.id, l.boss!] as const))(
    '%s boss gives every shielded phase a window to shoot in',
    (_id, boss) => {
      for (const p of boss.phases) {
        if (p.shieldedSec > 0) expect(p.vulnerableSec).toBeGreaterThan(0);
      }
    }
  );

  it('never asks for more exact answers in a row than the fight has room for', () => {
    // A rough sanity bound: at the exact-answer cut rate, a perfect combo
    // has to be reachable before the survive clock runs out on its own.
    for (const level of GAME_LEVELS) {
      if (!level.boss) continue;
      const secondsPerAnswer = 1.6; // fire cooldown plus reading time
      expect(level.boss.comboToDefeat * secondsPerAnswer).toBeLessThan(level.boss.surviveSec);
    }
  });
});
