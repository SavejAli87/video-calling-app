/**
 * sounds.js
 * Ringtone / ringback / message tone - Web Audio se generate hote hain (koi audio file nahi).
 *
 *  startRingtone()  : incoming call par loop me bajta hai (+ phone vibrate)
 *  stopRingtone()
 *  startRingback()  : caller ko "ring ho rahi hai" ki tone
 *  stopRingback()
 *  playMessageTone(): naye message / friend request par chhota "ding"
 *
 * Browser autoplay rule: AudioContext tabhi bajta hai jab page par kam se kam ek baar tap/click/key
 * hua ho. unlockAudio() isi liye pehle gesture par chalta hai.
 */
const RING_CYCLE_MS = 2800;
const RINGBACK_CYCLE_MS = 4000;

let ctx = null;
let enabled = true;
let ringTimer = null;
let ringVibe = null;
let backTimer = null;
let lastMessageTone = 0;
const live = { ring: new Set(), back: new Set() };

const getCtx = () => {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
};

export const unlockAudio = () => {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
};

export const setSoundEnabled = (on) => {
  enabled = Boolean(on);
  if (!enabled) {
    stopRingtone();
    stopRingback();
  }
};

// Ek note: chhota fade-in/out taaki click/pop awaaz na aaye
function tone(channel, freq, start, dur, vol = 0.2, type = "sine") {
  const c = getCtx();
  if (!c) return;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  gain.gain.setValueAtTime(vol, start + Math.max(0.03, dur - 0.05));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(gain);
  gain.connect(c.destination);

  const node = { osc, gain };
  live[channel]?.add(node);
  osc.onended = () => {
    live[channel]?.delete(node);
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      /* already disconnected */
    }
  };
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

// Pehle se schedule hui saari notes turant chup (stop dabane par ring ruk jaye)
function silence(channel) {
  if (!ctx) return;
  for (const n of live[channel]) {
    try {
      n.gain.gain.cancelScheduledValues(ctx.currentTime);
      n.gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      n.osc.stop();
    } catch {
      /* already stopped */
    }
  }
  live[channel].clear();
}

const vibrate = (pattern) => {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* not supported */
  }
};

// -------------------------------------------------------------- incoming call
export function startRingtone() {
  if (!enabled || ringTimer) return;
  const c = getCtx();
  if (!c) return;
  unlockAudio();

  const cycle = () => {
    const t = c.currentTime + 0.05;
    // do baar "ring-ring" (4 notes), phir pause
    for (let burst = 0; burst < 2; burst++) {
      const b = t + burst * 0.95;
      [988, 784, 988, 784].forEach((f, i) => tone("ring", f, b + i * 0.2, 0.17, 0.22, "triangle"));
    }
    ringTimer = setTimeout(cycle, RING_CYCLE_MS);
  };
  cycle();

  vibrate([500, 250, 500]);
  ringVibe = setInterval(() => vibrate([500, 250, 500]), RING_CYCLE_MS);
}

export function stopRingtone() {
  clearTimeout(ringTimer);
  ringTimer = null;
  clearInterval(ringVibe);
  ringVibe = null;
  silence("ring");
  vibrate(0);
}

// ----------------------------------------------------------- outgoing (caller)
export function startRingback() {
  if (!enabled || backTimer) return;
  const c = getCtx();
  if (!c) return;
  unlockAudio();

  const cycle = () => {
    tone("back", 425, c.currentTime + 0.05, 1.0, 0.07, "sine");
    backTimer = setTimeout(cycle, RINGBACK_CYCLE_MS);
  };
  cycle();
}

export function stopRingback() {
  clearTimeout(backTimer);
  backTimer = null;
  silence("back");
}

// ------------------------------------------------------------------- message
export function playMessageTone() {
  if (!enabled) return;
  const now = Date.now();
  if (now - lastMessageTone < 400) return; // ek saath kai message aaye to ek hi ding
  lastMessageTone = now;

  const c = getCtx();
  if (!c) return;
  unlockAudio();

  const t = c.currentTime + 0.01;
  tone("msg", 880, t, 0.12, 0.18);
  tone("msg", 1175, t + 0.13, 0.2, 0.18);
}
