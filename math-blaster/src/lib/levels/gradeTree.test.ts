import {
  GRADE_ORDER,
  GRADE_TOPICS,
  curriculumLadderForGrade,
  cumulativeScopeForGrade,
  topicsForGrade,
  type GradeLevel,
} from './gradeTree';
import { curriculumForWave } from './waveProgression';
import { generateProblem } from './problemGenerators';
import { toNumber } from '../math/MathValue';

/**
 * The curriculum ladders a run is scoped to. The property that matters is
 * containment: a run at a grade must never ask a question from a harder
 * one, however long it goes on. That's the whole reason grade selection
 * exists rather than letting difficulty drift with the wave count.
 */

const AUTHORED: GradeLevel[] = GRADE_ORDER.filter((g) => topicsForGrade(g).length > 0);

describe('grade ladders', () => {
  it('has authored maths for K through 3', () => {
    expect(AUTHORED).toEqual(['K', '1', '2', '3']);
  });

  it('gives every authored grade a non-empty ladder', () => {
    for (const grade of AUTHORED) {
      expect(curriculumLadderForGrade(grade).length).toBeGreaterThan(0);
    }
  });

  it("scopes a grade's ladder to that grade's own topics", () => {
    for (const grade of AUTHORED) {
      const own = topicsForGrade(grade).map((t) => {
        const effect = t.effectAtLevel(1);
        return effect.kind === 'unlocked' ? effect.curriculum : null;
      });
      expect(curriculumLadderForGrade(grade)).toEqual(own);
    }
  });

  it('never lets a run reach past its grade, however long it runs', () => {
    // The guarantee the whole feature rests on. A Grade 1 player having a
    // very good run must not start being asked Grade 3 questions.
    for (const grade of AUTHORED) {
      const ladder = curriculumLadderForGrade(grade);
      for (let wave = 1; wave <= 300; wave++) {
        expect(ladder).toContain(curriculumForWave(ladder, wave));
      }
    }
  });

  it('keeps ladders disjoint between grades', () => {
    // If two grades shared a curriculum, "which grade am I practising"
    // would stop being answerable from the problems on screen.
    for (let i = 0; i < AUTHORED.length; i++) {
      for (let j = i + 1; j < AUTHORED.length; j++) {
        const a = curriculumLadderForGrade(AUTHORED[i]);
        const b = curriculumLadderForGrade(AUTHORED[j]);
        for (const curriculum of a) expect(b).not.toContain(curriculum);
      }
    }
  });

  it('falls back to the whole game for an unauthored grade', () => {
    // Grades 4-12 are typed but have no topics. A run with no problems in
    // it is a far worse failure than a run at the wrong difficulty.
    for (const grade of GRADE_ORDER.filter((g) => !AUTHORED.includes(g))) {
      expect(curriculumLadderForGrade(grade).length).toBeGreaterThan(0);
    }
  });
});

describe('boss scope', () => {
  it('is cumulative from Kindergarten up', () => {
    for (const grade of AUTHORED) {
      const scope = cumulativeScopeForGrade(grade);
      const expected = AUTHORED.slice(0, AUTHORED.indexOf(grade) + 1).flatMap((g) =>
        curriculumLadderForGrade(g)
      );
      expect(scope).toEqual(expected);
    }
  });

  it('is at least as wide as the wave ladder - waves teach, bosses test', () => {
    for (const grade of AUTHORED) {
      const scope = cumulativeScopeForGrade(grade);
      for (const rung of curriculumLadderForGrade(grade)) expect(scope).toContain(rung);
      if (grade !== AUTHORED[0]) {
        expect(scope.length).toBeGreaterThan(curriculumLadderForGrade(grade).length);
      }
    }
  });

  it('stays ordered easiest-first, which generateBossProblem relies on', () => {
    // It weights selection toward the end of the array as a fight goes on,
    // so a scope out of order would make a fight get *easier*.
    for (const grade of AUTHORED) {
      const ranges = cumulativeScopeForGrade(grade).map((c) => c.numberRange[1]);
      const firstMultiply = cumulativeScopeForGrade(grade).findIndex((c) =>
        c.operations.some((op) => op === '×' || op === '÷')
      );
      // Within the addition/subtraction run, ranges only widen.
      const additive = firstMultiply === -1 ? ranges : ranges.slice(0, firstMultiply);
      expect([...additive].sort((a, b) => a - b)).toEqual(additive);
    }
  });
});

describe('problems a grade actually produces', () => {
  it('keeps Kindergarten inside single digits', () => {
    const ladder = curriculumLadderForGrade('K');
    for (let i = 0; i < 200; i++) {
      for (const curriculum of ladder) {
        const problem = generateProblem(curriculum);
        expect(toNumber(problem.answer)).toBeGreaterThanOrEqual(0);
        expect(toNumber(problem.answer)).toBeLessThanOrEqual(10);
      }
    }
  });

  it('never gives Kindergarten a multiplication or division problem', () => {
    for (const curriculum of curriculumLadderForGrade('K')) {
      expect(curriculum.operations).not.toContain('×');
      expect(curriculum.operations).not.toContain('÷');
    }
  });

  it('does introduce multiplication by Grade 3', () => {
    const ops = curriculumLadderForGrade('3').flatMap((c) => c.operations);
    expect(ops).toContain('×');
  });

  it('keeps GRADE_TOPICS and GRADE_ORDER consistent', () => {
    for (const grade of Object.keys(GRADE_TOPICS) as GradeLevel[]) {
      expect(GRADE_ORDER).toContain(grade);
    }
  });
});

describe('the topic id is the join key', () => {
  /**
   * A curriculum's `id` must equal the id of the topic node that teaches
   * it. Mastery is recorded against that string, so a topic with two
   * names splits one child's practice across two rows that never add up -
   * and nothing would ever throw to tell you.
   */
  it('gives every topic node a curriculum that names it', () => {
    for (const [grade, topics] of Object.entries(GRADE_TOPICS)) {
      for (const topic of topics ?? []) {
        const effect = topic.effectAtLevel(1);
        expect(effect.kind).toBe('unlocked');
        if (effect.kind !== 'unlocked') continue;
        expect(effect.curriculum.id).toBe(topic.id);
        expect(`${grade}:${effect.curriculum.id}`).toBe(`${grade}:${topic.id}`);
      }
    }
  });

  it('never hands the same id to two different curricula', () => {
    // The failure this catches: copying a curriculum literal instead of
    // importing it, so two objects claim one topic and then drift apart.
    const byId = new Map<string, string>();
    for (const topics of Object.values(GRADE_TOPICS)) {
      for (const topic of topics ?? []) {
        const effect = topic.effectAtLevel(1);
        if (effect.kind !== 'unlocked') continue;
        const shape = JSON.stringify([effect.curriculum.operations, effect.curriculum.numberRange]);
        const seen = byId.get(effect.curriculum.id);
        if (seen !== undefined) expect(shape).toBe(seen);
        byId.set(effect.curriculum.id, shape);
      }
    }
    expect(byId.size).toBeGreaterThan(0);
  });

  it('gives every curriculum a non-empty id', () => {
    for (const grade of GRADE_ORDER) {
      for (const curriculum of curriculumLadderForGrade(grade)) {
        expect(typeof curriculum.id).toBe('string');
        expect(curriculum.id.length).toBeGreaterThan(0);
      }
    }
  });

  it('allows two topics to share a standard code', () => {
    // 1.OA.6 covers add/subtract within 20; the game splits that into
    // fluency-within-10 and regrouping. A code is a label, not a key.
    const codes = curriculumLadderForGrade('1').map((c) => c.standardCode);
    expect(codes).toEqual(['1.OA.6', '1.OA.6']);
  });
});
