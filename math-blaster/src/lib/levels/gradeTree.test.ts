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
