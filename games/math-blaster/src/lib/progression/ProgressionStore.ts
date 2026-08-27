/**
 * The seam between what persists and where it actually lives.
 *
 * Today there is one implementation, backed by localStorage. The point of
 * the seam is that a networked one can arrive without `Game.svelte`
 * learning that a network exists.
 *
 * Two properties are load-bearing and easy to lose:
 *
 * - **Boot is SYNCHRONOUS.** `ProgressionHandle.current` is readable the
 *   instant the handle exists. There is no `'loading'` phase, no spinner,
 *   and no `0 banked` flash before the real number arrives. A remote store
 *   satisfies this by resolving from its local cache and treating the
 *   network as an update, never as the boot path.
 * - **Remote state never lands mid-run.** `gameFlow.ts` mutates the profile
 *   directly during `tick()`, so a copy arriving from elsewhere would race
 *   `awardCurrency()`. Anything remote is queued and delivered through
 *   `onRemote`, which the game only acts on at a safe phase.
 */

/**
 * Which side of a merge holds the more recent WRITE.
 *
 * Monotone fields - records, totals, high-water marks - ignore this
 * entirely: `max` is the same answer whichever side is newer. It exists
 * for the fields that are PREFERENCES rather than records, where there is
 * no "greater" value and the only sensible rule is last-write-wins.
 */
export type MergeHint = 'a-is-newer' | 'b-is-newer';

/**
 * Everything the store needs to know about one game's state, and nothing
 * about where that state is kept.
 *
 * The merge lives here rather than in the store on purpose: a generic store
 * cannot know which of a game's fields are monotone, and guessing wrong
 * silently destroys records.
 */
export interface ProgressionCodec<S> {
  /** Must match the directory under `games/` and the `game_slug` column. */
  readonly gameSlug: string;
  /** The shape of `S`, so a future reader knows what it is looking at. */
  readonly stateVersion: number;

  empty(): S;

  /**
   * Turn whatever was stored into a valid `S`.
   *
   * **MUST NOT THROW.** This is the one place untrusted data enters the
   * game - a player can edit it, and an older version of the game may have
   * written a different shape. Every field degrades to a sane default
   * rather than rejecting the whole payload, because losing a profile is a
   * far worse failure than loading an incomplete one.
   */
  parse(raw: unknown): S;

  merge(a: S, b: S, hint: MergeHint): S;

  /** The monotone "how far have they got" scalar, promoted out of the blob
   * so a store can enforce that it never goes backwards. */
  furthest(state: S): number;

  /**
   * Put a grade the PLATFORM asserts onto the state, if this game has
   * somewhere to put it. Optional: a game with no notion of a grade omits it.
   *
   * This exists for the same reason `merge` does. A store cannot know which
   * field a game keeps its grade in, and the alternative - a store reaching in
   * and setting `selectedGrade` because it happens to know Math Blaster - makes
   * every future game inherit one game's field name.
   *
   * The value arrives from the network, so it is UNTRUSTED. An implementation
   * may store it as-is provided something downstream validates it (Math Blaster
   * has `resolveGrade()`, which checks it against `GRADE_ORDER` and falls back
   * to a real grade). Never let it reach a curriculum lookup unchecked: a run
   * with no problems in it is a far worse failure than a run at the wrong
   * grade.
   */
  applyPlatformGrade?(state: S, grade: string): S;
}

export interface ProgressionHandle<S> {
  /** The live state. Readable synchronously from the moment the handle
   * exists - this is the boot path. */
  readonly current: S;

  /**
   * Record new state. The in-memory copy updates immediately; PERSISTING
   * it is debounced, because the caller writes on every kill and a network
   * store cannot survive that.
   */
  put(next: S): void;

  /** Persist anything pending right now. For the handful of moments worth
   * a guaranteed write - a purchase, a grade change, the end of a run. */
  flush(): void;

  /** Called when state arrives from elsewhere, already merged. Returns an
   * unsubscribe. Nothing calls this yet; the localStorage store has no
   * "elsewhere" to hear from. */
  onRemote(fn: (merged: S) => void): () => void;

  /** Flush and release any listeners the handle installed. */
  dispose(): void;
}

export interface ProgressionStore {
  open<S>(codec: ProgressionCodec<S>): ProgressionHandle<S>;
}
