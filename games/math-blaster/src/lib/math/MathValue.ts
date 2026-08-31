/**
 * Canonical representation of a mathematical value — separate from how a
 * problem is displayed as text, and separate from how a player's raw input
 * is typed. Today only integers are ever produced by the game, but the
 * shape is designed so fractions, decimals, and simple algebraic values can
 * be added later without changing the evaluator's public contract.
 */
export type MathValue =
	| { kind: 'integer'; value: number }
	| { kind: 'decimal'; value: number; decimals: number }
	| { kind: 'fraction'; numerator: number; denominator: number };

export function integer(value: number): MathValue {
	return { kind: 'integer', value };
}

export function decimal(value: number, decimals: number): MathValue {
	return { kind: 'decimal', value, decimals };
}

export function fraction(numerator: number, denominator: number): MathValue {
	return { kind: 'fraction', numerator, denominator };
}

/** Numeric value for distance/closeness comparisons, regardless of kind. */
export function toNumber(v: MathValue): number {
	switch (v.kind) {
		case 'integer':
			return v.value;
		case 'decimal':
			return v.value;
		case 'fraction':
			return v.denominator === 0 ? NaN : v.numerator / v.denominator;
	}
}

/** True mathematical equality, even across differently-shaped
 * representations - e.g. 1/2 and 0.5, or 2/4 and 1/2. This is what the
 * "equivalent" answer tier means, as distinct from an exact match. */
export function equivalent(a: MathValue, b: MathValue): boolean {
	const na = toNumber(a);
	const nb = toNumber(b);
	if (Number.isNaN(na) || Number.isNaN(nb)) return false;
	return Math.abs(na - nb) < 1e-9;
}

/** Exact structural match: same kind AND same displayed form, not just the
 * same numeric value. 1/2 does not exactMatch 0.5 - use `equivalent` for
 * that. This is what today's integer-only gameplay actually checks. */
export function exactMatch(a: MathValue, b: MathValue): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'integer' && b.kind === 'integer') return a.value === b.value;
	if (a.kind === 'decimal' && b.kind === 'decimal') {
		return a.value === b.value && a.decimals === b.decimals;
	}
	if (a.kind === 'fraction' && b.kind === 'fraction') {
		return a.numerator === b.numerator && a.denominator === b.denominator;
	}
	return false;
}

/** Digit-by-digit comparison of two integers, aligned by place value
 * (ones, tens, ...) rather than by string position, so a shorter guess
 * still compares correctly against a longer answer. `matches` is ordered
 * left-to-right, the same order and length as `answerDigits`. Returns
 * null for non-integer kinds until partial-matching is designed for them. */
export interface DigitMatch {
	guessDigits: string;
	answerDigits: string;
	matches: boolean[];
}

export function digitMatch(guess: MathValue, answer: MathValue): DigitMatch | null {
	if (guess.kind !== 'integer' || answer.kind !== 'integer') return null;
	const g = Math.abs(guess.value).toString();
	const a = Math.abs(answer.value).toString();
	const matches: boolean[] = [];
	for (let i = 0; i < a.length; i++) {
		const ai = a.length - 1 - i;
		const gi = g.length - 1 - i;
		matches.unshift(gi >= 0 && g[gi] === a[ai]);
	}
	return { guessDigits: g, answerDigits: a, matches };
}
