import { generateProblem, generateBossProblem, buildAuthoredProblem } from './problemGenerators';
import type { Curriculum } from './LevelDefinition';
import { integer } from '../math/MathValue';

describe('generateProblem', () => {
  it('throws when the curriculum has no operations', () => {
    const curriculum: Curriculum = { operations: [], numberRange: [1, 10] };
    expect(() => generateProblem(curriculum)).toThrow();
  });

  it('produces an addition problem within the curriculum range', () => {
    const curriculum: Curriculum = { operations: ['+'], numberRange: [1, 5] };
    for (let i = 0; i < 20; i++) {
      const problem = generateProblem(curriculum);
      expect(problem.expression.form).toBe('arithmetic');
      if (problem.expression.form === 'arithmetic') {
        expect(problem.expression.left).toBeGreaterThanOrEqual(1);
        expect(problem.expression.left).toBeLessThanOrEqual(5);
        expect(problem.expression.right).toBeGreaterThanOrEqual(1);
        expect(problem.expression.right).toBeLessThanOrEqual(5);
      }
    }
  });

  it('never produces a negative subtraction result', () => {
    const curriculum: Curriculum = { operations: ['-'], numberRange: [1, 10] };
    for (let i = 0; i < 30; i++) {
      const problem = generateProblem(curriculum);
      expect(problem.answer.kind).toBe('integer');
      expect((problem.answer as { value: number }).value).toBeGreaterThanOrEqual(0);
    }
  });

  it('never produces a division problem with a remainder', () => {
    const curriculum: Curriculum = { operations: ['÷'], numberRange: [2, 9] };
    for (let i = 0; i < 30; i++) {
      const problem = generateProblem(curriculum);
      expect(problem.answer.kind).toBe('integer');
    }
  });
});

describe('generateBossProblem', () => {
  it('throws when the scope is empty', () => {
    expect(() => generateBossProblem([], 0)).toThrow();
  });

  it('draws only from the single curriculum when scope has one entry', () => {
    const curriculum: Curriculum = { operations: ['+'], numberRange: [1, 3] };
    const problem = generateBossProblem([curriculum], 0.5);
    expect(problem.expression.form).toBe('arithmetic');
  });

  it('favors the hardest (last) curriculum as progress approaches 1', () => {
    const easy: Curriculum = { operations: ['+'], numberRange: [1, 3] };
    const hard: Curriculum = { operations: ['×'], numberRange: [1, 3] };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      const problem = generateBossProblem([easy, hard], 1);
      // at progress=1, weights are [1, 2]; a near-1.0 roll should select
      // the hard (later, higher-weighted) curriculum, i.e. multiplication.
      expect(problem.expression.form).toBe('arithmetic');
      if (problem.expression.form === 'arithmetic') {
        expect(problem.expression.operator).toBe('×');
      }
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('clamps progress outside [0, 1] instead of throwing', () => {
    const curriculum: Curriculum = { operations: ['+'], numberRange: [1, 3] };
    expect(() => generateBossProblem([curriculum], -5)).not.toThrow();
    expect(() => generateBossProblem([curriculum], 5)).not.toThrow();
  });
});

describe('buildAuthoredProblem', () => {
  it('builds a well-formed problem from a recipe', () => {
    const problem = buildAuthoredProblem({ operator: '+', left: 2, right: 3 });
    expect(problem.source).toBe('authored');
    expect(problem.answer).toEqual(integer(5));
    expect(problem.displayText).toBe('2 + 3');
  });
});
