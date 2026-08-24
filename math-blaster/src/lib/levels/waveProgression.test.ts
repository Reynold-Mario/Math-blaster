import {
  WAVE_BOSS_INTERVAL,
  arcadeDifficultyFor,
  backdropForWave,
  bossOrdinal,
  bossRulesFor,
  bossScopeForWave,
  curriculumForWave,
  isBossWave,
  waveSpecFor,
  DEFAULT_CURRICULUM_LADDER,
} from './waveProgression';
import { BACKDROP_LADDER, BOSS_ROSTER } from './gameLevels';
import { enemyArchetype } from './enemyArchetypes';

/**
 * The endless ladder that replaced the seven-stage array. These are the
 * properties the rest of the game leans on: that a wave number is enough
 * to know what a wave is, that it's the same answer every time, and that
 * the sequence never runs out or plateaus.
 */

/** Deep enough to run well past the authored material and into the tail. */
const DEEP = 160;
const WAVES = Array.from({ length: DEEP }, (_, i) => i + 1);

describe('boss cadence', () => {
  it('puts a boss on every Nth wave and nowhere else', () => {
    for (const wave of WAVES) {
      expect(isBossWave(wave)).toBe(wave % WAVE_BOSS_INTERVAL === 0);
    }
  });

  it('never calls wave 0 a boss wave', () => {
    expect(isBossWave(0)).toBe(false);
  });

  it('numbers the fights in order', () => {
    expect(bossOrdinal(WAVE_BOSS_INTERVAL)).toBe(1);
    expect(bossOrdinal(WAVE_BOSS_INTERVAL * 4)).toBe(4);
  });

  it('cycles the authored roster', () => {
    const scope = DEFAULT_CURRICULUM_LADDER.slice(0, 1);
    for (let ordinal = 1; ordinal <= BOSS_ROSTER.length * 2; ordinal++) {
      const rules = bossRulesFor(ordinal * WAVE_BOSS_INTERVAL, scope);
      const template = BOSS_ROSTER[(ordinal - 1) % BOSS_ROSTER.length];
      expect(rules.sprite).toBe(template.sprite);
      expect(rules.phases).toBe(template.phases);
      expect(rules.name).toContain(template.name);
    }
  });

  it('escalates a boss on each pass through the roster', () => {
    const scope = DEFAULT_CURRICULUM_LADDER;
    const first = bossRulesFor(WAVE_BOSS_INTERVAL, scope);
    const second = bossRulesFor(WAVE_BOSS_INTERVAL * (BOSS_ROSTER.length + 1), scope);

    expect(second.surviveSec).toBeGreaterThan(first.surviveSec);
    expect(second.comboToDefeat).toBeGreaterThan(first.comboToDefeat);
    // A repeat visit announces itself rather than reading as the same fight.
    expect(second.name).not.toBe(first.name);
  });

  it('takes its maths from the scope it is handed, not from the roster', () => {
    // This is what lets a boss appear on wave 5 for any curriculum - only
    // two of the seven authored bundles have a boss at all.
    const scope = DEFAULT_CURRICULUM_LADDER.slice(0, 2);
    expect(bossRulesFor(WAVE_BOSS_INTERVAL, scope).scope).toBe(scope);
  });
});

describe('wave formations', () => {
  it('always sends at least one enemy', () => {
    for (const wave of WAVES) {
      if (isBossWave(wave)) continue;
      expect(waveSpecFor(wave).archetypes.length).toBeGreaterThan(0);
    }
  });

  it('only names archetypes that exist', () => {
    for (const wave of WAVES) {
      if (isBossWave(wave)) continue;
      for (const id of waveSpecFor(wave).archetypes) expect(enemyArchetype(id)).toBeDefined();
    }
  });

  it('is deterministic - the same wave number is the same wave', () => {
    for (const wave of [1, 4, 17, 33, 91, 150]) {
      expect(waveSpecFor(wave)).toEqual(waveSpecFor(wave));
    }
  });

  it('never exceeds the wave maxConcurrent, so the screen stays readable', () => {
    for (const wave of WAVES) {
      if (isBossWave(wave)) continue;
      expect(waveSpecFor(wave).archetypes.length).toBeLessThanOrEqual(
        arcadeDifficultyFor(wave).maxConcurrent
      );
    }
  });

  it('keeps a positive gap so a wave never has a zero-length breather', () => {
    for (const wave of WAVES) {
      if (isBossWave(wave)) continue;
      expect(waveSpecFor(wave).gapSec).toBeGreaterThan(0);
    }
  });

  it('skips a formation on boss waves without skipping one in the ladder', () => {
    // A boss consumes a wave *number*, not a formation - so the wave after
    // a boss must send the formation the boss wave did not.
    const beforeBoss = waveSpecFor(WAVE_BOSS_INTERVAL - 1);
    const afterBoss = waveSpecFor(WAVE_BOSS_INTERVAL + 1);
    expect(afterBoss).not.toEqual(beforeBoss);
  });
});

describe('difficulty ramp', () => {
  it('never gets easier as waves go on', () => {
    let previousSpeed = -Infinity;
    let previousCap = -Infinity;
    for (const wave of WAVES) {
      const { fallSpeed, maxConcurrent } = arcadeDifficultyFor(wave);
      expect(fallSpeed[0]).toBeGreaterThanOrEqual(previousSpeed);
      expect(maxConcurrent).toBeGreaterThanOrEqual(previousCap);
      previousSpeed = fallSpeed[0];
      previousCap = maxConcurrent;
    }
  });

  it('keeps min below max fall speed throughout', () => {
    for (const wave of WAVES) {
      const [min, max] = arcadeDifficultyFor(wave).fallSpeed;
      expect(min).toBeLessThan(max);
    }
  });

  it('keeps climbing past the authored ramp rather than plateauing', () => {
    // An endless run has to stay able to out-scale a good player.
    expect(arcadeDifficultyFor(DEEP).fallSpeed[0]).toBeGreaterThan(
      arcadeDifficultyFor(30).fallSpeed[0]
    );
  });

  it('caps concurrency, because an unreadable screen is not difficulty', () => {
    expect(arcadeDifficultyFor(10_000).maxConcurrent).toBeLessThanOrEqual(8);
  });
});

describe('curriculum ladder', () => {
  const ladder = DEFAULT_CURRICULUM_LADDER;

  it('starts on the easiest rung', () => {
    expect(curriculumForWave(ladder, 1)).toBe(ladder[0]);
  });

  it('walks up the ladder as waves climb', () => {
    const seen = WAVES.map((w) => ladder.indexOf(curriculumForWave(ladder, w)));
    expect(seen[0]).toBe(0);
    expect(Math.max(...seen)).toBe(ladder.length - 1);
    // Only ever forward.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('holds at the hardest rung instead of wrapping to the tutorial', () => {
    expect(curriculumForWave(ladder, DEEP)).toBe(ladder[ladder.length - 1]);
    expect(curriculumForWave(ladder, 10_000)).toBe(ladder[ladder.length - 1]);
  });

  it('never reaches past the ladder it was handed', () => {
    // The guarantee a grade-scoped ladder will rely on: a run cannot drift
    // into maths the player was not meant to be practising.
    const scoped = ladder.slice(0, 2);
    for (const wave of WAVES) {
      expect(scoped).toContain(curriculumForWave(scoped, wave));
    }
  });

  it('builds a boss scope that is cumulative and easiest-first', () => {
    for (const wave of WAVES) {
      const scope = bossScopeForWave(ladder, wave);
      expect(scope.length).toBeGreaterThan(0);
      expect(scope).toEqual(ladder.slice(0, scope.length));
      expect(scope[scope.length - 1]).toBe(curriculumForWave(ladder, wave));
    }
  });
});

describe('backdrop', () => {
  /** #rrggbb -> channel triple, for measuring how far a blend has moved. */
  function rgb(hex: string): [number, number, number] {
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  function distance(a: string, b: string): number {
    const [ar, ag, ab] = rgb(a);
    const [br, bg, bb] = rgb(b);
    return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
  }

  it('always resolves to a full, well-formed palette', () => {
    for (const wave of WAVES) {
      const backdrop = backdropForWave(wave);
      rgb(backdrop.sky1);
      rgb(backdrop.sky2);
      rgb(backdrop.ground);
      expect(backdrop.name.length).toBeGreaterThan(0);
    }
  });

  it('starts on the authored opening palette', () => {
    expect(backdropForWave(1)).toMatchObject({
      sky1: BACKDROP_LADDER[0].sky1,
      sky2: BACKDROP_LADDER[0].sky2,
      ground: BACKDROP_LADDER[0].ground,
    });
  });

  it('moves every single wave, so progress is always visible', () => {
    // A step function would leave consecutive waves identical, which is the
    // difference between "somewhere else" and "further along".
    for (let wave = 1; wave < 20; wave++) {
      if (isBossWave(wave) || isBossWave(wave + 1)) continue;
      expect(backdropForWave(wave)).not.toEqual(backdropForWave(wave + 1));
    }
  });

  it('travels in small steps rather than snapping between palettes', () => {
    // The whole point of interpolating: no single wave should jump the full
    // distance between two authored looks.
    const rungGap = distance(BACKDROP_LADDER[0].sky1, BACKDROP_LADDER[1].sky1);
    for (let wave = 1; wave < 20; wave++) {
      if (isBossWave(wave) || isBossWave(wave + 1)) continue;
      const step = distance(backdropForWave(wave).sky1, backdropForWave(wave + 1).sky1);
      expect(step).toBeLessThan(rungGap);
    }
  });

  it('works its way through every authored look', () => {
    const names = new Set(WAVES.map((w) => backdropForWave(w).name));
    for (const rung of BACKDROP_LADDER) expect(names).toContain(rung.name);
  });

  it('settles rather than cycling back to the opening look', () => {
    // Wrapping would put the opening garden back on screen at wave 90,
    // which reads as losing progress.
    expect(backdropForWave(DEEP)).toEqual(backdropForWave(DEEP + 50));
    expect(backdropForWave(DEEP).sky1).not.toBe(BACKDROP_LADDER[0].sky1);
  });

  it('darkens a boss wave so it reads as an event', () => {
    const boss = backdropForWave(WAVE_BOSS_INTERVAL);
    const before = backdropForWave(WAVE_BOSS_INTERVAL - 1);
    const sum = (hex: string) => rgb(hex).reduce((a, b) => a + b, 0);
    expect(sum(boss.sky1)).toBeLessThan(sum(before.sky1));
    expect(sum(boss.ground)).toBeLessThan(sum(before.ground));
  });
});
