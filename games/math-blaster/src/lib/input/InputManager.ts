/**
 * The abstract action space every input method funnels into. Game logic
 * only ever consumes these - it never knows whether an action came from a
 * key press, a tap, or a drag.
 */
export type InputAction =
	| { type: 'move'; direction: 'left' | 'right'; pressed: boolean }
	| { type: 'moveTo'; xPct: number }
	| { type: 'digit'; digit: string }
	| { type: 'backspace' }
	| { type: 'fire' }
	| { type: 'skill'; skill: string };

export type InputListener = (action: InputAction) => void;

/**
 * Keyboard and pointer/touch bindings are opt-in and independent - attach
 * whichever the current platform needs. Both converge on the same emit()
 * call, so a future gamepad poll loop could drive the game through this
 * same surface (pressMove/releaseMove/pressDigit/pressFire) without any
 * other code needing to change.
 *
 * Gamepad inputs, when implemented, MUST use their own dedicated buttons
 * for movement, digit entry, firing, and active skills - never reusing or
 * overloading the same physical button for more than one of those
 * categories (e.g. a face button that both fires AND triggers a skill
 * depending on context is exactly what this rules out). Each category
 * gets its own binding, mirroring how keyboard (arrow keys vs digit keys
 * vs F/B) and touch (drag vs keypad vs skill buttons) already keep them
 * physically separate.
 */
export class InputManager {
	private listeners = new Set<InputListener>();

	on(listener: InputListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(action: InputAction) {
		for (const listener of this.listeners) listener(action);
	}

	/** Pure translation, exposed separately so it can be unit tested without
	 * a real DOM event. */
	static fromKeydown(key: string): InputAction | null {
		if (/^[0-9]$/.test(key)) return { type: 'digit', digit: key };
		if (key === 'Backspace') return { type: 'backspace' };
		if (key === 'Enter') return { type: 'fire' };
		if (key === 'ArrowLeft') return { type: 'move', direction: 'left', pressed: true };
		if (key === 'ArrowRight') return { type: 'move', direction: 'right', pressed: true };
		const k = key.toLowerCase();
		if (k === 'f') return { type: 'skill', skill: 'freeze' };
		if (k === 'b') return { type: 'skill', skill: 'bomb' };
		return null;
	}

	static fromKeyup(key: string): InputAction | null {
		if (key === 'ArrowLeft') return { type: 'move', direction: 'left', pressed: false };
		if (key === 'ArrowRight') return { type: 'move', direction: 'right', pressed: false };
		return null;
	}

	private keydownHandler = (e: Event) => {
		const action = InputManager.fromKeydown((e as KeyboardEvent).key);
		if (action) {
			e.preventDefault();
			this.emit(action);
		}
	};
	private keyupHandler = (e: Event) => {
		const action = InputManager.fromKeyup((e as KeyboardEvent).key);
		if (action) {
			e.preventDefault();
			this.emit(action);
		}
	};

	/** Returns an unbind function; call it on teardown. */
	attachKeyboard(target: EventTarget = window): () => void {
		target.addEventListener('keydown', this.keydownHandler);
		target.addEventListener('keyup', this.keyupHandler);
		return () => {
			target.removeEventListener('keydown', this.keydownHandler);
			target.removeEventListener('keyup', this.keyupHandler);
		};
	}

	// --- Explicit entry points for pointer/touch-driven UI, which already
	// knows exactly what the player did and doesn't need translation. ---

	/** Discrete hold, e.g. an on-screen left/right button. */
	pressMove(direction: 'left' | 'right') {
		this.emit({ type: 'move', direction, pressed: true });
	}
	releaseMove(direction: 'left' | 'right') {
		this.emit({ type: 'move', direction, pressed: false });
	}

	/** Absolute positioning, e.g. dragging a finger across the play field -
	 * the natural touch equivalent of holding a direction key. */
	dragTo(xPct: number) {
		this.emit({ type: 'moveTo', xPct: Math.max(0, Math.min(100, xPct)) });
	}

	pressDigit(digit: string) {
		if (/^[0-9]$/.test(digit)) this.emit({ type: 'digit', digit });
	}
	pressBackspace() {
		this.emit({ type: 'backspace' });
	}
	pressFire() {
		this.emit({ type: 'fire' });
	}
	pressSkill(skill: string) {
		this.emit({ type: 'skill', skill });
	}
}
