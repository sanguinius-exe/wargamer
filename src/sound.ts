// Tiny synthesised UI sounds — no audio assets, just the Web Audio API.
// Browsers won't start audio without a user gesture, so the context is unlocked
// on the first pointer/key event and on an explicit enable.

let ctx: AudioContext | null = null;
let enabled = true;

try {
  enabled = localStorage.getItem("wargamer:sound") !== "off";
} catch {
  /* ignore */
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

if (typeof window !== "undefined") {
  const unlock = () => {
    getCtx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem("wargamer:sound", v ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (v) getCtx(); // called from a click, so a good moment to unlock
}

function beep(
  freq: number,
  atOffset: number,
  dur: number,
  gain = 0.14,
  type: OscillatorType = "sine",
): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + atOffset;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** GM: a player just submitted their moves — a quick rising two-note ping. */
export function playSubmitReceived(): void {
  if (!enabled) return;
  beep(659.25, 0, 0.11, 0.11, "triangle");
  beep(987.77, 0.09, 0.15, 0.11, "triangle");
}

/** Player: the GM released a turn — a resolved ascending arpeggio. */
export function playTurnReleased(): void {
  if (!enabled) return;
  beep(523.25, 0, 0.14); // C5
  beep(659.25, 0.11, 0.14); // E5
  beep(783.99, 0.22, 0.24); // G5
}
