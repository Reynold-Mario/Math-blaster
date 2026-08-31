import type {
	RemoteProgression,
	RemoteSnapshot,
	RemoteWrite,
	RemoteWriteResult,
	RunSubmission,
	RunSubmitResult
} from './RemoteProgression';

/**
 * A `RemoteProgression` that does not exist until something asks it a question.
 *
 * This is what lets `@supabase/supabase-js` live in a lazily-fetched chunk
 * instead of the main bundle. Every method on the port is already async, so
 * deferring construction costs the caller nothing and the store needs no
 * knowledge of it at all.
 *
 * Why this is worth the indirection: with credentials configured the client is
 * ~209 kB raw / ~54 kB gzip, and this is a game for six-year-olds on school
 * hardware. Loading it as a side chunk means the game is playable while it
 * arrives, rather than after.
 */
export function createLazyRemote(load: () => Promise<RemoteProgression>): RemoteProgression {
	let loading: Promise<RemoteProgression> | null = null;

	function get(): Promise<RemoteProgression> {
		if (loading === null) {
			// Memoize the PROMISE rather than the resolved value, so two calls that
			// arrive together share one load instead of racing two imports.
			loading = load().catch((error: unknown) => {
				// ...but never memoize a FAILURE. A chunk fetch that failed because the
				// player booted offline has to be retryable when the connection comes
				// back, and the store's backoff will ask again. Caching the rejected
				// promise would turn one bad moment into a permanently local session.
				loading = null;
				throw error;
			});
		}
		return loading;
	}

	return {
		async currentProfileId(): Promise<string | null> {
			return (await get()).currentProfileId();
		},
		async read(gameSlug: string): Promise<RemoteSnapshot | null> {
			return (await get()).read(gameSlug);
		},
		async write(input: RemoteWrite): Promise<RemoteWriteResult> {
			return (await get()).write(input);
		},
		async submitRun(run: RunSubmission): Promise<RunSubmitResult> {
			return (await get()).submitRun(run);
		}
	};
}
