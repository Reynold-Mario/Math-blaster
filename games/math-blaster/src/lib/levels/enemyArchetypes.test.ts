import {
	ENEMY_ARCHETYPES,
	enemyArchetype,
	stepMovement,
	clampLane,
	LANE_MIN_PCT,
	LANE_MAX_PCT,
	WEAVE_AMPLITUDE_PCT,
	WEAVE_PERIOD_PCT,
	DIVE_TRIGGER_Y_PCT,
	DIVE_SPEED_MULTIPLIER,
	DIVE_APPROACH_MULTIPLIER,
	type MovementInput
} from './enemyArchetypes';

function move(overrides: Partial<MovementInput> = {}): { y: number; xPct: number } {
	return stepMovement({
		movement: 'straight',
		y: 0,
		anchorXPct: 50,
		wavePhase: 0,
		speed: 10,
		dtSec: 1,
		...overrides
	});
}

describe('archetype registry', () => {
	it('exposes every archetype under its own id', () => {
		for (const [id, archetype] of Object.entries(ENEMY_ARCHETYPES)) {
			expect(archetype.id).toBe(id);
		}
	});

	it('keeps split debris out of the level clear quota', () => {
		// Otherwise a splitter would be three cheap points of progress rather
		// than the complication it's meant to be.
		expect(enemyArchetype('splitter').splitsInto).toBeGreaterThan(0);
		expect(enemyArchetype('spore').countsTowardClear).toBe(false);
		expect(enemyArchetype('splitter').countsTowardClear).toBe(true);
	});

	it('gives every multi-layer archetype a slower fall than the baseline drifter', () => {
		// More questions per enemy only reads as depth if there's time to
		// answer them.
		const baseline = enemyArchetype('drifter').speedMultiplier;
		for (const archetype of Object.values(ENEMY_ARCHETYPES)) {
			if (archetype.layers > 1) expect(archetype.speedMultiplier).toBeLessThan(baseline);
		}
	});

	it('only shields archetypes that also take more than one answer to kill', () => {
		for (const archetype of Object.values(ENEMY_ARCHETYPES)) {
			if (archetype.shielded) expect(archetype.layers).toBeGreaterThan(1);
		}
	});
});

describe('stepMovement', () => {
	describe('straight', () => {
		it('falls at its speed and never leaves its lane', () => {
			const result = move({ movement: 'straight', y: 10, speed: 20, dtSec: 0.5 });
			expect(result.y).toBe(20);
			expect(result.xPct).toBe(50);
		});
	});

	describe('weave', () => {
		it('returns to its anchor after exactly one full period', () => {
			const atStart = move({ movement: 'weave', y: 0, speed: WEAVE_PERIOD_PCT, dtSec: 0 });
			const afterOnePeriod = move({ movement: 'weave', y: 0, speed: WEAVE_PERIOD_PCT, dtSec: 1 });
			expect(afterOnePeriod.xPct).toBeCloseTo(atStart.xPct, 5);
			expect(afterOnePeriod.xPct).toBeCloseTo(50, 5);
		});

		it('swings to its full amplitude a quarter period in', () => {
			const quarter = move({ movement: 'weave', y: 0, speed: WEAVE_PERIOD_PCT / 4, dtSec: 1 });
			expect(quarter.xPct).toBeCloseTo(50 + WEAVE_AMPLITUDE_PCT, 5);
		});

		it('derives x from y rather than integrating, so the path is frame-rate independent', () => {
			const oneBigStep = move({ movement: 'weave', y: 0, speed: 12, dtSec: 1 });
			let stepped = { y: 0, xPct: 50 };
			for (let i = 0; i < 10; i++) {
				stepped = stepMovement({
					movement: 'weave',
					y: stepped.y,
					anchorXPct: 50,
					wavePhase: 0,
					speed: 12,
					dtSec: 0.1
				});
			}
			expect(stepped.y).toBeCloseTo(oneBigStep.y, 5);
			expect(stepped.xPct).toBeCloseTo(oneBigStep.xPct, 5);
		});

		it('stays inside the reachable lanes even when anchored at the edge', () => {
			for (let y = 0; y < 90; y += 3) {
				const result = move({ movement: 'weave', y, anchorXPct: LANE_MAX_PCT, speed: 1, dtSec: 1 });
				expect(result.xPct).toBeLessThanOrEqual(LANE_MAX_PCT);
				expect(result.xPct).toBeGreaterThanOrEqual(LANE_MIN_PCT);
			}
		});

		it('separates enemies released together by their wave phase', () => {
			const lead = move({ movement: 'weave', y: 10, wavePhase: 0, dtSec: 0 });
			const trail = move({ movement: 'weave', y: 10, wavePhase: 0.5, dtSec: 0 });
			expect(lead.xPct).not.toBeCloseTo(trail.xPct, 3);
		});
	});

	describe('dive', () => {
		it('hangs back above the trigger line', () => {
			const result = move({ movement: 'dive', y: DIVE_TRIGGER_Y_PCT - 1, speed: 10, dtSec: 1 });
			expect(result.y).toBeCloseTo(DIVE_TRIGGER_Y_PCT - 1 + 10 * DIVE_APPROACH_MULTIPLIER, 5);
		});

		it('commits and accelerates once past it', () => {
			const result = move({ movement: 'dive', y: DIVE_TRIGGER_Y_PCT, speed: 10, dtSec: 1 });
			expect(result.y).toBeCloseTo(DIVE_TRIGGER_Y_PCT + 10 * DIVE_SPEED_MULTIPLIER, 5);
		});

		it('is genuinely faster after the commit than before it', () => {
			const before = move({ movement: 'dive', y: 0, speed: 10, dtSec: 1 }).y;
			const after =
				move({ movement: 'dive', y: DIVE_TRIGGER_Y_PCT + 5, speed: 10, dtSec: 1 }).y -
				DIVE_TRIGGER_Y_PCT -
				5;
			expect(after).toBeGreaterThan(before);
		});

		it('holds its lane - a diver is a speed threat, not an aiming one', () => {
			expect(move({ movement: 'dive', y: 60, anchorXPct: 30 }).xPct).toBe(30);
		});
	});
});

describe('clampLane', () => {
	it('keeps positions inside the reachable band', () => {
		expect(clampLane(-20)).toBe(LANE_MIN_PCT);
		expect(clampLane(140)).toBe(LANE_MAX_PCT);
		expect(clampLane(50)).toBe(50);
	});
});
