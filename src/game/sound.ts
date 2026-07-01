/**
 * Game sound effects.
 *
 * CC0 audio samples ship in `src/assets/sfx/` and are used by default. Each
 * effect loads `src/assets/sfx/<name>.{mp3,ogg,wav,m4a}` (e.g. deal.wav,
 * knock.mp3, coin.mp3) — replace those files with your own CC0 clips to
 * customize (see that folder's README). If a sample is absent the effect falls
 * back to a synthesized Web Audio version, tuned to be soft and realistic for
 * the deal and a solid wooden "tock" for the knock.
 */

/* ── Optional sample overrides (build-time glob) ── */
const sfxModules = import.meta.glob("../assets/sfx/*.{mp3,ogg,wav,m4a}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function sampleUrl(name: string): string | undefined {
  const key = Object.keys(sfxModules).find((k) => k.split("/").pop()!.startsWith(`${name}.`));
  return key ? sfxModules[key] : undefined;
}

/** Play a sample at the given volume; returns false if no sample exists. */
function playSample(name: string, volume: number): boolean {
  const url = sampleUrl(name);
  if (!url) return false;
  const a = new Audio(url);
  a.volume = volume;
  a.play().catch(() => {
    /* autoplay gesture not granted yet */
  });
  return true;
}

/* ── Synth fallback ── */
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Browsers (esp. iOS/Chrome) start the context suspended until a user gesture;
  // resume so queued sounds actually play.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Unlock audio on the first user interaction — until then the AudioContext is
// suspended and the very first sound would be dropped silently.
if (typeof window !== "undefined") {
  const unlock = () => {
    ac();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock);
}

/** Soft card-deal "swish" — low, brief, gentle (not tinny). */
export function sndDeal() {
  if (playSample("deal", 0.35)) return;
  const a = ac();
  if (!a) return;
  const dur = 0.07;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // soft attack, smooth decay — avoids the clicky/tinny edge
    const env = Math.sin((Math.PI * i) / data.length);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = a.createBufferSource();
  src.buffer = buffer;
  // Band-limit to a papery mid band rather than a harsh high hiss.
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1100;
  bp.Q.value = 0.8;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3200;
  const g = a.createGain();
  g.gain.value = 0.07; // quiet
  src.connect(bp).connect(lp).connect(g).connect(a.destination);
  src.start();
}

export function sndShuffle() {
  for (let i = 0; i < 9; i++) setTimeout(sndDeal, i * 55 + Math.random() * 20);
}

/** Solid knock on wood — a resonant low "tock" with a short transient, ×2. */
export function sndKnock() {
  // If a real sample exists, play it twice for a "knock-knock" double rap.
  if (sampleUrl("knock")) {
    playSample("knock", 0.9);
    setTimeout(() => playSample("knock", 0.9), 250);
    return;
  }
  const a = ac();
  if (!a) return;
  const hit = (t: number) => {
    const t0 = a.currentTime + t;
    // Resonant body of the knock
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(220, t0);
    o.frequency.exponentialRampToValueAtTime(110, t0 + 0.1);
    const og = a.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.85, t0 + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(og).connect(a.destination);
    o.start(t0);
    o.stop(t0 + 0.18);

    // Sharp wooden transient (the initial "t")
    const nb = a.createBuffer(1, Math.floor(a.sampleRate * 0.03), a.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    const ns = a.createBufferSource();
    ns.buffer = nb;
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 260;
    bp.Q.value = 3;
    const ng = a.createGain();
    ng.gain.value = 0.5;
    ns.connect(bp).connect(ng).connect(a.destination);
    ns.start(t0);
  };
  hit(0);
  hit(0.16);
}

/** Bright metallic coin ping for losing a token. */
export function sndCoin() {
  if (playSample("coin", 0.4)) return;
  const a = ac();
  if (!a) return;
  [900, 1350, 1800].forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    const t0 = a.currentTime + i * 0.012;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + 0.55);
  });
}
