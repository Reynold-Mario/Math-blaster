import type { EnemyInstance, PlayerState, BossState } from './runtime/RuntimeState';

/** How close (in xPct) the player must be to something to be considered
 * lined up with it. A placeholder-tunable value, not final balance. */
export const ALIGNMENT_TOLERANCE_PCT = 7;

/** A weak point is a precision shot, so it answers to a tighter tolerance
 * than a body does - that difference is the whole reason the mechanic
 * makes positioning matter. */
export const WEAK_POINT_TOLERANCE_PCT = 4;

export type Target =
	| { kind: 'enemy'; enemy: EnemyInstance }
	| { kind: 'boss' }
	| { kind: 'boss-weak-point' }
	| { kind: 'none' };

function isAligned(a: number, b: number, tolerance = ALIGNMENT_TOLERANCE_PCT): boolean {
	return Math.abs(a - b) <= tolerance;
}

/** Absolute screen position of the boss's weak point. Exported because
 * the renderer has to draw the marker in exactly the spot the targeting
 * rules test against - deriving it twice is how they'd drift apart. */
export function weakPointXPct(boss: BossState): number {
	return Math.max(0, Math.min(100, boss.xPct + boss.weakPointOffsetPct));
}

/**
 * What the player is currently lined up to hit, purely from horizontal
 * position - the single source of truth both the canvas reticle and the
 * fire-resolution logic must agree on, so they never disagree about who
 * gets hit. A falling enemy aligned with the player takes priority over
 * the boss, since it's the more urgent threat (it's actively descending
 * toward impact); the boss is only targeted when nothing else is
 * aligned. Among multiple aligned enemies (stacked in the same lane),
 * the one closest to the impact line wins.
 *
 * While a boss is shielded its weak point outranks its body: standing
 * where both are in range should mean aiming at the part that can
 * actually be hurt, not the part that can't.
 */
export function resolveTarget(
	player: PlayerState,
	enemies: EnemyInstance[],
	boss: BossState | null
): Target {
	const alignedEnemies = enemies.filter((e) => isAligned(player.xPct, e.xPct));
	if (alignedEnemies.length > 0) {
		const closest = alignedEnemies.reduce((a, b) => (a.y > b.y ? a : b));
		return { kind: 'enemy', enemy: closest };
	}
	if (boss) {
		if (!boss.vulnerable && isAligned(player.xPct, weakPointXPct(boss), WEAK_POINT_TOLERANCE_PCT)) {
			return { kind: 'boss-weak-point' };
		}
		if (isAligned(player.xPct, boss.xPct)) {
			return { kind: 'boss' };
		}
	}
	return { kind: 'none' };
}
