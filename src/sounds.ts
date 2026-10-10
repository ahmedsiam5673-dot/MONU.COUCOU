import { invoke } from "@tauri-apps/api/core";

type Seq = [number, number][];

/** 28 short original sounds, synthesised with Web Audio. Users can override any by name. */
export const DEFS: Record<string, Seq> = {
  hello: [[523, 0.08], [659, 0.08], [784, 0.14]],
  bye: [[784, 0.08], [523, 0.16]],
  peek: [[600, 0.05], [800, 0.07]],
  open: [[660, 0.07], [880, 0.1]],
  close: [[880, 0.06], [600, 0.09]],
  click: [[420, 0.05]],
  tick: [[900, 0.03]],
  annoyed: [[330, 0.08], [260, 0.1]],
  dizzy: [[300, 0.12], [250, 0.12], [300, 0.12], [220, 0.2]],
  jump: [[500, 0.05], [700, 0.08]],
  dance: [[440, 0.1], [550, 0.1], [440, 0.1], [660, 0.12]],
  approval: [[520, 0.1], [780, 0.14]],
  question: [[440, 0.08], [554, 0.08], [660, 0.12]],
  alert: [[880, 0.06], [880, 0.06], [1100, 0.12]],
  allow: [[660, 0.07], [990, 0.12]],
  deny: [[400, 0.09], [280, 0.14]],
  always: [[660, 0.06], [880, 0.06], [1100, 0.1]],
  finish: [[784, 0.1], [988, 0.1], [1318, 0.16]],
  error: [[220, 0.14], [180, 0.2]],
  notify: [[740, 0.07], [988, 0.1]],
  message: [[600, 0.05], [760, 0.07]],
  send: [[500, 0.04], [800, 0.06]],
  drop: [[500, 0.08], [350, 0.1], [250, 0.14]],
  swallow: [[300, 0.06], [420, 0.06], [200, 0.16]],
  wardrobe: [[700, 0.08], [900, 0.08]],
  mute: [[500, 0.07], [350, 0.1]],
  unmute: [[350, 0.07], [500, 0.1]],
  wake: [[392, 0.08], [523, 0.08], [659, 0.1], [784, 0.14]],
};

let ac: AudioContext | null = null;
let muted = false;
const custom = new Map<string, AudioBuffer>();

const ctx = () => (ac ??= new AudioContext());
export const setMuted = (m: boolean) => (muted = m);
export const isMuted = () => muted;

export async function loadCustomSounds() {
  custom.clear();
  for (const name of Object.keys(DEFS)) {
    try {
      const b64 = await invoke<string | null>("read_sound", { name });
      if (!b64) continue;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      custom.set(name, await ctx().decodeAudioData(bin.buffer));
    } catch {
      /* ignore broken files */
    }
  }
}

export function play(name: keyof typeof DEFS | string, vol = 1) {
  if (muted) return;
  try {
    const c = ctx();
    if (c.state === "suspended") void c.resume();
    const buf = custom.get(name);
    if (buf) {
      const s = c.createBufferSource();
      const g = c.createGain();
      g.gain.value = vol;
      s.buffer = buf;
      s.connect(g).connect(c.destination);
      s.start();
      return;
    }
    const seq = DEFS[name];
    if (!seq) return;
    let t = c.currentTime;
    for (const [f, d] of seq) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.07 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + d);
      t += d * 0.8;
    }
  } catch {
    /* audio unavailable */
  }
}
