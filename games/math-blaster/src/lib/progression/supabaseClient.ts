import type { SupabaseClient } from '@supabase/supabase-js';
import type { RemoteProgression } from './RemoteProgression';
import { createSupabaseRemote } from './supabaseRemote';

/**
 * Reading the credentials, and loading the client only if there are any.
 *
 * `import type` above is erased, so the ONLY runtime reference to
 * `@supabase/supabase-js` in the codebase is the `await import(...)` inside
 * `getSupabaseClient`. Three properties depend on exactly where things live in
 * this file, and all three are easy to break by tidying it:
 *
 *  1. **No credentials, no package.** Vite inlines `import.meta.env.*` as
 *     literals, so the guard below folds to an unconditional `throw` and the
 *     `import()` after it is dead code. The chunk is never emitted.
 *  2. **THE GUARD MUST SIT IN THE SAME FUNCTION BODY AS THE `import()`.**
 *     Rollup folds constants within a body; it does not propagate them across
 *     a function boundary. An earlier version put the check in
 *     `readSupabaseConfig()` and the import in `getSupabaseClient()`, and the
 *     208 kB chunk was emitted on every build even with no credentials -
 *     unreachable at runtime, but shipped. That is why the guard is duplicated
 *     between here and `isSupabaseConfigured()` rather than shared.
 *  3. **With credentials it is a side chunk, not the main bundle**, so the game
 *     is playable while it loads. Measured: main bundle 127.84 kB / 45.40 kB
 *     gzip either way, against 335.19 kB / 98.70 kB when it was a static
 *     import.
 */

/**
 * Whether this build has credentials, as a synchronous answer.
 *
 * `Game.svelte` needs to decide at construction whether the store gets a remote
 * at all, and it cannot await. Folds to `return false` with no credentials.
 * Deliberately duplicates the guard in `getSupabaseClient` - see note 2 above.
 */
export function isSupabaseConfigured(): boolean {
	const url = import.meta.env.VITE_SUPABASE_URL;
	const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
	return (
		typeof url === 'string' &&
		url !== '' &&
		typeof publishableKey === 'string' &&
		publishableKey !== ''
	);
}

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * The one client instance, shared by the progression store and the dev console.
 *
 * Sharing matters: two clients would hold two independent in-memory auth
 * states, so signing in through one would leave the other believing it was
 * still signed out until a reload happened to align them through storage.
 *
 * Rejects rather than returning null when unconfigured. The store maps a thrown
 * error to `onError` plus a retry, whereas a null would read as "signed out"
 * and stop it retrying - and on this path there is nothing to retry toward
 * anyway, because the branch is unreachable in such a build.
 */
export function getSupabaseClient(): Promise<SupabaseClient> {
	if (clientPromise === null) {
		clientPromise = (async () => {
			const url = import.meta.env.VITE_SUPABASE_URL;
			const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
			if (
				typeof url !== 'string' ||
				url === '' ||
				typeof publishableKey !== 'string' ||
				publishableKey === ''
			) {
				// Folds to an unconditional throw with no credentials, which is what
				// makes the import below dead code. Keep them in one body.
				throw new Error(
					'Supabase is not configured. Put VITE_SUPABASE_URL and ' +
						'VITE_SUPABASE_PUBLISHABLE_KEY in .env.local at the REPO ROOT.'
				);
			}
			const { createClient } = await import('@supabase/supabase-js');
			return createClient(url, publishableKey, {
				auth: {
					// The session belongs in storage so a reload does not sign the player
					// out, and refresh has to be automatic because a run can easily
					// outlast an access token.
					persistSession: true,
					autoRefreshToken: true,
					// Not an OAuth callback handler: there is no redirect flow to parse,
					// and leaving this on makes every boot inspect the address bar.
					detectSessionInUrl: false
				}
			});
		})().catch((error: unknown) => {
			// A failed load must not be cached, or one offline boot means no sync for
			// the rest of the session. Same rule as createLazyRemote.
			clientPromise = null;
			throw error;
		});
	}
	return clientPromise;
}

/** The progression port, backed by the lazily-loaded client. */
export async function loadSupabaseRemote(): Promise<RemoteProgression> {
	return createSupabaseRemote(await getSupabaseClient());
}

/**
 * Fire `listener` whenever Supabase's auth state changes.
 *
 * Every event, deliberately unfiltered. Deciding which ones MEAN something is
 * `supabaseStore`'s job, and it does it by comparing the profile id it actually
 * observes rather than by trusting an event name - so filtering here would
 * require a second idea of the current identity, kept in step with that one.
 * The cost of over-notifying is one read.
 *
 * Subscribing loads the client, which is the same thing the store's boot read
 * already does, so this pulls nothing forward. The unsubscribe is safe to call
 * before the load has finished.
 */
export function onSupabaseIdentityChange(listener: () => void): () => void {
	let unsubscribe: (() => void) | null = null;
	let cancelled = false;
	void getSupabaseClient()
		.then((client) => {
			if (cancelled) return;
			const { data } = client.auth.onAuthStateChange(() => listener());
			unsubscribe = () => data.subscription.unsubscribe();
		})
		.catch(() => {
			// Unconfigured, or the chunk never arrived. Either way there is no
			// identity to hear about and the local game is unaffected. Swallowed
			// rather than reported: the store's own read reports the same failure,
			// and two lines per boot for one cause is noise.
		});
	return () => {
		cancelled = true;
		unsubscribe?.();
		unsubscribe = null;
	};
}
