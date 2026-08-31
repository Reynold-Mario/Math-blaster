import type { LearnerIdentitySource } from './LearnerIdentity';
import { createVtIdentity } from './vtIdentity';

/**
 * Whether this build is wired to the platform, and the source if it is.
 *
 * The same shape as `supabaseClient.ts`, for the same two reasons.
 *
 *  1. **This is the only file that reads `import.meta.env`.** `tsconfig.jest.json`
 *     compiles to commonjs, where `import.meta` is a compile error, so anything
 *     a `.test.ts` can reach must not touch it. Keeping the read here is what
 *     lets `vtIdentity.ts` be tested at all.
 *  2. **The guard is duplicated rather than shared, and must stay in the same
 *     function body as the thing it guards.** Vite inlines `import.meta.env.*`
 *     as literals and Rollup folds constants within a body but not across a
 *     function boundary. With no base configured, the check below folds to an
 *     unconditional `return null`, the `createVtIdentity` call becomes dead, and
 *     `vtIdentity.ts` drops out of the bundle. Extracting the check into a
 *     shared helper would ship it on every build.
 *
 * `VITE_VT_IDENTITY_BASE` is a PATH (`/learner`), never an origin - see
 * `vtIdentity.ts` for why a cross-origin request cannot work. One variable that
 * is simultaneously the feature gate and the path, so moving the mount point is
 * configuration rather than code.
 */

/** `Game.svelte` decides at construction whether the store gets an identity
 * source at all, and it cannot await. Folds to `return false` when unset. */
export function isVtIdentityConfigured(): boolean {
	const base = import.meta.env.VITE_VT_IDENTITY_BASE;
	return typeof base === 'string' && base !== '';
}

export function createConfiguredVtIdentity(
	onError?: (where: string, error: unknown) => void
): LearnerIdentitySource | null {
	const base = import.meta.env.VITE_VT_IDENTITY_BASE;
	if (typeof base !== 'string' || base === '') return null;
	return createVtIdentity({ base, onError });
}
