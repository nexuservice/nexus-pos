/** Pitidos cortos de la caja (lectura de código, error). Si el navegador no deja reproducir audio, se omiten. */
let ctx: AudioContext | null = null;
const MUTE_KEY = 'nexus.scanSound';

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** Llamar tras un clic del usuario (p. ej. al abrir la cámara): los navegadores solo dejan sonar audio después de un gesto. */
export const unlockAudio = () => { audio(); };

export function soundEnabled(): boolean {
  try { return localStorage.getItem(MUTE_KEY) !== 'off'; } catch { return true; }
}
export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(MUTE_KEY, on ? 'on' : 'off'); } catch { /* sin persistencia */ }
}

function tone(freq: number, startAt: number, seconds: number, type: OscillatorType = 'square', volume = 0.15): void {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(volume, c.currentTime + startAt);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + startAt + seconds);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + startAt);
  o.stop(c.currentTime + startAt + seconds + 0.02);
}

/** Pitido de lectura correcta, como el de una caja de supermercado. */
export function beepOk(): void {
  if (!soundEnabled()) return;
  tone(1800, 0, 0.09);
}

/** Dos tonos graves: el código no se pudo agregar (no existe, sin stock…). */
export function beepError(): void {
  if (!soundEnabled()) return;
  tone(300, 0, 0.16, 'sawtooth');
  tone(220, 0.2, 0.22, 'sawtooth');
}
