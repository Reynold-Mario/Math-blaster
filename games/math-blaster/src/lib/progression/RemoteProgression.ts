/**
 * The network half of the progression seam, as a PORT rather than a client.
 *
 * `supabaseStore.ts` talks to this and nothing else, which is what keeps the
 * store unit-testable with `testEnvironment: node` and no `@supabase/*` import
 * anywhere near a test. `supabaseRemote.ts` is the only implementation that
 * knows Supabase exists.
 *
 * Deliberately NOT generic over the game's state type. Everything here is
 * `unknown` on the way in and out, because the codec owns parsing and a
 * transport that thought it understood the payload would be a second place
 * that has to agree about its shape.
 */

/** What a `game_progress` row looks like once read. */
export interface RemoteSnapshot {
	/**
	 * The raw `jsonb` blob, straight from the row.
	 *
	 * Handed to `codec.parse`, which is contractually total - so a row written
	 * by an older build, or one a curious player edited through the API, degrades
	 * to defaults instead of throwing. Do not pre-validate it here; that would be
	 * a second validator to keep in step with the first.
	 */
	state: unknown;
	/** Mirrors `ProgressionCodec.stateVersion` as recorded on the row. */
	stateVersion: number;
	/** Optimistic-concurrency token. The trigger bumps it; nothing else may. */
	revision: number;
	/** The promoted monotone scalar, enforced by a trigger independently of
	 * whatever the client's merge believes. */
	furthest: number;
	/**
	 * `profiles.grade_level` / `grade_source`, read alongside the row.
	 *
	 * `grade_source` is the whole reason this is here: it is the schema's own
	 * answer to "may the platform overrule the local grade picker", and without
	 * it a merge has to guess which side's preference is newer.
	 */
	gradeLevel: string | null;
	gradeSource: 'self' | 'platform' | null;
}

export interface RemoteWrite {
	gameSlug: string;
	state: unknown;
	stateVersion: number;
	furthest: number;
	/**
	 * The revision this client last READ, or `null` for "no row existed, insert
	 * one". The write must be rejected rather than applied if the row has moved
	 * on - that rejection is what makes a lost update impossible, and the
	 * `furthest` trigger is the net under it rather than a substitute for it.
	 */
	expectedRevision: number | null;
}

export type RemoteWriteResult =
	/** Applied. `revision` is what the row now carries, ready for the next write. */
	| { outcome: 'written'; revision: number }
	/** Somebody else wrote first. The caller must re-read and re-merge through
	 * the GAME's merge - never clobber, and never retry the same payload. */
	| { outcome: 'conflict' }
	/**
	 * Nothing was written and it is not the caller's fault: offline, no session,
	 * a 5xx, a dropped connection. Distinct from `conflict` because the response
	 * is to retry the same payload later, not to re-merge.
	 */
	| { outcome: 'unavailable' };

/** One topic's contribution from a single run. Mirrors `TopicDelta`. */
export interface RunMasteryDelta {
	topicId: string;
	/** Absent for a topic with no Common Core code. Never invented. */
	standardCode?: string;
	attempts: number;
	correct: number;
}

/**
 * A finished run, as one submission.
 *
 * `idempotencyKey` is what makes replaying a queued run exact rather than
 * doubling a child's practice record, so it must be generated ONCE when the run
 * ends and then reused for every retry of that same run. Generating a fresh key
 * on retry defeats the entire mechanism.
 */
export interface RunSubmission {
	gameSlug: string;
	idempotencyKey: string;
	gradeLevel: string;
	waveReached: number;
	score: number;
	bossesDefeated: number;
	durationMs: number;
	mastery: RunMasteryDelta[];
	achievements: string[];
}

export type RunSubmitResult =
	/** Landed, or was already landed under this key. Either way: done, drop it. */
	| { outcome: 'submitted' }
	/** Transport or no session. Retry the SAME payload, key included. */
	| { outcome: 'unavailable' }
	/**
	 * Permanently refused - a malformed payload, a rejected auth, a constraint
	 * the server will never accept. DROP IT.
	 *
	 * This outcome exists so a bad run cannot retry forever. Without it a single
	 * malformed submission would occupy the queue for the lifetime of the
	 * profile, and every later run would queue behind it.
	 */
	| { outcome: 'rejected'; reason: string };

export interface RemoteProgression {
	/**
	 * The signed-in profile id, or `null` when there is no session.
	 *
	 * `null` is an ordinary answer, not an error: a signed-out player is the
	 * default state and must get a fully working local game. Every other method
	 * may assume the caller checked this first.
	 */
	currentProfileId(): Promise<string | null>;

	/** The row for this game, or `null` if this profile has never played it. */
	read(gameSlug: string): Promise<RemoteSnapshot | null>;

	write(input: RemoteWrite): Promise<RemoteWriteResult>;

	/**
	 * Land a finished run - session row, mastery deltas and achievement keys - in
	 * one idempotent write. The server enforces the idempotency; this only has to
	 * keep the key stable across retries.
	 */
	submitRun(run: RunSubmission): Promise<RunSubmitResult>;
}
