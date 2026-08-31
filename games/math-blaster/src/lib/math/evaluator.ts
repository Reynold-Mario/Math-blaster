import type { MathValue, DigitMatch } from './MathValue';
import {
	integer,
	decimal,
	fraction,
	toNumber,
	exactMatch,
	equivalent,
	digitMatch
} from './MathValue';
import type { ProblemDefinition } from './ProblemDefinition';

export type AnswerVerdict = 'exact' | 'equivalent' | 'close' | 'partial' | 'incorrect' | 'invalid';

/**
 * What the player's submitted answer mathematically means. Carries enough
 * information for the combat system to decide consequences (damage,
 * reinforcement, the "distinct visual indication" for partial credit)
 * without combat needing to re-derive any of it.
 */
export interface AnswerResult {
	verdict: AnswerVerdict;
	rawInput: string;
	/** The parsed value, absent only when verdict is 'invalid'. */
	guess?: MathValue;
	/** Numeric distance from the correct answer; 0 for exact/equivalent. */
	distance?: number;
	/** Present only for 'partial' - place-value digit alignment, for
	 * rendering which digits were right. */
	digitMatch?: DigitMatch;
}

const INTEGER_RE = /^-?\d+$/;
const DECIMAL_RE = /^-?\d+\.\d+$/;
const FRACTION_RE = /^-?\d+\/\d+$/;

/** Parses raw player input into a MathValue. Returns null when the text
 * isn't a well-formed number in any supported form - the source of the
 * 'invalid' verdict. Deliberately permissive about form (decimals,
 * fractions) even though today's keypad only ever sends plain digits, so
 * future input methods don't require evaluator changes. */
export function parseInput(raw: string): MathValue | null {
	const s = raw.trim();
	if (!s) return null;
	if (INTEGER_RE.test(s)) return integer(parseInt(s, 10));
	if (DECIMAL_RE.test(s)) {
		const decimals = s.split('.')[1].length;
		return decimal(parseFloat(s), decimals);
	}
	if (FRACTION_RE.test(s)) {
		const [n, d] = s.split('/').map((p) => parseInt(p, 10));
		if (d === 0) return null;
		return fraction(n, d);
	}
	return null;
}

/** How far a guess may be from the answer and still count as "close".
 * Scales gently with the size of the answer, but stays small so it can't
 * be gamed by always guessing a round number. */
export function closeTolerance(answerValue: number): number {
	return Math.max(1, Math.min(4, Math.round(Math.abs(answerValue) * 0.12)));
}

/**
 * Classifies a player's raw input against a problem's canonical answer.
 * Purely a judgement of mathematical correctness - it has no opinion on
 * damage, reinforcements, or scoring; that's the combat system's job.
 */
export function evaluateAnswer(rawInput: string, problem: ProblemDefinition): AnswerResult {
	const guess = parseInput(rawInput);
	if (!guess) {
		return { verdict: 'invalid', rawInput };
	}

	if (exactMatch(guess, problem.answer)) {
		return { verdict: 'exact', rawInput, guess, distance: 0 };
	}

	if (equivalent(guess, problem.answer)) {
		return { verdict: 'equivalent', rawInput, guess, distance: 0 };
	}

	const distance = Math.abs(toNumber(guess) - toNumber(problem.answer));

	if (!Number.isNaN(distance) && distance <= closeTolerance(toNumber(problem.answer))) {
		return { verdict: 'close', rawInput, guess, distance };
	}

	const digits = digitMatch(guess, problem.answer);
	if (digits && digits.matches.some(Boolean)) {
		return { verdict: 'partial', rawInput, guess, distance, digitMatch: digits };
	}

	return { verdict: 'incorrect', rawInput, guess, distance };
}
