/**
 * The catalog. One entry per game, and the single source of truth for what
 * this page says about each of them.
 *
 * THIS MODULE IMPORTS NOTHING, AND THAT IS DELIBERATE. `sprites.ts` holds the
 * `.apng` imports; this file holds the vocabulary they are keyed by. Keeping
 * the data free of anything a bundler has to resolve is what lets it be read
 * by a plain type-check, and it mirrors the split the game already runs:
 * `enemyArchetypes.ts` owns the sprite-kind vocabulary and `spriteAtlas.ts`
 * imports it, never the reverse.
 *
 * Field names track the platform's `GameCatalogEntry` (the-student-experience,
 * `src/lib/games/catalog.ts`) wherever a field means the same thing, because
 * ROADMAP PR 16 eventually feeds this repo's games into that catalog and a
 * rename map is where a field gets quietly dropped. Three divergences, each
 * because the meaning genuinely differs:
 *
 *   - no `launchUrl`: `gameHref()` below DERIVES it from the id
 *   - `sprite`, not `imageUrl`: a key into `sprites.ts`, not a `/games/*.webp`
 *   - no `categories`, no `membersOnly`: there is no filter UI (dead controls
 *     at four entries) and no commercial model. PR 16 adds them, with a
 *     consumer to justify them.
 */

/** The art this page draws. A SUBSET of the nine APNGs in the game's
 *  `public/sprites/` - each key costs bundle bytes because `SPRITE_ART` is a
 *  `Record` and Rollup cannot shake unused entries out of one. Add a key when
 *  a card needs it, rather than mirroring the directory. */
export type SpriteKey = 'player' | 'drone' | 'swarmer' | 'hulk';

/** A palette token by reference, never a hex literal, so a palette change stays
 *  one file. The platform's catalog plays the same trick with
 *  `var(--game-accent-<id>)`; we point at the existing space palette instead of
 *  minting a token per game, because four entries do not need that layer. */
type AccentToken = `var(--accent-${string})`;

interface CatalogGameBase {
	/** ONE STRING IN THREE PLACES now, not four: the directory under `games/`,
	 *  the vite `base`, and `game_slug` in the database. The catalog href used to
	 *  be the fourth - `gameHref()` derives it, so it cannot drift out of step.
	 *  See ROADMAP invariant 1. */
	id: string;
	name: string;
	description: string;
	/** Free prose, matching the platform catalog's convention. Not parsed, not
	 *  filtered, and hand-maintained: it tracks `AUTHORED_GRADES` in the game's
	 *  `gradeTree.ts`, which is K-3 today. Deriving it would mean importing
	 *  across a workspace boundary, which would mean extracting a package for
	 *  one consumer - see ROADMAP invariant 3. Accepted drift, revisited in
	 *  PR 16. */
	grades: string;
	accent: AccentToken;
	sprite: SpriteKey;
}

export interface PlayableGame extends CatalogGameBase {
	status: 'playable';
}

export interface UpcomingGame extends CatalogGameBase {
	status: 'coming-soon';
}

/**
 * A union rather than a `status` field on one shape, so that `gameHref` can
 * REFUSE a game with nowhere to go. A "coming soon" card that links to a 404
 * is the one bug this page is actually capable of having, and this makes it a
 * compile error instead of a thing to remember.
 */
export type CatalogGame = PlayableGame | UpcomingGame;

/**
 * The href is DERIVED, never stored. That removes one of the four places
 * ROADMAP invariant 1 asks you to keep in step by hand, so it strengthens the
 * invariant rather than bending it.
 *
 * The template-literal return type pins both the `/learner/games/` prefix and
 * THE TRAILING SLASH at compile time. A missing trailing slash costs a Netlify
 * redirect hop on every launch; now it cannot be written.
 */
export function gameHref(game: PlayableGame): `/learner/games/${string}/` {
	return `/learner/games/${game.id}/`;
}

/**
 * The playable game gets the player ship; the unbuilt ones get enemies. It
 * costs nothing and it means the grid reads at a glance.
 *
 * THE THREE UPCOMING ENTRIES ARE ILLUSTRATIVE, NOT A ROADMAP. `ROADMAP.md`
 * names no second game anywhere, and this file is not the place to commit to
 * one. Each is the shipped engine pointed at a different curriculum, which is
 * genuinely the cheapest second game this repo could build - but if one of
 * them turns out not to be next, change it here and nothing else moves.
 */
export const GAMES: CatalogGame[] = [
	{
		id: 'math-blaster',
		status: 'playable',
		name: 'Pixel Math Blaster',
		description:
			'Line up under a falling enemy, type the answer, fire. Close answers buy you time; only an exact one clears the stack.',
		grades: 'Grades K-3',
		accent: 'var(--accent-hot)',
		sprite: 'player'
	},
	{
		id: 'word-blaster',
		status: 'coming-soon',
		name: 'Word Blaster',
		description:
			'The same ship and the same clock, pointed at reading: take the clue, type the word, fire.',
		grades: 'Grades K-3',
		accent: 'var(--accent-violet)',
		sprite: 'drone'
	},
	{
		id: 'shape-blaster',
		status: 'coming-soon',
		name: 'Shape Blaster',
		description:
			'Sort by sides, angles and symmetry before the formation reaches the bottom of the screen.',
		grades: 'Grades K-3',
		accent: 'var(--accent-green)',
		sprite: 'swarmer'
	},
	{
		id: 'clock-blaster',
		status: 'coming-soon',
		name: 'Clock Blaster',
		description:
			'Read the dial, count the coins, fire the answer. Time and money running on the same clock.',
		grades: 'Grades 1-3',
		accent: 'var(--accent-cyan)',
		sprite: 'hulk'
	}
];
