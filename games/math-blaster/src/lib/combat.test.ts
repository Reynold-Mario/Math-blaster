import { resolveGruntHit, resolveBossAnswer, type GruntTarget } from './combat';
import type { AnswerResult } from './math/evaluator';

function result(verdict: AnswerResult['verdict'], extra: Partial<AnswerResult> = {}): AnswerResult {
	return { verdict, rawInput: '', ...extra };
}

function grunt(overrides: Partial<GruntTarget> = {}): GruntTarget {
	return { layersRemaining: 1, shielded: false, ...overrides };
}

/** A partial result matching `hits` of `total` digit positions. */
function partial(hits: number, total: number): AnswerResult {
	return result('partial', {
		digitMatch: {
			guessDigits: '',
			answerDigits: '9'.repeat(total),
			matches: Array.from({ length: total }, (_, i) => i < hits)
		}
	});
}

describe('resolveGruntHit', () => {
	it('answers the layer and defeats a single-layer enemy on an exact answer', () => {
		const outcome = resolveGruntHit(result('exact'), grunt(), 0);
		expect(outcome.layerBroken).toBe(true);
		expect(outcome.defeated).toBe(true);
		expect(outcome.knockbackPct).toBe(0);
		expect(outcome.missStreak).toBe(0);
	});

	it('knocks back on a close answer instead of answering the layer', () => {
		const outcome = resolveGruntHit(result('close'), grunt(), 0);
		expect(outcome.knockbackPct).toBeGreaterThan(0);
		expect(outcome.layerBroken).toBe(false);
		expect(outcome.defeated).toBe(false);
	});

	it('scales partial knockback by the fraction of matching digits', () => {
		const none = resolveGruntHit(partial(0, 2), grunt(), 0).knockbackPct;
		const half = resolveGruntHit(partial(1, 2), grunt(), 0).knockbackPct;
		const all = resolveGruntHit(partial(2, 2), grunt(), 0).knockbackPct;
		expect(none).toBe(0);
		expect(half).toBeGreaterThan(none);
		expect(all).toBeGreaterThan(half);
	});

	// The whole point of the two ceilings: however many digits a partial
	// answer matched, being *close* is still worth more than being partly
	// right, so a player is never rewarded for guessing digits over
	// reasoning toward the answer.
	it('always rewards a close answer more than any partial one', () => {
		const close = resolveGruntHit(result('close'), grunt(), 0).knockbackPct;
		for (let total = 1; total <= 4; total++) {
			for (let hits = 0; hits <= total; hits++) {
				expect(resolveGruntHit(partial(hits, total), grunt(), 0).knockbackPct).toBeLessThan(close);
			}
		}
	});

	it('does nothing at all on incorrect or invalid', () => {
		for (const verdict of ['incorrect', 'invalid'] as const) {
			const outcome = resolveGruntHit(result(verdict), grunt(), 0);
			expect(outcome.knockbackPct).toBe(0);
			expect(outcome.layerBroken).toBe(false);
			expect(outcome.defeated).toBe(false);
		}
	});

	describe('layers', () => {
		it('answers a layer without defeating a multi-layer enemy', () => {
			const outcome = resolveGruntHit(result('exact'), grunt({ layersRemaining: 2 }), 0);
			expect(outcome.layerBroken).toBe(true);
			expect(outcome.defeated).toBe(false);
		});

		it('defeats a multi-layer enemy once it is down to its last layer', () => {
			const outcome = resolveGruntHit(result('exact'), grunt({ layersRemaining: 1 }), 0);
			expect(outcome.layerBroken).toBe(true);
			expect(outcome.defeated).toBe(true);
		});

		// With no hp to chip away at, close answers can never accumulate into
		// a kill the way half-damage used to - this is the regression guard on
		// health not creeping back in.
		it('never answers a layer through repeated close answers', () => {
			for (let i = 0; i < 10; i++) {
				const outcome = resolveGruntHit(result('close'), grunt({ layersRemaining: 1 }), 0);
				expect(outcome.layerBroken).toBe(false);
				expect(outcome.defeated).toBe(false);
			}
		});
	});

	describe('shields', () => {
		it('blocks everything short of an exact answer, with no knockback', () => {
			const outcome = resolveGruntHit(result('close'), grunt({ shielded: true }), 0);
			expect(outcome.blocked).toBe(true);
			expect(outcome.shieldBroken).toBe(false);
			expect(outcome.knockbackPct).toBe(0);
		});

		it('breaks on an exact answer without also answering a layer that shot', () => {
			const outcome = resolveGruntHit(result('exact'), grunt({ shielded: true }), 0);
			expect(outcome.blocked).toBe(false);
			expect(outcome.shieldBroken).toBe(true);
			expect(outcome.knockbackPct).toBe(0);
			expect(outcome.layerBroken).toBe(false);
			expect(outcome.defeated).toBe(false);
		});

		it('accepts an equivalent answer as readily as an exact one', () => {
			expect(resolveGruntHit(result('equivalent'), grunt({ shielded: true }), 0).shieldBroken).toBe(
				true
			);
		});
	});

	describe('reinforcement', () => {
		let randomSpy: jest.SpyInstance;
		afterEach(() => randomSpy.mockRestore());

		// The rule used to be the other way round: a `close` answer rolled a
		// 50% reinforcement chance and a `partial` 35%, while a single outright
		// wrong answer rolled nothing - so reasoning your way to within one of
		// the answer was punished harder than guessing.
		it.each(['exact', 'equivalent', 'close', 'partial'] as const)(
			'never reinforces on a %s answer, however unlucky the roll',
			(verdict) => {
				randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
				const outcome = resolveGruntHit(result(verdict), grunt(), 0);
				expect(outcome.reinforce).toBe(false);
			}
		);

		it.each(['exact', 'equivalent', 'close', 'partial'] as const)(
			'clears a standing miss streak on a %s answer',
			(verdict) => {
				randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
				// Anything that landed at all says the player is still working at
				// the problem, which is the only thing reinforcements care about.
				expect(resolveGruntHit(result(verdict), grunt(), 4).missStreak).toBe(0);
			}
		);

		it('never punishes a single wrong answer', () => {
			randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
			const outcome = resolveGruntHit(result('incorrect'), grunt(), 0);
			expect(outcome.reinforce).toBe(false);
			expect(outcome.missStreak).toBe(1);
		});

		it('raises the chance with every further consecutive miss', () => {
			// Sampled just under each step, so a roll that would have failed at
			// one streak length succeeds at the next.
			randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.58);
			// streak 2 -> 35%: too low to fire.
			expect(resolveGruntHit(result('incorrect'), grunt(), 1).reinforce).toBe(false);
			// streak 3 -> 60%: now it does.
			expect(resolveGruntHit(result('incorrect'), grunt(), 2).reinforce).toBe(true);
		});

		it('becomes a certainty for a player who has stopped answering', () => {
			randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999);
			expect(resolveGruntHit(result('invalid'), grunt(), 8).reinforce).toBe(true);
		});

		it('keeps building the streak after a reinforcement fires', () => {
			// Resetting here would sawtooth the pressure back to zero every time
			// it landed, which is the opposite of "the less the player engages,
			// the more arrives". Only engaging clears it.
			randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
			const outcome = resolveGruntHit(result('incorrect'), grunt(), 3);
			expect(outcome.reinforce).toBe(true);
			expect(outcome.missStreak).toBe(4);
		});
	});
});

describe('resolveBossAnswer', () => {
	const vulnerable = { comboRequired: 5, vulnerable: true };
	const shielded = { comboRequired: 5, vulnerable: false };

	let randomSpy: jest.SpyInstance;
	beforeEach(() => {
		// Pin the reinforcement rolls so they never fire - this suite is about
		// timer cuts and combos, not reinforcements.
		randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
	});
	afterEach(() => randomSpy.mockRestore());

	describe('against a vulnerable body', () => {
		it('cuts the survive clock on an exact answer and extends the combo', () => {
			const outcome = resolveBossAnswer(result('exact'), vulnerable, 0, 0, false);
			expect(outcome.surviveCutMs).toBe(2600);
			expect(outcome.combo).toBe(1);
			expect(outcome.blocked).toBe(false);
			expect(outcome.masteryAchieved).toBe(false);
		});

		it('cuts less on a close answer, and still makes real progress', () => {
			const outcome = resolveBossAnswer(result('close'), vulnerable, 0, 0, false);
			expect(outcome.surviveCutMs).toBe(900);
			expect(outcome.surviveCutMs).toBeGreaterThan(0);
		});

		it('scales a partial cut by the fraction of matching digits', () => {
			const digitMatch = { guessDigits: '4', answerDigits: '24', matches: [false, true] };
			const outcome = resolveBossAnswer(result('partial', { digitMatch }), vulnerable, 0, 0, false);
			expect(outcome.surviveCutMs).toBe(800); // round(1600 * 0.5)
		});

		it('breaks a standing combo on anything less than exact', () => {
			const outcome = resolveBossAnswer(result('close'), vulnerable, 3, 0, false);
			expect(outcome.combo).toBe(0);
			expect(outcome.comboBroken).toBe(true);
		});

		it('does not report a broken combo when there was none to break', () => {
			expect(resolveBossAnswer(result('incorrect'), vulnerable, 0, 0, false).comboBroken).toBe(
				false
			);
		});

		it('ends the fight once the combo reaches the required length', () => {
			const outcome = resolveBossAnswer(result('exact'), vulnerable, 4, 0, false);
			expect(outcome.combo).toBe(5);
			expect(outcome.masteryAchieved).toBe(true);
		});

		it('counts an equivalent answer toward the combo, not just an exact one', () => {
			expect(resolveBossAnswer(result('equivalent'), vulnerable, 2, 0, false).combo).toBe(3);
		});
	});

	describe('against a shielded boss', () => {
		it('blocks a body shot outright', () => {
			const outcome = resolveBossAnswer(result('exact'), shielded, 2, 0, false);
			expect(outcome.blocked).toBe(true);
			expect(outcome.surviveCutMs).toBe(0);
			expect(outcome.shieldBroken).toBe(false);
		});

		it('leaves a standing combo intact when a shot is blocked', () => {
			// Firing into a shield is a shot that never reached the boss - it
			// shouldn't cost a run the player built up.
			const outcome = resolveBossAnswer(result('incorrect'), shielded, 3, 0, false);
			expect(outcome.combo).toBe(3);
			expect(outcome.comboBroken).toBe(false);
		});

		it('blocks a non-exact answer even when it lands on the weak point', () => {
			const outcome = resolveBossAnswer(result('close'), shielded, 0, 0, true);
			expect(outcome.blocked).toBe(true);
			expect(outcome.shieldBroken).toBe(false);
		});

		it('cracks the weak point on an exact answer, cutting more than a body hit would', () => {
			const outcome = resolveBossAnswer(result('exact'), shielded, 0, 0, true);
			expect(outcome.shieldBroken).toBe(true);
			expect(outcome.blocked).toBe(false);
			expect(outcome.surviveCutMs).toBe(4200);
			expect(outcome.surviveCutMs).toBeGreaterThan(
				resolveBossAnswer(result('exact'), vulnerable, 0, 0, false).surviveCutMs
			);
		});

		it('advances the combo on a weak point hit, and can end the fight with one', () => {
			const outcome = resolveBossAnswer(result('exact'), shielded, 4, 0, true);
			expect(outcome.combo).toBe(5);
			expect(outcome.masteryAchieved).toBe(true);
		});
	});
});
