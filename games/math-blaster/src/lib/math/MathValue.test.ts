import {
	integer,
	decimal,
	fraction,
	toNumber,
	equivalent,
	exactMatch,
	digitMatch
} from './MathValue';

describe('toNumber', () => {
	it('returns the raw value for integers and decimals', () => {
		expect(toNumber(integer(7))).toBe(7);
		expect(toNumber(decimal(1.5, 1))).toBe(1.5);
	});

	it('divides numerator by denominator for fractions', () => {
		expect(toNumber(fraction(1, 2))).toBe(0.5);
	});

	it('returns NaN for a zero-denominator fraction', () => {
		expect(toNumber(fraction(1, 0))).toBeNaN();
	});
});

describe('equivalent', () => {
	it('treats a fraction and its decimal equal as equivalent', () => {
		expect(equivalent(fraction(1, 2), decimal(0.5, 1))).toBe(true);
	});

	it('treats two fractions that reduce to the same value as equivalent', () => {
		expect(equivalent(fraction(2, 4), fraction(1, 2))).toBe(true);
	});

	it('is false when the numeric values differ', () => {
		expect(equivalent(integer(2), integer(3))).toBe(false);
	});

	it('is false when either side is NaN (e.g. a zero-denominator fraction)', () => {
		expect(equivalent(fraction(1, 0), integer(1))).toBe(false);
	});
});

describe('exactMatch', () => {
	it('matches identical integers', () => {
		expect(exactMatch(integer(4), integer(4))).toBe(true);
	});

	it('does not match a fraction against its numerically-equal decimal', () => {
		expect(exactMatch(fraction(1, 2), decimal(0.5, 1))).toBe(false);
	});

	it('requires the same decimals precision for decimals', () => {
		expect(exactMatch(decimal(1.5, 1), decimal(1.5, 2))).toBe(false);
	});

	it('requires identical numerator and denominator for fractions', () => {
		expect(exactMatch(fraction(2, 4), fraction(1, 2))).toBe(false);
		expect(exactMatch(fraction(1, 2), fraction(1, 2))).toBe(true);
	});
});

describe('digitMatch', () => {
	it('returns null for non-integer kinds', () => {
		expect(digitMatch(decimal(1.5, 1), integer(2))).toBeNull();
		expect(digitMatch(integer(2), fraction(1, 2))).toBeNull();
	});

	it('scores zero matching digits for 24 vs 42 despite sharing digits', () => {
		const result = digitMatch(integer(24), integer(42));
		expect(result).not.toBeNull();
		expect(result!.matches).toEqual([false, false]);
	});

	it('aligns by place value even when the guess is shorter than the answer', () => {
		const result = digitMatch(integer(4), integer(24));
		expect(result).not.toBeNull();
		// answer "24": tens digit '2' has no guess digit to compare -> false,
		// ones digit '4' matches the guess's only digit -> true.
		expect(result!.matches).toEqual([false, true]);
	});

	it('matches every place when guess equals answer', () => {
		const result = digitMatch(integer(123), integer(123));
		expect(result!.matches).toEqual([true, true, true]);
	});
});
