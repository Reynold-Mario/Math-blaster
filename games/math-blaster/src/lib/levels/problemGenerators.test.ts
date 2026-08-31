import { generateProblem, generateBossProblem, buildAuthoredProblem } from './problemGenerators';
import type { Curriculum } from './LevelDefinition';
import { integer } from '../math/MathValue';

describe('generateProblem', () => {
	it('throws when the curriculum has no operations', () => {
		const curriculum: Curriculum = { id: 'fixture-1', operations: [], numberRange: [1, 10] };
		expect(() => generateProblem(curriculum)).toThrow();
	});

	it('produces an addition problem within the curriculum range', () => {
		const curriculum: Curriculum = { id: 'fixture-2', operations: ['+'], numberRange: [1, 5] };
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
		const curriculum: Curriculum = { id: 'fixture-3', operations: ['-'], numberRange: [1, 10] };
		for (let i = 0; i < 30; i++) {
			const problem = generateProblem(curriculum);
			expect(problem.answer.kind).toBe('integer');
			expect((problem.answer as { value: number }).value).toBeGreaterThanOrEqual(0);
		}
	});

	it('never produces a division problem with a remainder', () => {
		const curriculum: Curriculum = { id: 'fixture-4', operations: ['÷'], numberRange: [2, 9] };
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
		const curriculum: Curriculum = { id: 'fixture-5', operations: ['+'], numberRange: [1, 3] };
		const problem = generateBossProblem([curriculum], 0.5);
		expect(problem.expression.form).toBe('arithmetic');
	});

	it('favors the hardest (last) curriculum as progress approaches 1', () => {
		const easy: Curriculum = { id: 'fixture-6', operations: ['+'], numberRange: [1, 3] };
		const hard: Curriculum = { id: 'fixture-7', operations: ['×'], numberRange: [1, 3] };
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
		const curriculum: Curriculum = { id: 'fixture-8', operations: ['+'], numberRange: [1, 3] };
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

describe('attributing a problem to its topic', () => {
	const g1 = {
		id: 'g1-add-sub-10',
		standardCode: '1.OA.6',
		operations: ['+', '-'] as const,
		numberRange: [1, 10] as [number, number]
	};
	const noCode = {
		id: 'g2-mult-foundation',
		operations: ['×'] as const,
		numberRange: [2, 3] as [number, number]
	};

	it('stamps the topic and the standard code onto every generated problem', () => {
		for (let i = 0; i < 40; i++) {
			const p = generateProblem({ ...g1, operations: [...g1.operations] });
			expect(p.topicId).toBe('g1-add-sub-10');
			expect(p.standardCode).toBe('1.OA.6');
		}
	});

	it('still records a topic when the curriculum has no standard code', () => {
		// The CCSS mapping is optional and always will be; the internal id
		// is the join key and must always be there.
		const p = generateProblem({ ...noCode, operations: [...noCode.operations] });
		expect(p.topicId).toBe('g2-mult-foundation');
		expect(p.standardCode).toBeUndefined();
	});

	it('attributes a boss problem to the scope rung it came from, not to the fight', () => {
		const scope = [
			{ ...g1, operations: [...g1.operations] },
			{ ...noCode, operations: [...noCode.operations] }
		];
		const seen = new Set<string | undefined>();
		for (let i = 0; i < 80; i++) seen.add(generateBossProblem(scope, Math.random()).topicId);
		// Both rungs get used, and every problem names one of them.
		expect([...seen].sort()).toEqual(['g1-add-sub-10', 'g2-mult-foundation']);
	});

	it('leaves an authored problem unattributed', () => {
		// A boss finale is written by hand, not drawn from a curriculum.
		// Inventing a topic for it would put a fiction into the record.
		const p = buildAuthoredProblem({ operator: '+', left: 2, right: 3 });
		expect(p.topicId).toBeUndefined();
		expect(p.standardCode).toBeUndefined();
	});
});
