import {
	resolveTarget,
	weakPointXPct,
	ALIGNMENT_TOLERANCE_PCT,
	WEAK_POINT_TOLERANCE_PCT
} from './targeting';
import { arithmeticProblem } from './math/ProblemDefinition';
import type { EnemyInstance, PlayerState, BossState } from './runtime/RuntimeState';

function makePlayer(xPct: number): PlayerState {
	return {
		xPct,
		movingLeft: false,
		movingRight: false,
		inputBuffer: '',
		fireCooldownRemainingMs: 0
	};
}

function makeEnemy(
	overrides: Partial<EnemyInstance> & { uid: number; xPct: number; y: number }
): EnemyInstance {
	return {
		archetype: 'drifter',
		kind: 'drone',
		mini: false,
		problem: arithmeticProblem('+', 1, 1),
		layersRemaining: 1,
		layersTotal: 1,
		shielded: false,
		anchorXPct: overrides.xPct,
		wavePhase: 0,
		speed: 1,
		frozen: false,
		burnUntilMs: 0,
		...overrides
	};
}

function makeBoss(overrides: Partial<BossState> = {}): BossState {
	return {
		name: 'Test Boss',
		sprite: 'dreadnought',
		surviveRemainingMs: 20000,
		surviveTotalMs: 20000,
		elapsedMs: 0,
		minFightMs: 30000,
		combo: 0,
		comboRequired: 5,
		bestCombo: 0,
		phaseIndex: 0,
		vulnerable: true,
		stateRemainingMs: 0,
		weakPointOffsetPct: 0,
		xPct: 50,
		driftDirection: 1,
		driftSpeed: 0,
		problem: arithmeticProblem('+', 1, 1),
		progress: 0,
		missStreak: 0,
		inFinale: false,
		defeatedBy: null,
		...overrides
	};
}

describe('resolveTarget', () => {
	it('targets nothing when no enemies or boss are present', () => {
		expect(resolveTarget(makePlayer(50), [], null)).toEqual({ kind: 'none' });
	});

	it('targets an aligned enemy over an aligned boss', () => {
		const enemy = makeEnemy({ uid: 1, xPct: 50, y: 10 });
		const target = resolveTarget(makePlayer(50), [enemy], makeBoss({ xPct: 50 }));
		expect(target).toEqual({ kind: 'enemy', enemy });
	});

	it('falls back to the boss only when nothing else is aligned', () => {
		const enemy = makeEnemy({ uid: 1, xPct: 90, y: 10 });
		const target = resolveTarget(makePlayer(50), [enemy], makeBoss({ xPct: 50 }));
		expect(target).toEqual({ kind: 'boss' });
	});

	it('picks the aligned enemy closest to the impact line among several stacked in the same lane', () => {
		const near = makeEnemy({ uid: 1, xPct: 50, y: 90 });
		const far = makeEnemy({ uid: 2, xPct: 50, y: 10 });
		expect(resolveTarget(makePlayer(50), [far, near], null)).toEqual({
			kind: 'enemy',
			enemy: near
		});
	});

	it('treats positions within tolerance as aligned', () => {
		const enemy = makeEnemy({ uid: 1, xPct: 50 + ALIGNMENT_TOLERANCE_PCT, y: 10 });
		expect(resolveTarget(makePlayer(50), [enemy], null)).toEqual({ kind: 'enemy', enemy });
	});

	it('treats positions just past tolerance as not aligned', () => {
		const enemy = makeEnemy({ uid: 1, xPct: 50 + ALIGNMENT_TOLERANCE_PCT + 1, y: 10 });
		expect(resolveTarget(makePlayer(50), [enemy], null)).toEqual({ kind: 'none' });
	});

	describe('boss weak point', () => {
		it('is not offered while the boss is vulnerable, even standing right on it', () => {
			// Same position as the "outranks the body" case below - the only
			// difference is the shield, which is the whole point.
			const boss = makeBoss({ xPct: 50, vulnerable: true, weakPointOffsetPct: 5 });
			expect(resolveTarget(makePlayer(55), [], boss)).toEqual({ kind: 'boss' });
		});

		it('outranks the body when the boss is shielded and both are in range', () => {
			const boss = makeBoss({ xPct: 50, vulnerable: false, weakPointOffsetPct: 5 });
			// 55 is within body tolerance of 50 *and* within weak-point tolerance
			// of 55 - the weak point has to win, or the shot is wasted.
			expect(resolveTarget(makePlayer(55), [], boss)).toEqual({ kind: 'boss-weak-point' });
		});

		it('answers to a tighter tolerance than the body does', () => {
			const boss = makeBoss({ xPct: 50, vulnerable: false, weakPointOffsetPct: 14 });
			const justInside = 64 + WEAK_POINT_TOLERANCE_PCT;
			const justOutside = justInside + 1;
			expect(resolveTarget(makePlayer(justInside), [], boss)).toEqual({ kind: 'boss-weak-point' });
			expect(resolveTarget(makePlayer(justOutside), [], boss)).toEqual({ kind: 'none' });
		});

		it('still lets a shielded boss body be targeted away from the weak point', () => {
			const boss = makeBoss({ xPct: 50, vulnerable: false, weakPointOffsetPct: 14 });
			expect(resolveTarget(makePlayer(50), [], boss)).toEqual({ kind: 'boss' });
		});

		it('yields to an aligned enemy like any other boss target', () => {
			const boss = makeBoss({ xPct: 50, vulnerable: false, weakPointOffsetPct: 10 });
			const enemy = makeEnemy({ uid: 1, xPct: 60, y: 40 });
			expect(resolveTarget(makePlayer(60), [enemy], boss)).toEqual({ kind: 'enemy', enemy });
		});
	});
});

describe('weakPointXPct', () => {
	it('offsets from the boss position', () => {
		expect(weakPointXPct(makeBoss({ xPct: 40, weakPointOffsetPct: 12 }))).toBe(52);
		expect(weakPointXPct(makeBoss({ xPct: 40, weakPointOffsetPct: -12 }))).toBe(28);
	});

	it('stays on screen when the boss is drifting near an edge', () => {
		expect(weakPointXPct(makeBoss({ xPct: 95, weakPointOffsetPct: 16 }))).toBe(100);
		expect(weakPointXPct(makeBoss({ xPct: 5, weakPointOffsetPct: -16 }))).toBe(0);
	});
});
