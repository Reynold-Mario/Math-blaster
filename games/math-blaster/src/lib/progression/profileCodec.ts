import type { MergeHint, ProgressionCodec } from './ProgressionStore';
import { createEmptyProfile, normalizeProfile, type PlayerProfile } from '../runtime/PlayerProfile';
import type { SkillProgress, SkillSubProgress } from '../skills/SkillTree';

/**
 * Math Blaster's half of the progression seam: what its state is, and how
 * two copies of it reconcile.
 *
 * The merge lives HERE and not in the store because only the game knows
 * which of its fields are records and which are preferences.
 */

/**
 * Unchanged from before the store existed, and it must stay unchanged.
 * The payload shape is additive, so by the game's own versioning rule the
 * `v1` suffix must not move - bumping it would strand every current
 * player's currency and skills. It is also already namespaced, which is
 * what the shared-origin rule requires.
 */
export const PROFILE_STORAGE_KEY = 'pixelMathBlaster.profile.v1';

export const MATH_BLASTER_SLUG = 'math-blaster';

function mergeSkills(
	a: PlayerProfile,
	b: PlayerProfile
): { progress: SkillProgress; subProgress: SkillSubProgress } {
	const progress: SkillProgress = {};
	const subProgress: SkillSubProgress = {};

	const ids = new Set([
		...Object.keys(a.skillProgress),
		...Object.keys(b.skillProgress),
		...Object.keys(a.skillSubProgress),
		...Object.keys(b.skillSubProgress)
	]);

	for (const id of ids) {
		const levelA = a.skillProgress[id] ?? 0;
		const levelB = b.skillProgress[id] ?? 0;
		const level = Math.max(levelA, levelB);
		if (level > 0) progress[id] = level;

		// THE TRAP. `skillSubProgress` resets to 0 the instant a level
		// completes, so a naive `max` across the two sides resurrects a
		// paid-off installment as credit toward the NEXT level - the player
		// gets a free part-payment every time two devices meet.
		//
		// Installments only mean anything relative to the level they are being
		// paid toward. So follow the higher LEVEL and take its installments
		// whatever they are, and compare installments only when the levels
		// agree and they are therefore about the same purchase.
		let paid: number;
		if (levelA > levelB) paid = a.skillSubProgress[id] ?? 0;
		else if (levelB > levelA) paid = b.skillSubProgress[id] ?? 0;
		else paid = Math.max(a.skillSubProgress[id] ?? 0, b.skillSubProgress[id] ?? 0);
		if (paid > 0) subProgress[id] = paid;
	}

	return { progress, subProgress };
}

export function mergeProfiles(a: PlayerProfile, b: PlayerProfile, hint: MergeHint): PlayerProfile {
	const newer = hint === 'a-is-newer' ? a : b;
	const { progress, subProgress } = mergeSkills(a, b);

	// High-water on both totals, and the balance derived from them rather
	// than merged directly. A balance has no meaningful `max`: taking the
	// larger of two balances hands back money the player already spent.
	//
	// This UNDER-counts when both sides earned concurrently - 100 earned
	// here and 50 there merges to 100, not 150. That is the deliberate
	// direction to be wrong in. Currency is client-authoritative and losing
	// some is survivable; minting it on every sync is not.
	const earnedTotal = Math.max(a.earnedTotal, b.earnedTotal);
	const spentTotal = Math.min(Math.max(a.spentTotal, b.spentTotal), earnedTotal);

	return {
		earnedTotal,
		spentTotal,
		currency: Math.max(0, earnedTotal - spentTotal),
		skillProgress: progress,
		skillSubProgress: subProgress,
		// A preference, not a record. There is no "greater" grade - picking
		// the higher one would silently promote a child who had just moved
		// themselves down - so the only sensible rule is last-write-wins.
		selectedGrade: newer.selectedGrade,
		// A record, and the one that matters most: it gates where a run may
		// start. The database enforces this independently with a trigger, so
		// a bug here degrades to lost currency rather than a lost record.
		highestWaveReached: Math.max(a.highestWaveReached, b.highestWaveReached)
	};
}

export const profileCodec: ProgressionCodec<PlayerProfile> = {
	gameSlug: MATH_BLASTER_SLUG,
	stateVersion: 1,
	empty: createEmptyProfile,
	parse: normalizeProfile,
	merge: mergeProfiles,
	furthest: (state) => state.highestWaveReached,
	/**
	 * The platform's grade goes on `selectedGrade`, which is exactly what
	 * `gradeSource.ts` predicted: "the store puts it on the profile, and this
	 * function keeps validating it". So `resolveGrade()` needs no change, and the
	 * unvalidated string is safe here because that is the only reader.
	 */
	applyPlatformGrade: (state, grade) => ({
		...state,
		selectedGrade: grade as PlayerProfile['selectedGrade']
	})
};
