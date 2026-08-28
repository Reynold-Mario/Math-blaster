import { mount } from 'svelte'
/**
 * BEFORE `./app.css` AND BEFORE `mount()`, AND THE ORDER IS THE POINT.
 *
 * Importing the shared store is what creates it, and creating it is what puts
 * `data-motion="reduce"|"full"` on `<html>` - which is the switch every
 * reduced-motion rule in this app's stylesheets is keyed on. Do it after
 * `mount()` and the first paint animates before settling.
 *
 * It is a bare side-effect import because nothing at this level has a question
 * to ask the store; the component that does (`MotionToggle`) imports it by name.
 */
import '@pixel-blaster/motion'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
