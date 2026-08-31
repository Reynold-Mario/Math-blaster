import { mount } from 'svelte';
/**
 * BEFORE `./app.css` AND BEFORE `mount()`, AND THE ORDER IS THE POINT.
 *
 * Importing the shared store is what creates it, and creating it is what puts
 * `data-motion="reduce"|"full"` on `<html>` - the switch the reduced-motion
 * rules in `Game.svelte` are keyed on. After `mount()` and the first paint
 * animates before settling.
 *
 * A bare side-effect import: nothing at this level has a question for the store.
 * `Game.svelte` and `MotionToggle.svelte` import it by name, and `GameCanvas`
 * takes the answer as a prop.
 */
import '@pixel-blaster/motion';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
	target: document.getElementById('app')!
});

export default app;
