import type { Operator, ProblemDefinition } from '../math/ProblemDefinition';
import { arithmeticProblem, authoredArithmeticProblem } from '../math/ProblemDefinition';
import type { Curriculum, AuthoredProblemRecipe } from './LevelDefinition';

function randInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateAddOrSub(op: '+' | '-', curriculum: Curriculum): ProblemDefinition {
	const [lo, hi] = curriculum.numberRange;
	let a = randInt(lo, hi);
	let b = randInt(lo, hi);
	if (op === '-' && a < b) [a, b] = [b, a];
	return arithmeticProblem(op, a, b);
}

// For × and ÷, numberRange is read as "the table being practiced" - the
// other factor is drawn from a fixed 1-10 range regardless of curriculum,
// matching how times tables are normally taught one table at a time.
function generateMultiplication(curriculum: Curriculum): ProblemDefinition {
	const [lo, hi] = curriculum.numberRange;
	const table = randInt(lo, hi);
	const other = randInt(1, 10);
	return Math.random() < 0.5
		? arithmeticProblem('×', table, other)
		: arithmeticProblem('×', other, table);
}

function generateDivision(curriculum: Curriculum): ProblemDefinition {
	// Built as the exact inverse of a multiplication fact so it never
	// produces a remainder, and stays within the learned times-table scope.
	const [lo, hi] = curriculum.numberRange;
	const factor1 = randInt(lo, hi);
	const factor2 = randInt(2, 10);
	return arithmeticProblem('÷', factor1 * factor2, factor2);
}

/** Generates one random problem drawn from a curriculum's operations and
 * number range. Picks an operator at random from those the curriculum
 * allows, rather than assuming any particular combination. */
export function generateProblem(curriculum: Curriculum): ProblemDefinition {
	if (curriculum.operations.length === 0) {
		throw new Error('Curriculum has no operations to generate a problem from.');
	}
	const op = curriculum.operations[randInt(0, curriculum.operations.length - 1)];
	return attribute(build(op, curriculum), curriculum);
}

function build(op: Operator, curriculum: Curriculum): ProblemDefinition {
	switch (op) {
		case '+':
		case '-':
			return generateAddOrSub(op, curriculum);
		case '×':
			return generateMultiplication(curriculum);
		case '÷':
			return generateDivision(curriculum);
	}
}

/**
 * Stamps the topic onto a generated problem. THE ONLY PLACE this happens,
 * which is what makes `generateBossProblem` correct for free: it picks a
 * rung of the boss's scope and delegates here, so a boss answer is
 * attributed to the rung it actually came from rather than to the fight.
 */
function attribute(problem: ProblemDefinition, curriculum: Curriculum): ProblemDefinition {
	return { ...problem, topicId: curriculum.id, standardCode: curriculum.standardCode };
}

/**
 * Picks a problem for a boss fight from its cumulative scope. `progress`
 * (0-1, how far into the fight) smoothly biases selection toward the
 * harder end of `scope` - assumed ordered easiest-to-hardest - without
 * ever fully excluding earlier material, so the sequence escalates but
 * stays "still in-scope" rather than testing only the newest curriculum.
 *
 * `openingBias` (0-1) is where the fight STARTS on that same slope, so a
 * deep boss is already leaning hard at its first problem instead of
 * opening as evenly as wave 5's. It composes with progress rather than
 * replacing it: bias sets the floor, progress covers the rest of the way.
 * 0 is the original behaviour.
 */
export function generateBossProblem(
	scope: Curriculum[],
	progress: number,
	openingBias = 0
): ProblemDefinition {
	if (scope.length === 0) {
		throw new Error('Boss scope is empty - nothing to generate a problem from.');
	}
	const bias = Math.max(0, Math.min(1, openingBias));
	const clamped = Math.max(0, Math.min(1, progress));
	const lean = bias + (1 - bias) * clamped;
	const weights = scope.map((_, i) => 1 + lean * i);
	const total = weights.reduce((sum, w) => sum + w, 0);
	let roll = Math.random() * total;
	let chosen = scope[scope.length - 1];
	for (let i = 0; i < scope.length; i++) {
		roll -= weights[i];
		if (roll <= 0) {
			chosen = scope[i];
			break;
		}
	}
	return generateProblem(chosen);
}

/**
 * Turns an authored recipe - e.g. a boss's finale - into a real
 * ProblemDefinition, minting its runtime id only when actually needed.
 *
 * Deliberately carries NO topicId. An authored problem was written by
 * hand, not drawn from a curriculum, so there is no topic it belongs to -
 * and picking a plausible-looking one would put a fiction into the
 * mastery record. A recorder skips what it cannot attribute.
 */
export function buildAuthoredProblem(recipe: AuthoredProblemRecipe): ProblemDefinition {
	return authoredArithmeticProblem(recipe.operator, recipe.left, recipe.right);
}
