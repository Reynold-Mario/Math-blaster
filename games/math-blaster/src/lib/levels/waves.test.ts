import { buildFormation, type WaveSpec } from './waves';
import { LANE_MIN_PCT, LANE_MAX_PCT } from './enemyArchetypes';

function spec(overrides: Partial<WaveSpec> = {}): WaveSpec {
	return { shape: 'line', archetypes: ['drifter', 'drifter', 'drifter'], gapSec: 3, ...overrides };
}

describe('buildFormation', () => {
	it('produces one slot per archetype entry, in order', () => {
		const slots = buildFormation(spec({ archetypes: ['drifter', 'weaver', 'bulwark'] }), 0);
		expect(slots.map((s) => s.archetype)).toEqual(['drifter', 'weaver', 'bulwark']);
	});

	it('keeps every slot inside the reachable lanes, for every shape', () => {
		const shapes = ['line', 'vee', 'column', 'pincer', 'scatter'] as const;
		for (const shape of shapes) {
			for (let waveIndex = 0; waveIndex < 12; waveIndex++) {
				for (const slot of buildFormation(
					spec({ shape, archetypes: Array(5).fill('drifter') }),
					waveIndex
				)) {
					expect(slot.xPct).toBeGreaterThanOrEqual(LANE_MIN_PCT);
					expect(slot.xPct).toBeLessThanOrEqual(LANE_MAX_PCT);
				}
			}
		}
	});

	it('is deterministic - the same wave index always builds the same formation', () => {
		const shapes = ['line', 'vee', 'column', 'pincer', 'scatter'] as const;
		for (const shape of shapes) {
			const first = buildFormation(spec({ shape }), 4);
			const second = buildFormation(spec({ shape }), 4);
			expect(first).toEqual(second);
		}
	});

	describe('line', () => {
		it('spreads slots evenly and releases them all at the top', () => {
			const slots = buildFormation(spec({ shape: 'line' }), 0);
			expect(slots.every((s) => s.y === 0)).toBe(true);
			const gapA = slots[1].xPct - slots[0].xPct;
			const gapB = slots[2].xPct - slots[1].xPct;
			expect(gapA).toBeCloseTo(gapB, 5);
		});

		it('centres a single-slot wave', () => {
			expect(buildFormation(spec({ shape: 'line', archetypes: ['drifter'] }), 0)[0].xPct).toBe(50);
		});
	});

	describe('vee', () => {
		it('puts the centre slot lowest so the middle of the V arrives first', () => {
			const slots = buildFormation(spec({ shape: 'vee', staggerPct: 10 }), 0);
			expect(slots[1].y).toBeGreaterThan(slots[0].y);
			expect(slots[1].y).toBeGreaterThan(slots[2].y);
		});

		it('mirrors the stagger on either side of the centre', () => {
			const slots = buildFormation(spec({ shape: 'vee', staggerPct: 10 }), 0);
			expect(slots[0].y).toBeCloseTo(slots[2].y, 5);
		});
	});

	describe('column', () => {
		it('stacks every slot in one lane', () => {
			const slots = buildFormation(spec({ shape: 'column' }), 3);
			expect(new Set(slots.map((s) => s.xPct)).size).toBe(1);
		});

		it('staggers them vertically so they arrive in sequence', () => {
			const slots = buildFormation(spec({ shape: 'column', staggerPct: 12 }), 0);
			expect(slots[0].y).toBeGreaterThan(slots[1].y);
			expect(slots[1].y).toBeGreaterThan(slots[2].y);
		});

		it('moves its lane between waves so a looping plan does not drill one spot', () => {
			const lanes = new Set(
				[0, 1, 2, 3].map((i) => buildFormation(spec({ shape: 'column' }), i)[0].xPct)
			);
			expect(lanes.size).toBeGreaterThan(1);
		});
	});

	describe('pincer', () => {
		it('splits to the edges and leaves the middle open', () => {
			const slots = buildFormation(
				spec({ shape: 'pincer', archetypes: ['drifter', 'drifter'] }),
				0
			);
			const [left, right] = slots.map((s) => s.xPct).sort((a, b) => a - b);
			expect(left).toBeLessThan(50);
			expect(right).toBeGreaterThan(50);
			expect(slots.some((s) => Math.abs(s.xPct - 50) < 10)).toBe(false);
		});
	});

	describe('scatter', () => {
		it('varies both lane and depth across slots', () => {
			const slots = buildFormation(
				spec({ shape: 'scatter', archetypes: Array(4).fill('drifter') }),
				2
			);
			expect(new Set(slots.map((s) => s.xPct)).size).toBeGreaterThan(1);
			expect(new Set(slots.map((s) => s.y)).size).toBeGreaterThan(1);
		});
	});
});
