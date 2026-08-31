import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	RemoteProgression,
	RemoteSnapshot,
	RemoteWrite,
	RemoteWriteResult,
	RunSubmission,
	RunSubmitResult
} from './RemoteProgression';

/**
 * The one file that knows Supabase exists.
 *
 * `supabaseStore.ts` depends on the `RemoteProgression` port instead of this,
 * which is what lets the store's tests run under `testEnvironment: node` with
 * no `@supabase/*` import and no network.
 *
 * The error convention here is deliberate and worth knowing before editing:
 *
 * - A **returned** `PostgrestError` is a server answer - bad request, RLS
 *   denial, constraint violation. It is thrown, so the store reports it through
 *   `onError` and a human eventually sees it. Silently retrying an RLS denial
 *   forever is how a permissions bug hides for a week.
 * - A **thrown** exception is transport - offline, DNS, a dropped connection.
 *   It becomes `unavailable`, which the store retries with backoff.
 *
 * The single exception is a unique violation on insert, which is not an error
 * at all: it means another tab created the row first, so it maps to `conflict`.
 */

/** Postgres unique-violation. On insert it means the row already exists. */
const UNIQUE_VIOLATION = '23505';

function isOffline(): boolean {
	// `navigator.onLine` is only ever trustworthy in the negative direction: a
	// false means there is definitely no connection, a true means very little.
	// Used solely to skip a request that cannot succeed.
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function createSupabaseRemote(client: SupabaseClient): RemoteProgression {
	/**
	 * `ensure_profile()` is idempotent, but it is still a round trip, and the
	 * profile id cannot change for a given auth subject. Cache it against the
	 * user id so a sign-out and sign-in as somebody else cannot inherit the
	 * previous player's profile.
	 */
	let cachedProfileId: string | null = null;
	let cachedForUserId: string | null = null;

	async function currentProfileId(): Promise<string | null> {
		const { data, error } = await client.auth.getSession();
		if (error) throw error;

		const userId = data.session?.user?.id ?? null;
		if (userId === null) {
			cachedProfileId = null;
			cachedForUserId = null;
			return null;
		}
		if (cachedProfileId !== null && cachedForUserId === userId) return cachedProfileId;

		// The only thing that ever creates a profile or its identity mapping.
		// Idempotent, so calling it on every boot is correct rather than wasteful.
		const { data: profileId, error: rpcError } = await client.rpc('ensure_profile');
		if (rpcError) throw rpcError;
		if (typeof profileId !== 'string') {
			throw new Error('ensure_profile() returned no profile id');
		}

		cachedProfileId = profileId;
		cachedForUserId = userId;
		return profileId;
	}

	async function read(gameSlug: string): Promise<RemoteSnapshot | null> {
		const profileId = await currentProfileId();
		if (profileId === null) return null;

		// `profiles(...)` is a PostgREST embed over the profile_id foreign key, so
		// the grade arrives in the same round trip as the state. Reading it
		// separately would be a second request and a second chance to be
		// inconsistent.
		const { data, error } = await client
			.from('game_progress')
			.select('state, state_version, revision, furthest, profiles(grade_level, grade_source)')
			.eq('profile_id', profileId)
			.eq('game_slug', gameSlug)
			.maybeSingle();

		if (error) throw error;
		if (data === null) return null;

		const row = data as unknown as {
			state: unknown;
			state_version: number;
			revision: number;
			furthest: number;
			profiles: { grade_level: string | null; grade_source: string | null } | null;
		};
		const gradeSource = row.profiles?.grade_source ?? null;

		return {
			state: row.state,
			stateVersion: row.state_version,
			revision: row.revision,
			furthest: row.furthest,
			gradeLevel: row.profiles?.grade_level ?? null,
			// Narrowed rather than cast: an unrecognised value means "no opinion",
			// which makes the local picker authoritative. Trusting an unknown
			// grade_source to mean 'platform' would let a bad row overwrite a
			// child's own choice.
			gradeSource: gradeSource === 'platform' || gradeSource === 'self' ? gradeSource : null
		};
	}

	async function write(input: RemoteWrite): Promise<RemoteWriteResult> {
		if (isOffline()) return { outcome: 'unavailable' };

		let profileId: string | null;
		try {
			profileId = await currentProfileId();
		} catch {
			return { outcome: 'unavailable' };
		}
		if (profileId === null) return { outcome: 'unavailable' };

		const row = {
			state: input.state,
			state_version: input.stateVersion,
			furthest: input.furthest
		};

		try {
			if (input.expectedRevision === null) {
				const { data, error } = await client
					.from('game_progress')
					.insert({ profile_id: profileId, game_slug: input.gameSlug, ...row })
					.select('revision')
					.maybeSingle();

				if (error) {
					if (error.code === UNIQUE_VIOLATION) return { outcome: 'conflict' };
					throw error;
				}
				if (data === null) return { outcome: 'conflict' };
				return { outcome: 'written', revision: (data as { revision: number }).revision };
			}

			// `revision` is part of the WHERE clause, not the payload: the trigger
			// owns bumping it. Zero rows matched means the row moved on, which is a
			// conflict rather than a failure.
			const { data, error } = await client
				.from('game_progress')
				.update(row)
				.eq('profile_id', profileId)
				.eq('game_slug', input.gameSlug)
				.eq('revision', input.expectedRevision)
				.select('revision')
				.maybeSingle();

			if (error) throw error;
			if (data === null) return { outcome: 'conflict' };
			// Post-trigger value, so this is the revision the next write must carry.
			return { outcome: 'written', revision: (data as { revision: number }).revision };
		} catch (error) {
			// Per the convention above: a returned PostgrestError has already been
			// rethrown, so anything caught here is transport.
			if (error instanceof Error && 'code' in error) throw error;
			return { outcome: 'unavailable' };
		}
	}

	async function submitRun(run: RunSubmission): Promise<RunSubmitResult> {
		if (isOffline()) return { outcome: 'unavailable' };

		let profileId: string | null;
		try {
			profileId = await currentProfileId();
		} catch {
			return { outcome: 'unavailable' };
		}
		// No session yet. The run stays queued: signing in later is what makes it
		// landable, so this is emphatically not a rejection.
		if (profileId === null) return { outcome: 'unavailable' };

		try {
			const { error } = await client.rpc('submit_run', {
				p_game_slug: run.gameSlug,
				p_idempotency_key: run.idempotencyKey,
				p_grade_level: run.gradeLevel,
				p_wave_reached: run.waveReached,
				p_score: run.score,
				p_bosses_defeated: run.bossesDefeated,
				p_duration_ms: run.durationMs,
				p_mastery: run.mastery.map((d) => ({
					topic_id: d.topicId,
					standard_code: d.standardCode ?? null,
					attempts: d.attempts,
					correct: d.correct
				})),
				p_achievements: run.achievements
			});

			if (error === null) return { outcome: 'submitted' };

			// A returned PostgrestError is a server ANSWER, and the class matters
			// because it decides retry-forever versus drop-forever.
			//
			// 08* is connection failure - retry. Everything else the server bothered
			// to name (a bad payload, a constraint, a refused auth) will be refused
			// identically next time, and retrying it forever would wedge the queue
			// and block every run behind it.
			if (typeof error.code === 'string' && error.code.startsWith('08')) {
				return { outcome: 'unavailable' };
			}
			return { outcome: 'rejected', reason: `${error.code ?? 'unknown'}: ${error.message}` };
		} catch {
			// Thrown, therefore transport. Retry.
			return { outcome: 'unavailable' };
		}
	}

	return { currentProfileId, read, write, submitRun };
}
