/**
 * REDUCED MOTION, FOR EVERY SURFACE ON THE ORIGIN.
 *
 * This is the third module in the repo with two real consumers, and the second
 * to move to `packages/` because of it (see ROADMAP invariant 3). The trigger
 * was not that it "looked reusable": the catalog and the game are separate
 * documents on ONE origin, so `prefers-reduced-motion` is a setting a child can
 * only change once, and a preference stored under two different keys is a
 * preference that silently stops applying the moment they click Play. The key
 * below is the shared state; everything else here is the rule for reading it.
 *
 * WHY A STORED PREFERENCE AT ALL, when the OS already has a setting: a child on
 * a managed school device does not control the OS setting, and for a
 * photosensitive or vestibular child the parallax, the hit flash and the screen
 * shake are a hazard rather than polish. So the media query is the DEFAULT and
 * not the answer - an explicit preference outranks it, in both directions.
 *
 * Hence three states and not a boolean:
 *
 *   'system'  follow the OS, live, with no reload      (the default)
 *   'reduce'  the child asked for less, whatever the OS says
 *   'full'    the child asked for all of it, whatever the OS says
 *
 * `'full'` is the one that looks redundant and is not: it is the only way back
 * for someone whose device forces `reduce` system-wide.
 *
 * NO DOM AND NO STORAGE ARE TOUCHED DIRECTLY. Everything the browser owns is
 * behind `MotionEnvironment`, for the same reason `LearnerIdentity` is a port:
 * it keeps the interesting half - which preference wins, and when a change is
 * worth telling anyone about - testable under `testEnvironment: node`.
 */

/** Which of the two sources wins, and which way. See the header. */
export type MotionPreference = 'system' | 'reduce' | 'full';

/**
 * ONE KEY FOR EVERY SURFACE ON THE ORIGIN, AND DELIBERATELY NOT NAMESPACED PER
 * GAME - it is the documented exception to ROADMAP invariant 2. That rule
 * exists because game state (currency, skills, queued runs) collides when two
 * games share an origin; this is the opposite case. An accessibility setting
 * that had to be re-made on the catalog, then again in Math Blaster, then again
 * in the next game, is a bug and not isolation.
 *
 * It is also NOT scoped to the learner. The hazard belongs to whoever is
 * looking at the screen right now, which is knowable before identity resolves
 * (identity is a `fetch`; invariant 16) and is often not a signed-in child at
 * all. A shared device getting one motion setting is the correct trade.
 */
export const MOTION_STORAGE_KEY = 'pixel-blaster:motion';

/** The OS-level setting, as a media query string. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The attribute the resolved answer is mirrored onto `<html>` as, so that CSS
 * can key off it: `data-motion="reduce"` or `data-motion="full"`.
 *
 * IT REPLACES `@media (prefers-reduced-motion: reduce)` IN OUR STYLESHEETS
 * RATHER THAN JOINING IT, and that is the point of it. A media query cannot see
 * an override, so a page that used both would need every rule twice - once
 * guarded on the query and `:not([data-motion='full'])`, once on
 * `[data-motion='reduce']` - and the guard is exactly the kind of thing that
 * gets copied correctly four times and wrongly the fifth. There is no
 * flash-of-motion to protect against either: both apps are JS-only SPAs whose
 * markup does not exist until `mount()` runs, and this attribute is set before
 * that (see each app's `main.ts`).
 */
export const MOTION_ATTRIBUTE = 'data-motion';

/** Anything we did not write - a hand-edited value, a key from an older
 * build, `null` - means "no preference", never "reduce". */
export function parsePreference(raw: string | null | undefined): MotionPreference {
	return raw === 'reduce' || raw === 'full' ? raw : 'system';
}

/** THE WHOLE RULE, in one pure line: an explicit preference wins; otherwise
 * the device decides. */
export function resolveReducedMotion(preference: MotionPreference, systemReduce: boolean): boolean {
	return preference === 'system' ? systemReduce : preference === 'reduce';
}

/**
 * What a toggle writes: the opposite of what is on screen, as an EXPLICIT
 * preference.
 *
 * Never `'system'`. Touching the control is the child saying something the
 * device setting cannot say back, so it has to outrank it from then on -
 * otherwise a device that forces `reduce` would swallow the press and the
 * button would read as broken.
 */
export function togglePreference(
	preference: MotionPreference,
	systemReduce: boolean
): MotionPreference {
	return resolveReducedMotion(preference, systemReduce) ? 'full' : 'reduce';
}

/**
 * Everything the browser owns, so that nothing above it needs a browser.
 * A real one is `browserMotionEnvironment(window)`; tests pass a fake.
 */
export interface MotionEnvironment {
	/** Whether the OS asks for reduced motion, right now. */
	systemReduce(): boolean;
	/** Fires when the OS setting changes. Returns an unsubscribe. */
	onSystemChange(listener: () => void): () => void;
	/** The raw stored preference, or `null`. */
	readPreference(): string | null;
	writePreference(value: string): void;
	/** Fires when ANOTHER document on this origin writes the key - the catalog
	 * and a game open in two tabs. Returns an unsubscribe. */
	onExternalWrite(listener: () => void): () => void;
	/** Mirror the resolved answer somewhere CSS can see it. */
	reflect(reduced: boolean): void;
}

/**
 * The real one.
 *
 * Every storage call is wrapped: `localStorage` THROWS rather than returning
 * null when a browser has site data blocked (Safari's private mode is the usual
 * one), and losing the preference is survivable while taking the page down over
 * it is not.
 */
export function browserMotionEnvironment(win: Window): MotionEnvironment {
	const query = win.matchMedia(REDUCED_MOTION_QUERY);

	return {
		systemReduce: () => query.matches,

		onSystemChange(listener) {
			// LIVE, WITH NO RELOAD - which is the one thing the media query in our
			// stylesheets used to give us for free and this had to earn back.
			query.addEventListener('change', listener);
			return () => query.removeEventListener('change', listener);
		},

		readPreference() {
			try {
				return win.localStorage.getItem(MOTION_STORAGE_KEY);
			} catch {
				return null;
			}
		},

		writePreference(value) {
			try {
				win.localStorage.setItem(MOTION_STORAGE_KEY, value);
			} catch {
				// Nothing to do and nothing to report: the setting still applies to
				// this document, it just will not survive the navigation.
			}
		},

		onExternalWrite(listener) {
			const onStorage = (event: StorageEvent) => {
				// `key === null` is a whole-storage clear, which is also a change to
				// ours. Anything else is somebody else's key.
				if (event.key === null || event.key === MOTION_STORAGE_KEY) listener();
			};
			win.addEventListener('storage', onStorage);
			return () => win.removeEventListener('storage', onStorage);
		},

		reflect(reduced) {
			win.document.documentElement.setAttribute(MOTION_ATTRIBUTE, reduced ? 'reduce' : 'full');
		}
	};
}

/** For anywhere there is no browser - a test, a node build step. Motion is
 * never reduced, nothing is stored, and no listener ever fires. */
export function inertMotionEnvironment(): MotionEnvironment {
	const noop = () => () => {};
	return {
		systemReduce: () => false,
		onSystemChange: noop,
		readPreference: () => null,
		writePreference: () => {},
		onExternalWrite: noop,
		reflect: () => {}
	};
}

export function defaultMotionEnvironment(): MotionEnvironment {
	return typeof window === 'undefined'
		? inertMotionEnvironment()
		: browserMotionEnvironment(window);
}

export interface MotionStore {
	/** What has been asked for. */
	readonly preference: MotionPreference;
	/** What that resolves to, and the only thing a renderer should read. */
	readonly reduced: boolean;
	readonly systemReduce: boolean;
	set(preference: MotionPreference): void;
	/** Flip what is on screen, and remember it. */
	toggle(): void;
	/**
	 * Called when `reduced` CHANGES, never on subscribe - read `.reduced` for
	 * the initial value, the same contract `gameEvents.on` has.
	 */
	subscribe(listener: (reduced: boolean) => void): () => void;
	dispose(): void;
}

/**
 * The resolved setting, kept in step with both of its inputs.
 *
 * Note what it notifies on: the RESOLVED value, and only when it moves. An OS
 * toggle underneath an explicit preference changes `systemReduce` and nothing
 * else, so a canvas that rebuilt its starfield on every notification is not
 * punished for it.
 */
export function createMotionStore(
	env: MotionEnvironment = defaultMotionEnvironment()
): MotionStore {
	let preference = parsePreference(env.readPreference());
	let systemReduce = env.systemReduce();
	let reduced = resolveReducedMotion(preference, systemReduce);
	const listeners = new Set<(reduced: boolean) => void>();

	// Before anything renders, so the first paint is already correct.
	env.reflect(reduced);

	function settle() {
		const next = resolveReducedMotion(preference, systemReduce);
		if (next === reduced) return;
		reduced = next;
		env.reflect(reduced);
		for (const listener of listeners) listener(reduced);
	}

	const stopSystem = env.onSystemChange(() => {
		systemReduce = env.systemReduce();
		settle();
	});

	const stopExternal = env.onExternalWrite(() => {
		preference = parsePreference(env.readPreference());
		settle();
	});

	function set(next: MotionPreference) {
		if (next === preference) return;
		preference = next;
		env.writePreference(next);
		settle();
	}

	return {
		get preference() {
			return preference;
		},
		get reduced() {
			return reduced;
		},
		get systemReduce() {
			return systemReduce;
		},
		set,
		toggle: () => set(togglePreference(preference, systemReduce)),
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			stopSystem();
			stopExternal();
			listeners.clear();
		}
	};
}

/**
 * THE ONE STORE EACH APP USES.
 *
 * A singleton because its two side effects are singletons: there is one
 * `<html>` to mirror onto and one storage key to own. Creating it applies the
 * attribute, which is why `main.ts` importing this module is enough to make the
 * stylesheets correct - a component that forgets to subscribe still renders
 * with the right CSS.
 */
export const motion: MotionStore = createMotionStore();
