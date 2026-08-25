import {
  BOSS_MIN_SURVIVE_SEC,
  WAVE_BOSS_INTERVAL,
  arcadeDifficultyFor,
  backdropForWave,
  bossMinFightSec,
  bossOrdinal,
  bossRulesFor,
  bossScopeForWave,
  bossSurviveSecFor,
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

/** The roster's finales in authored (easiest-first) order - the yardstick
 * for "a later boss never gets an easier finale". */
const FINALE_ORDER = BOSS_ROSTER.map((b) => b.finaleProblem);

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

  it('cycles the authored roster for IDENTITY only', () => {
    // The roster supplies name, sprite and the phase names that give a
    // fight its voice. It no longer supplies the phases themselves - those
    // are generated from the wave, which is the whole point of this change.
    const scope = DEFAULT_CURRICULUM_LADDER.slice(0, 1);
    for (let ordinal = 1; ordinal <= BOSS_ROSTER.length * 2; ordinal++) {
      const rules = bossRulesFor(ordinal * WAVE_BOSS_INTERVAL, scope);
      const template = BOSS_ROSTER[(ordinal - 1) % BOSS_ROSTER.length];
      expect(rules.sprite).toBe(template.sprite);
      expect(rules.name).toContain(template.name);
      // Its opening phase still carries the authored phase's name.
      expect(rules.phases[0].name).toContain(template.phases[0].name);
    }
  });

  /** Every boss ordinal from the first to well past the authored material. */
  const ORDINALS = Array.from({ length: 24 }, (_, i) => i + 1);

  it('never gets easier as the wave number climbs', () => {
    // This is the property the old roster-driven code broke: because the
    // roster cycles and its entries are easiest-first, wave 20 inherited
    // wave 5's 2-phase, 24s fight and its easier finale, so a run got
    // EASIER at wave 20 than it had been at wave 15.
    const scope = DEFAULT_CURRICULUM_LADDER;
    let previous = bossRulesFor(WAVE_BOSS_INTERVAL, scope);

    for (const ordinal of ORDINALS.slice(1)) {
      const rules = bossRulesFor(ordinal * WAVE_BOSS_INTERVAL, scope);
      expect(rules.surviveSec).toBeGreaterThanOrEqual(previous.surviveSec);
      expect(rules.comboToDefeat).toBeGreaterThanOrEqual(previous.comboToDefeat);
      expect(rules.phases.length).toBeGreaterThanOrEqual(previous.phases.length);
      expect(rules.scopeBias!).toBeGreaterThanOrEqual(previous.scopeBias!);
      previous = rules;
    }
  });

  it('escalates visibly between consecutive bosses, not just across passes', () => {
    const scope = DEFAULT_CURRICULUM_LADDER;
    const first = bossRulesFor(WAVE_BOSS_INTERVAL, scope);
    const second = bossRulesFor(WAVE_BOSS_INTERVAL * 2, scope);
    const deep = bossRulesFor(WAVE_BOSS_INTERVAL * 8, scope);

    // Consecutive fights are never structurally identical - the per-fight
    // creep on the floor covers the gaps between combo/phase steps.
    expect(second.surviveSec).toBeGreaterThan(first.surviveSec);
    // And a deep fight is harder on every axis, not just longer.
    expect(deep.comboToDefeat).toBeGreaterThan(first.comboToDefeat);
    expect(deep.phases.length).toBeGreaterThan(first.phases.length);
    expect(deep.scopeBias!).toBeGreaterThan(first.scopeBias!);
    // A repeat visit announces itself rather than reading as the same fight.
    expect(bossRulesFor(WAVE_BOSS_INTERVAL * (BOSS_ROSTER.length + 1), scope).name).not.toBe(first.name);
  });

  it('never runs a fight shorter than the 30-second minimum', () => {
    for (const ordinal of ORDINALS) {
      const wave = ordinal * WAVE_BOSS_INTERVAL;
      expect(bossMinFightSec(wave)).toBeGreaterThanOrEqual(BOSS_MIN_SURVIVE_SEC);
      // And the endurance route always has headroom above the floor for
      // timer cuts to bite into. Collapse these two and "good answers
      // shorten the fight" silently stops being true.
      expect(bossSurviveSecFor(wave)).toBeGreaterThan(bossMinFightSec(wave));
    }
  });

  it('always leaves room to actually land the combo', () => {
    // The mastery route must be reachable at EVERY wave. It was not: each
    // exact answer cut 2.6s off a 20s clock on top of the seconds spent
    // thinking, so survival always won the race and the measured mastery
    // rate was 0% everywhere. The fight's floor is what guarantees the room,
    // which makes this a relationship between constants rather than a
    // property of any one of them.
    const secPerAnswer = 5.5;
    for (const ordinal of ORDINALS) {
      const wave = ordinal * WAVE_BOSS_INTERVAL;
      const rules = bossRulesFor(wave, DEFAULT_CURRICULUM_LADDER);
      expect(rules.comboToDefeat * secPerAnswer).toBeLessThanOrEqual(bossMinFightSec(wave));
    }
  });

  it('opens every fight unshielded, however deep the run is', () => {
    // Authored bosses were all written this way so the shield is introduced
    // rather than sprung. Generating the phases must not quietly drop it.
    for (const ordinal of ORDINALS) {
      const rules = bossRulesFor(ordinal * WAVE_BOSS_INTERVAL, DEFAULT_CURRICULUM_LADDER);
      expect(rules.phases[0].shieldedSec).toBe(0);
    }
  });

  it('only ever calls in adds a struggling player can answer', () => {
    // A reinforcement is a consequence of not engaging with the maths, so
    // it has to be answerable. A two-layer bulwark or a shielded sentinel
    // is a second problem stacked on the one being failed.
    for (const ordinal of ORDINALS) {
      const rules = bossRulesFor(ordinal * WAVE_BOSS_INTERVAL, DEFAULT_CURRICULUM_LADDER);
      for (const phase of rules.phases) {
        expect(['bulwark', 'sentinel']).not.toContain(phase.addArchetype);
      }
    }
  });

  it('never hands a later boss an easier finale than an earlier one', () => {
    const scope = DEFAULT_CURRICULUM_LADDER;
    let previous = bossRulesFor(WAVE_BOSS_INTERVAL, scope).finaleProblem;
    for (const ordinal of ORDINALS.slice(1)) {
      const finale = bossRulesFor(ordinal * WAVE_BOSS_INTERVAL, scope).finaleProblem;
      const index = FINALE_ORDER.indexOf(finale);
      expect(index).toBeGreaterThanOrEqual(FINALE_ORDER.indexOf(previous));
      previous = finale;
    }
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

  it('trims an opening formation below its authored width', () => {
    // Wave 3 is authored as a trio, but the opening cap is a pair. This is
    // the early-game difficulty curve: a child who can only answer one
    // problem per descent leaks every enemy past the first no matter how
    // many were sent, so a third arrival is pure penalty, not difficulty.
    expect(arcadeDifficultyFor(3).maxConcurrent).toBe(2);
    expect(waveSpecFor(3).archetypes).toHaveLength(2);
  });

  it('sends more at once as a run goes on, so concurrency is a real escalation', () => {
    // The cap used to only ever trim: every authored formation already sat
    // within it, so raising the ramp changed nothing at all until the tail
    // started cycling some thirty waves in - and a player quick enough to
    // clear four enemies just coasted until then.
    const meanWidth = (from: number, to: number) => {
      const widths: number[] = [];
      for (let wave = from; wave <= to; wave++) {
        if (!isBossWave(wave)) widths.push(waveSpecFor(wave).archetypes.length);
      }
      return widths.reduce((a, b) => a + b, 0) / widths.length;
    };

    expect(meanWidth(11, 20)).toBeGreaterThan(meanWidth(1, 10));
    expect(meanWidth(31, 40)).toBeGreaterThan(meanWidth(11, 20));
  });

  it('keeps the authored contrast between a breather wave and a busy one', () => {
    // Widening adds the same number of slots to every formation rather than
    // filling each to the cap, so the ladder's internal shape survives -
    // a wave authored as a lone bulwark still reads as a lull deep into a
    // run, instead of every wave flattening out to the same width.
    const widths = WAVES.filter((w) => !isBossWave(w)).map((w) => waveSpecFor(w).archetypes.length);
    const deepWidths = widths.slice(40);
    expect(Math.min(...deepWidths)).toBeLessThan(Math.max(...deepWidths));
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
