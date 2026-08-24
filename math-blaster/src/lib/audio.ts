let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function setMuted(v: boolean) {
  muted = v;
}
export function isMuted() {
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, glideTo?: number) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  type: () => tone(520, 0.04, 'square', 0.05),
  fire: () => tone(720, 0.09, 'square', 0.07, 0, 1100),
  exact: () => {
    tone(660, 0.09, 'square', 0.09);
    tone(990, 0.12, 'square', 0.08, 0.07);
  },
  close: () => tone(420, 0.12, 'triangle', 0.08),
  miss: () => tone(160, 0.15, 'sawtooth', 0.06, 0, 90),
  impact: () => tone(110, 0.25, 'sawtooth', 0.1, 0, 55),
  skill: () => {
    tone(500, 0.08, 'square', 0.08);
    tone(760, 0.1, 'square', 0.08, 0.08);
    tone(1020, 0.12, 'square', 0.08, 0.16);
  },
  stageClear: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.09, i * 0.11));
  },
  gameover: () => {
    [392, 349, 294, 220].forEach((f, i) => tone(f, 0.22, 'sawtooth', 0.08, i * 0.15));
  },
  victory: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'square', 0.09, i * 0.13));
  },
};

// --- Wiring to gameEvents ---
// This is the presentation layer actually doing the "interpret abstract
// events" job: nothing above this point knows a GameEvent exists, and
// nothing in combat/gameFlow calls sfx.* directly.

import { gameEvents, type GameEvent } from './events';

function handleGameEvent(event: GameEvent) {
  switch (event.type) {
    case 'shot-fired':
      sfx.fire();
      break;
    case 'hit-exact':
    case 'hit-equivalent':
      sfx.exact();
      break;
    case 'hit-close':
    case 'hit-partial':
      sfx.close();
      break;
    case 'hit-incorrect':
    case 'hit-invalid':
      sfx.miss();
      break;
    case 'time-lost':
      sfx.impact();
      break;
    case 'skill-used':
    case 'impact-avoided':
      sfx.skill();
      break;
    case 'stage-cleared':
    case 'boss-defeated':
      sfx.stageClear();
      break;
    case 'game-over':
      sfx.gameover();
      break;
    case 'victory':
      sfx.victory();
      break;
    default:
      break;
  }
}

/** Subscribes audio to the game event bus. Returns an unsubscribe
 * function; call once (e.g. in the root component's onMount). */
export function wireAudioToEvents(): () => void {
  return gameEvents.on(handleGameEvent);
}
