import {
	arithmeticProblem,
	authoredArithmeticProblem,
	evaluateExpression
} from './ProblemDefinition';
import { integer, fraction } from './MathValue';

describe('evaluateExpression', () => {
	it('adds, subtracts, and multiplies as integers', () => {
		expect(evaluateExpression({ form: 'arithmetic', operator: '+', left: 2, right: 3 })).toEqual(
			integer(5)
		);
		expect(evaluateExpression({ form: 'arithmetic', operator: '-', left: 5, right: 3 })).toEqual(
			integer(2)
		);
		expect(evaluateExpression({ form: 'arithmetic', operator: '×', left: 4, right: 3 })).toEqual(
			integer(12)
		);
	});

	it('divides evenly into an integer when the quotient is clean', () => {
		expect(evaluateExpression({ form: 'arithmetic', operator: '÷', left: 6, right: 3 })).toEqual(
			integer(2)
		);
	});

	it('divides unevenly into a fraction rather than rounding', () => {
		expect(evaluateExpression({ form: 'arithmetic', operator: '÷', left: 1, right: 2 })).toEqual(
			fraction(1, 2)
		);
	});
});

describe('arithmeticProblem', () => {
	it('derives displayText and answer from the same operands', () => {
		const problem = arithmeticProblem('+', 2, 3);
		expect(problem.displayText).toBe('2 + 3');
		expect(problem.answer).toEqual(integer(5));
		expect(problem.source).toBe('generated');
	});

	it('assigns unique ids across multiple problems', () => {
		const a = arithmeticProblem('+', 1, 1);
		const b = arithmeticProblem('+', 1, 1);
		expect(a.id).not.toBe(b.id);
	});
});

describe('authoredArithmeticProblem', () => {
	it('marks the problem source as authored', () => {
		const problem = authoredArithmeticProblem('×', 6, 7);
		expect(problem.source).toBe('authored');
		expect(problem.answer).toEqual(integer(42));
	});
});
