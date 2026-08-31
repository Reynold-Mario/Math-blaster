import {
	createMotionStore,
	parsePreference,
	resolveReducedMotion,
	togglePreference,
	type MotionEnvironment,
	type MotionPreference
} from './index';

/**
 * A fake browser: one boolean for the OS setting, one string for storage, and
 * the two listeners the real environment installs. Nothing here is a mock in
 * the "assert it was called" sense - the tests drive it and read what came out.
 */
function fakeEnv(initial: { systemReduce?: boolean; stored?: string | null } = {}) {
	let systemReduce = initial.systemReduce ?? false;
	let stored = initial.stored ?? null;
	const systemListeners = new Set<() => void>();
	const writeListeners = new Set<() => void>();
	const reflected: boolean[] = [];

	const env: MotionEnvironment = {
		systemReduce: () => systemReduce,
		onSystemChange(listener) {
			systemListeners.add(listener);
			return () => systemListeners.delete(listener);
		},
		readPreference: () => stored,
		writePreference: (value) => {
			stored = value;
		},
		onExternalWrite(listener) {
			writeListeners.add(listener);
			return () => writeListeners.delete(listener);
		},
		reflect: (reduced) => reflected.push(reduced)
	};

	return {
		env,
		reflected,
		get stored() {
			return stored;
		},
		get listenerCount() {
			return systemListeners.size + writeListeners.size;
		},
		/** The OS setting changed under us. */
		setSystem(next: boolean) {
			systemReduce = next;
			for (const listener of systemListeners) listener();
		},
		/** Another tab wrote the shared key. */
		writeElsewhere(value: string | null) {
			stored = value;
			for (const listener of writeListeners) listener();
		}
	};
}

describe('parsePreference', () => {
	it('accepts only the two explicit preferences', () => {
		expect(parsePreference('reduce')).toBe('reduce');
		expect(parsePreference('full')).toBe('full');
	});

	it('treats anything else as no preference, never as reduce', () => {
		for (const raw of [null, undefined, '', 'system', 'REDUCE', 'true', '1', '{}']) {
			expect(parsePreference(raw)).toBe('system');
		}
	});
});

describe('resolveReducedMotion', () => {
	it('follows the device when nothing was asked for', () => {
		expect(resolveReducedMotion('system', true)).toBe(true);
		expect(resolveReducedMotion('system', false)).toBe(false);
	});

	it('lets an explicit preference outrank the device IN BOTH DIRECTIONS', () => {
		// The school-device case: the OS cannot be changed, the child can still ask.
		expect(resolveReducedMotion('reduce', false)).toBe(true);
		// And the way back, for a device that forces reduce system-wide.
		expect(resolveReducedMotion('full', true)).toBe(false);
	});
});

describe('togglePreference', () => {
	it('always writes an explicit preference, never system', () => {
		const cases: Array<[MotionPreference, boolean, MotionPreference]> = [
			['system', false, 'reduce'],
			['system', true, 'full'],
			['reduce', false, 'full'],
			['reduce', true, 'full'],
			['full', false, 'reduce'],
			['full', true, 'reduce']
		];
		for (const [preference, systemReduce, expected] of cases) {
			expect(togglePreference(preference, systemReduce)).toBe(expected);
		}
	});

	it('flips what is on screen rather than what is stored', () => {
		// Stored 'full' against an OS that says reduce: on screen motion is ON, so
		// one press has to turn it off. Flipping the STORED value would produce
		// 'reduce' -> resolves to reduce -> correct here by luck; the case that
		// catches it is a no-preference start on a reducing device, where flipping
		// the stored value gives 'reduce' and changes nothing on screen.
		expect(togglePreference('system', true)).toBe('full');
	});
});

describe('createMotionStore', () => {
	it('starts from the device when nothing is stored', () => {
		const fake = fakeEnv({ systemReduce: true });
		const store = createMotionStore(fake.env);
		expect(store.preference).toBe('system');
		expect(store.reduced).toBe(true);
	});

	it('mirrors the resolved answer before anyone subscribes', () => {
		const fake = fakeEnv({ systemReduce: true });
		createMotionStore(fake.env);
		expect(fake.reflected).toEqual([true]);
	});

	it('lets a stored preference beat the device on boot', () => {
		const fake = fakeEnv({ systemReduce: true, stored: 'full' });
		expect(createMotionStore(fake.env).reduced).toBe(false);

		const other = fakeEnv({ systemReduce: false, stored: 'reduce' });
		expect(createMotionStore(other.env).reduced).toBe(true);
	});

	it('follows the device live while the preference is system', () => {
		const fake = fakeEnv({ systemReduce: false });
		const store = createMotionStore(fake.env);
		const seen: boolean[] = [];
		store.subscribe((reduced) => seen.push(reduced));

		fake.setSystem(true);

		expect(store.reduced).toBe(true);
		expect(seen).toEqual([true]);
	});

	it('ignores the device once a preference is explicit, and says nothing about it', () => {
		const fake = fakeEnv({ systemReduce: false, stored: 'reduce' });
		const store = createMotionStore(fake.env);
		const seen: boolean[] = [];
		store.subscribe((reduced) => seen.push(reduced));

		fake.setSystem(true);

		expect(store.reduced).toBe(true);
		// The resolved value never moved, so nothing was notified - which is what
		// stops a subscriber doing expensive work on an irrelevant OS event.
		expect(seen).toEqual([]);
		// ...but the device reading did move, and the toggle needs it.
		expect(store.systemReduce).toBe(true);
	});

	it('persists what the toggle decided', () => {
		const fake = fakeEnv({ systemReduce: false });
		const store = createMotionStore(fake.env);

		store.toggle();
		expect(store.reduced).toBe(true);
		expect(fake.stored).toBe('reduce');

		store.toggle();
		expect(store.reduced).toBe(false);
		expect(fake.stored).toBe('full');
	});

	it('turns motion off in one press on a device that already asks to reduce', () => {
		// The stored 'full' is the interesting part: without it the child could not
		// have motion on in the first place, and a naive toggle would write
		// 'reduce' -> already reduced -> no visible change.
		const fake = fakeEnv({ systemReduce: true, stored: 'full' });
		const store = createMotionStore(fake.env);
		expect(store.reduced).toBe(false);

		store.toggle();

		expect(store.reduced).toBe(true);
		expect(fake.stored).toBe('reduce');
	});

	it('adopts a preference written by another document on the origin', () => {
		const fake = fakeEnv({ systemReduce: false });
		const store = createMotionStore(fake.env);
		const seen: boolean[] = [];
		store.subscribe((reduced) => seen.push(reduced));

		// The catalog turned it on while the game sat in another tab.
		fake.writeElsewhere('reduce');

		expect(store.preference).toBe('reduce');
		expect(store.reduced).toBe(true);
		expect(seen).toEqual([true]);
	});

	it('treats a cleared key as a return to following the device', () => {
		const fake = fakeEnv({ systemReduce: false, stored: 'reduce' });
		const store = createMotionStore(fake.env);

		fake.writeElsewhere(null);

		expect(store.preference).toBe('system');
		expect(store.reduced).toBe(false);
	});

	it('notifies only on a change, and only once per change', () => {
		const fake = fakeEnv({ systemReduce: false });
		const store = createMotionStore(fake.env);
		const seen: boolean[] = [];
		store.subscribe((reduced) => seen.push(reduced));

		store.set('reduce');
		store.set('reduce');
		fake.setSystem(true);

		expect(seen).toEqual([true]);
		expect(fake.reflected).toEqual([false, true]);
	});

	it('unsubscribes, and disposes of both listeners', () => {
		const fake = fakeEnv({ systemReduce: false });
		const store = createMotionStore(fake.env);
		const seen: boolean[] = [];
		const stop = store.subscribe((reduced) => seen.push(reduced));

		stop();
		store.set('reduce');
		expect(seen).toEqual([]);

		expect(fake.listenerCount).toBe(2);
		store.dispose();
		expect(fake.listenerCount).toBe(0);
	});
});
