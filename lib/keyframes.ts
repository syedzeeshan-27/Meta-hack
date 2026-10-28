// Keyframe sampler for the walkthrough.
// About four times a second it draws the camera onto a small canvas and asks: is this a new view?
// It keeps a full-size JPEG only when the view has changed enough since the last kept frame, or, while the
// camera is held steady, every few seconds if anything changed at all. Dark and blurry frames are skipped.
// Browser only (needs a <video> and canvas).

export type Keyframe = {
  /** JPEG data URL */
  image: string;
  width: number;
  height: number;
  /** ms since epoch, when the frame was seen */
  t: number;
};

export type SkipReason = "dark" | "blurry";

export const KEYFRAME_DEFAULTS = {
  /** How often the camera is looked at. */
  sampleEveryMs: 250,
  /** Mean absolute luma difference (0-255, exposure-normalised, 32 px thumbnail) vs the last kept frame that counts as a new view. */
  changeThreshold: 14,
  /** Never keep two frames closer together than this. */
  // Indexing a frame takes ~15 s server-side (5 at once), so more than one frame every ~3 s just queues up.
  minGapMs: 3000,
  /** While the camera is steady, keep a frame this often even for small changes... */
  refreshEveryMs: 8000,
  /** ...as long as the view differs at least this much (above sensor noise). */
  refreshMinDiff: 3,
  /** Difference between two consecutive samples below which the camera counts as steady. */
  steadyMotion: 6,
  /** After a change, wait at most this long for the camera to settle, keeping the sharpest sample meanwhile. */
  settleWaitMs: 1200,
  /** If every sample is blurry for this long after a change, give up on that change and report it. */
  giveUpMs: 3000,
  /** Longest side of the saved JPEG. */
  maxSide: 1024,
  quality: 0.82,
  /** Mean luma (0-255) below which a frame is too dark to be useful. */
  minBrightness: 28,
  /** Absolute floor for edge energy (mean |Laplacian| on the 160 px analysis canvas). Low on purpose: plain walls are real. */
  minSharpness: 1,
  /** A frame is blurry if its edge energy is below this share of the recent median. */
  relSharpness: 0.45,
};

export type KeyframeOptions = Partial<typeof KEYFRAME_DEFAULTS> & {
  onKeyframe: (frame: Keyframe) => void;
  /** "dark": this sample was too dark (fires every sample while dark). "blurry": a new view went uncaught for giveUpMs. */
  onSkip?: (reason: SkipReason) => void;
};

export type KeyframeSampler = {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  /** Forget the last kept frame, so the next good frame is kept straight away (e.g. on entering a new room). */
  reset(): void;
};

const ANALYSIS_LONG_SIDE = 160;
const THUMB_BLOCK = 5; // 160 / 5 = 32 px thumbnail for the change check
const SHARPNESS_HISTORY = 16; // ~4 s of samples

type Thumb = { w: number; h: number; data: Float32Array };
type Sample = { thumb: Thumb; brightness: number; sharpness: number };
type Pending = { since: number; best: { sharpness: number; thumb: Thumb; t: number } | null };

export function createKeyframeSampler(video: HTMLVideoElement, options: KeyframeOptions): KeyframeSampler {
  const o = { ...KEYFRAME_DEFAULTS, ...options };
  const small = document.createElement("canvas");
  const sctx = small.getContext("2d", { willReadFrequently: true });
  // Holds the best candidate for the next keyframe at full size until it's committed.
  const full = document.createElement("canvas");
  const fctx = full.getContext("2d");

  let timer: ReturnType<typeof setInterval> | null = null;
  let paused = false;
  let kept: Thumb | null = null;
  let lastKeptAt = 0;
  let prev: Thumb | null = null;
  let pending: Pending | null = null;
  const sharpHistory: number[] = [];

  function analyse(): Sample | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!sctx || !vw || !vh || video.readyState < 2) return null;
    const scale = ANALYSIS_LONG_SIDE / Math.max(vw, vh);
    const aw = Math.max(THUMB_BLOCK * 2, Math.round((vw * scale) / THUMB_BLOCK) * THUMB_BLOCK);
    const ah = Math.max(THUMB_BLOCK * 2, Math.round((vh * scale) / THUMB_BLOCK) * THUMB_BLOCK);
    if (small.width !== aw) small.width = aw;
    if (small.height !== ah) small.height = ah;
    sctx.drawImage(video, 0, 0, aw, ah);
    let px: Uint8ClampedArray;
    try {
      px = sctx.getImageData(0, 0, aw, ah).data;
    } catch {
      return null;
    }

    const luma = new Float32Array(aw * ah);
    let sum = 0;
    for (let i = 0; i < luma.length; i++) {
      const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      luma[i] = l;
      sum += l;
    }
    const brightness = sum / luma.length;

    // Edge energy: mean absolute Laplacian. Motion blur and missed focus pull it down.
    let lap = 0;
    for (let y = 1; y < ah - 1; y++) {
      for (let x = 1; x < aw - 1; x++) {
        const i = y * aw + x;
        lap += Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - aw] - luma[i + aw]);
      }
    }
    const sharpness = lap / ((aw - 2) * (ah - 2));

    // Thumbnail: block averages, minus their mean so auto-exposure swings don't look like a new view.
    const tw = aw / THUMB_BLOCK;
    const th = ah / THUMB_BLOCK;
    const data = new Float32Array(tw * th);
    let tsum = 0;
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        let s = 0;
        for (let y = 0; y < THUMB_BLOCK; y++) {
          const row = (ty * THUMB_BLOCK + y) * aw + tx * THUMB_BLOCK;
          for (let x = 0; x < THUMB_BLOCK; x++) s += luma[row + x];
        }
        const v = s / (THUMB_BLOCK * THUMB_BLOCK);
        data[ty * tw + tx] = v;
        tsum += v;
      }
    }
    const tmean = tsum / data.length;
    for (let i = 0; i < data.length; i++) data[i] -= tmean;

    return { thumb: { w: tw, h: th, data }, brightness, sharpness };
  }

  function grabFull() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, o.maxSide / Math.max(vw, vh));
    full.width = Math.round(vw * scale);
    full.height = Math.round(vh * scale);
    fctx?.drawImage(video, 0, 0, full.width, full.height);
  }

  function commit() {
    const best = pending?.best;
    pending = null;
    if (!best || !fctx) return;
    let image: string;
    try {
      image = full.toDataURL("image/jpeg", o.quality);
    } catch {
      return;
    }
    kept = best.thumb;
    lastKeptAt = Date.now();
    o.onKeyframe({ image, width: full.width, height: full.height, t: best.t });
  }

  function tick() {
    if (paused || document.visibilityState !== "visible") return;
    const s = analyse();
    if (!s) return;
    const motion = prev ? diff(s.thumb, prev) : 255;
    prev = s.thumb;
    const now = Date.now();

    if (s.brightness < o.minBrightness) {
      o.onSkip?.("dark");
      return;
    }

    sharpHistory.push(s.sharpness);
    if (sharpHistory.length > SHARPNESS_HISTORY) sharpHistory.shift();
    const blurry = s.sharpness < Math.max(o.minSharpness, o.relSharpness * median(sharpHistory));
    const steady = motion < o.steadyMotion;

    if (!pending) {
      const sinceKept = now - lastKeptAt;
      const d = kept ? diff(s.thumb, kept) : 255;
      const changed = d >= o.changeThreshold && sinceKept >= o.minGapMs;
      const refresh = steady && sinceKept >= o.refreshEveryMs && d >= o.refreshMinDiff;
      if (!changed && !refresh) return;
      pending = { since: now, best: null };
    }

    if (!blurry && (!pending.best || s.sharpness > pending.best.sharpness)) {
      grabFull();
      pending.best = { sharpness: s.sharpness, thumb: s.thumb, t: now };
    }

    if (pending.best && (steady || now - pending.since >= o.settleWaitMs)) commit();
    else if (!pending.best && now - pending.since >= o.giveUpMs) {
      // Nothing sharp for a while: drop this change (the next tick starts a fresh one) and say so.
      pending = null;
      o.onSkip?.("blurry");
    }
  }

  return {
    start() {
      if (!timer) timer = setInterval(tick, o.sampleEveryMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      pending = null;
      prev = null;
    },
    pause() {
      paused = true;
      pending = null;
      prev = null;
    },
    resume() {
      paused = false;
    },
    reset() {
      kept = null;
      lastKeptAt = 0;
      pending = null;
    },
  };
}

/** Mean absolute difference of two thumbnails; a size change (phone rotated) counts as a whole new view. */
function diff(a: Thumb, b: Thumb): number {
  if (a.w !== b.w || a.h !== b.h) return 255;
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / a.data.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
