// The sound test: record the device for a few seconds with the browser's voice processing OFF (noise
// suppression treats a steady motor hum as noise and removes it), measure the spectrum, and describe it in
// words for Muse Spark: the hum and its pitch, grinding/hiss, clicking, loudness.
// Phone mics are weak below ~100 Hz, so a 50 Hz hum mostly shows up as its 100/150/200 Hz partners.

const FFT = 8192;
const TICK_MS = 50;
export const BANDS = 28;

export type ListenResult = { summary: string; processingOff: boolean; levelDb: number };

export class ListenNeedsTap extends Error {
  constructor() {
    super("The browser needs a tap before it can record.");
  }
}

/** Records `seconds` of sound and returns a plain-English measurement. `onBands` gets 0..1 levels for a live meter. */
export async function listenToDevice(seconds: number, onBands?: (bands: number[]) => void): Promise<ListenResult> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  if (ctx.state !== "running") {
    void ctx.close();
    throw new ListenNeedsTap();
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    void ctx.close();
    throw err;
  }
  const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
  const processingOff = settings.noiseSuppression !== true && settings.autoGainControl !== true;

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const rate = ctx.sampleRate;
  const binHz = rate / FFT;
  const spec = new Float32Array(analyser.frequencyBinCount);
  const wave = new Float32Array(FFT);
  const power = new Float64Array(analyser.frequencyBinCount);
  const envelope: number[] = [];
  let frames = 0;

  try {
    // Let the mic settle before measuring.
    await sleep(250);
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      analyser.getFloatFrequencyData(spec);
      analyser.getFloatTimeDomainData(wave);
      for (let i = 0; i < spec.length; i++) power[i] += Number.isFinite(spec[i]) ? 10 ** (spec[i] / 10) : 0;
      let sum = 0;
      for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
      envelope.push(Math.sqrt(sum / wave.length));
      frames++;
      onBands?.(bands(spec, binHz));
      await sleep(TICK_MS);
    }
  } finally {
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  }

  const db = Array.from(power, (p) => 10 * Math.log10(p / Math.max(1, frames) + 1e-20));
  return { ...describe(db, binHz, envelope, seconds, processingOff), processingOff };
}

// ---------- analysis ----------

function describe(db: number[], binHz: number, env: number[], seconds: number, processingOff: boolean) {
  const at = (hz: number) => Math.round(hz / binHz);
  const rms = env.reduce((s, v) => s + v, 0) / Math.max(1, env.length);
  const levelDb = Math.round(20 * Math.log10(rms + 1e-9));

  // Prominence of a frequency: its strongest bin within ±3 Hz against the median of ±60 Hz around it.
  const prominence = (hz: number) => {
    const c = at(hz);
    const w = Math.max(1, Math.round(3 / binHz));
    let peak = -Infinity;
    for (let i = c - w; i <= c + w; i++) peak = Math.max(peak, db[i] ?? -Infinity);
    const around: number[] = [];
    for (let i = at(hz - 60); i <= at(hz + 60); i++) if (Math.abs(i - c) > w && db[i] !== undefined) around.push(db[i]);
    return peak - median(around);
  };

  // Strongest narrow peaks between 40 Hz and 4 kHz.
  const peaks: { hz: number; prom: number }[] = [];
  for (let i = at(40); i < Math.min(db.length - 1, at(4000)); i++) {
    if (db[i] < db[i - 1] || db[i] < db[i + 1]) continue;
    const hz = i * binHz;
    const prom = prominence(hz);
    if (prom >= 10) peaks.push({ hz, prom });
  }
  peaks.sort((a, b) => b.prom - a.prom);
  const top: { hz: number; prom: number }[] = [];
  for (const p of peaks) if (top.length < 4 && top.every((t) => Math.abs(t.hz - p.hz) > 15)) top.push(p);

  const hum = [50, 100, 150, 200, 300]
    .map((hz) => ({ hz, prom: prominence(hz) }))
    .filter((h) => h.prom >= 8);

  // Spectral flatness 300 Hz - 6 kHz: near 1 = noise-like (hiss, grinding, air), near 0 = tonal.
  let logSum = 0;
  let linSum = 0;
  let n = 0;
  for (let i = at(300); i < Math.min(db.length, at(6000)); i++) {
    const p = 10 ** (db[i] / 10);
    logSum += Math.log(p + 1e-20);
    linSum += p;
    n++;
  }
  const flatness = n ? Math.exp(logSum / n) / (linSum / n) : 0;

  // Clicks/knocks: sudden jumps in loudness.
  const envDb = env.map((v) => 20 * Math.log10(v + 1e-9));
  const base = median(envDb);
  let clicks = 0;
  for (let i = 1; i < envDb.length; i++) if (envDb[i] - Math.max(envDb[i - 1], base) > 8) clicks++;
  const steadiness = stdev(envDb);

  const loud = levelDb > -30 ? "loud" : levelDb > -45 ? "clearly audible" : levelDb > -58 ? "quiet" : "almost silent";
  const parts = [
    `[Sound test] ${seconds} s recorded with the phone near the device${processingOff ? "" : " (the phone kept its noise filter on, so steady hums may be weakened)"}.`,
    `Overall: ${loud} (${levelDb} dBFS), ${steadiness < 3 ? "steady" : steadiness < 7 ? "a bit uneven" : "very uneven"} loudness.`,
    hum.length
      ? `Mains-type hum: ${hum.map((h) => `${h.hz} Hz (+${Math.round(h.prom)} dB)`).join(", ")}. A steady 100 Hz hum usually means a motor or transformer is getting power.`
      : "No mains-type hum.",
    top.length ? `Strongest tones: ${top.map((t) => `${Math.round(t.hz)} Hz (+${Math.round(t.prom)} dB)`).join(", ")}.` : "No clear tones.",
    `Noise-like content (grinding, scraping, air): ${flatness > 0.35 ? "high" : flatness > 0.15 ? "some" : "low"} (flatness ${flatness.toFixed(2)}).`,
    clicks >= 2 ? `About ${Math.round(clicks / seconds)} clicks or knocks per second.` : "No regular clicking.",
  ];
  return { summary: parts.join(" "), levelDb };
}

/** Live meter: BANDS log-spaced bands from 60 Hz to 8 kHz, scaled 0..1 from -100..-30 dB. */
function bands(spec: Float32Array, binHz: number): number[] {
  const out: number[] = [];
  const lo = Math.log(60);
  const hi = Math.log(8000);
  for (let b = 0; b < BANDS; b++) {
    const from = Math.floor(Math.exp(lo + ((hi - lo) * b) / BANDS) / binHz);
    const to = Math.max(from + 1, Math.floor(Math.exp(lo + ((hi - lo) * (b + 1)) / BANDS) / binHz));
    let max = -Infinity;
    for (let i = from; i < to && i < spec.length; i++) max = Math.max(max, spec[i]);
    out.push(Math.max(0, Math.min(1, (max + 100) / 70)));
  }
  return out;
}

function median(xs: number[]): number {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : -Infinity;
}

function stdev(xs: number[]): number {
  const m = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
