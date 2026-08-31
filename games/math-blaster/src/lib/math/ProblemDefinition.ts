import type { MathValue } from './MathValue';
import { integer, fraction } from './MathValue';

export type Operator = '+' | '-' | '×' | '÷';

/** A flat two-operand arithmetic expression - today's only expression
 * shape. More forms (multi-term, algebraic) can be added as additional
 * members of this union without changing ProblemDefinition itself. */
export type Expression = { form: 'arithmetic'; operator: Operator; left: number; right: number };

export type ProblemSource = 'generated' | 'authored';

/**
 * The mathematical challenge itself, independent of any enemy, position,
 * animation, or combat consequence. A ProblemDefinition is immutable once
 * created; runtime state (which enemy carries it, where that enemy is,
 * whether it's been answered) lives elsewhere.
 */
export interface ProblemDefinition {
	id: string;
	source: ProblemSource;
	expression: Expression;
	/** What's shown to the player - kept separate from `expression` so the
	 * same underlying math could one day be displayed differently (e.g. a
	 * word problem) without changing how it's evaluated. */
	displayText: string;
	/** The canonical, correct answer as a MathValue, not a bare number, so
	 * the evaluator can support equivalence across fractions/decimals later. */
	answer: MathValue;
	/**
	 * Which topic this problem exercises, copied from the curriculum it was
	 * generated from. Optional because an AUTHORED problem - today, only a
	 * boss finale - is written by hand rather than drawn from a curriculum,
	 * so there is no topic to attribute it to and inventing one would put a
	 * fiction into the mastery record.
	 *
	 * This file stays pure: carrying the id is not the same as knowing what
	 * a topic is, and nothing here reads it.
	 */
	topicId?: string;
	standardCode?: string;
}

export function evaluateExpression(expr: Expression): MathValue {
	switch (expr.form) {
		case 'arithmetic':
			return evaluateArithmetic(expr.operator, expr.left, expr.right);
	}
}

function evaluateArithmetic(op: Operator, left: number, right: number): MathValue {
	switch (op) {
		case '+':
			return integer(left + right);
		case '-':
			return integer(left - right);
		case '×':
			return integer(left * right);
		case '÷':
			// Division stays exact where the generator guarantees it, but the
			// representation is honest either way: a clean quotient is an
			// integer, anything else is a fraction rather than a rounded lie.
			return right !== 0 && left % right === 0 ? integer(left / right) : fraction(left, right);
	}
}

function formatExpression(expr: Expression): string {
	switch (expr.form) {
		case 'arithmetic':
			return `${expr.left} ${expr.operator} ${expr.right}`;
	}
}

let counter = 1;
function nextId(prefix: string): string {
	return `${prefix}-${counter++}`;
}

function buildProblem(expression: Expression, source: ProblemSource): ProblemDefinition {
	return {
		id: nextId(source),
		source,
		expression,
		displayText: formatExpression(expression),
		answer: evaluateExpression(expression)
	};
}

/** Builds a ProblemDefinition from a flat arithmetic expression, deriving
 * both the display text and the canonical answer from the same operands so
 * they can never drift out of sync with each other. */
export function arithmeticProblem(
	operator: Operator,
	left: number,
	right: number,
	source: ProblemSource = 'generated'
): ProblemDefinition {
	return buildProblem({ form: 'arithmetic', operator, left, right }, source);
}

/** Explicitly hand-place a problem for tutorials, special challenges, or a
 * boss's climactic final attack - bypassing the random generator while
 * still producing a well-formed ProblemDefinition. */
export function authoredArithmeticProblem(
	operator: Operator,
	left: number,
	right: number
): ProblemDefinition {
	return arithmeticProblem(operator, left, right, 'authored');
}
