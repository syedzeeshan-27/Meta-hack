// Always-on mic with simple energy-based voice activity detection.
// Emits one 16 kHz mono WAV per utterance, the format /api/transcribe takes.

import { toWav } from "./wav-recorder";

const START_MS = 150; // this long above the threshold = someone started talking
const END_SILENCE_MS = 800; // this long below it = they finished
const MIN_SPEECH_MS = 400; // shorter blips (a cough, a clank) are dropped
const MAX_UTTERANCE_MS = 15000;
const PRE_ROLL_MS = 300; // kept from before the start so first syllables aren't cut
const TAIL_MS = 250; // silence kept after the last loud chunk
const RESUME_GRACE_MS = 300; // ignore the tail of our own voice right after we stop talking

// Speech threshold: FLOOR_RATIO x the room's noise floor (~10 dB above it), never below MIN_THRESHOLD.
const FLOOR_RATIO = 3;
const MIN_THRESHOLD = 0.012;
const MAX_FLOOR = 0.05;

// Barge-in while we're speaking: must beat our own voice coming back through the mic.
const BARGE_MS = 300;
const BARGE_RATIO = 1.8; // x the recent peak of our own (echoed) voice
const BARGE_MIN = 0.06;
const BARGE_WARMUP_MS = 400; // let the echo tracker catch the start of each reply
const ECHO_DECAY = 0.985; // per chunk, ~1 s half-life at 48 kHz / 1024

export type VadHandlers = {
  onSpeechStart?: () => void;
  /** Speech started but was too short, or was cut off by pause(). */
  onSpeechCancel?: () => void;
  onUtterance: (wav: Blob, speechMs: number) => void;
  /** 0..1 on a log scale, roughly 40 times a second. */
  onLevel?: (level: number) => void;
  /** The person talked over us; speechSynthesis is already cancelled. */
  onBargeIn?: () => void;
};

export type Vad = {
  stop: () => void;
  /** Stop listening. With allowBargeIn (the default), loud speech still breaks through. */
  pause: (allowBargeIn?: boolean) => void;
  resume: () => void;
};

export async function startVad(h: VadHandlers): Promise<Vad> {
  // Create the context before the first await so it belongs to the user's tap (iOS won't start it otherwise).
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {});
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    void ctx.close();
    throw err;
  }
  const rate = ctx.sampleRate;
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but works on every mobile browser without a worklet file.
  const node = ctx.createScriptProcessor(1024, 1, 1);

  let mode: "live" | "paused" | "muted" = "live";
  let floor = 0.006;
  let echo = 0;
  let above = 0;
  let grace = 0;
  let warmup = 0;
  let ring: Float32Array[] = [];
  let ringMs = 0;

  let inSpeech = false;
  let chunks: Float32Array[] = [];
  let hold = MIN_THRESHOLD;
  let sinceStart = 0;
  let spanMs = 0; // start → end of the last loud chunk
  let lastLoud = 0; // chunk count at the last loud chunk
  let silence = 0;

  const msOf = (c: Float32Array) => (c.length / rate) * 1000;
  const threshold = () => Math.max(MIN_THRESHOLD, floor * FLOOR_RATIO);

  function begin() {
    inSpeech = true;
    chunks = ring;
    ring = [];
    ringMs = 0;
    hold = threshold();
    sinceStart = above;
    spanMs = above;
    lastLoud = chunks.length;
    silence = 0;
    above = 0;
    h.onSpeechStart?.();
  }

  function drop() {
    if (!inSpeech) return;
    inSpeech = false;
    chunks = [];
    h.onSpeechCancel?.();
  }

  function finish() {
    inSpeech = false;
    const kept = chunks.slice(0, lastLoud);
    let tail = 0;
    for (let i = lastLoud; i < chunks.length && tail < TAIL_MS; i++) {
      kept.push(chunks[i]);
      tail += msOf(chunks[i]);
    }
    chunks = [];
    if (spanMs < MIN_SPEECH_MS) h.onSpeechCancel?.();
    else h.onUtterance(toWav(kept, rate), Math.round(spanMs));
  }

  node.onaudioprocess = (e) => {
    const x = new Float32Array(e.inputBuffer.getChannelData(0));
    const ms = msOf(x);
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / x.length);
    h.onLevel?.(Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-8) + 60) / 50)));
    if (mode === "muted") return;

    if (inSpeech) {
      chunks.push(x);
      sinceStart += ms;
      // A little hysteresis so soft word endings don't count as silence.
      if (rms > hold * 0.75) {
        silence = 0;
        spanMs = sinceStart;
        lastLoud = chunks.length;
      } else silence += ms;
      if (silence >= END_SILENCE_MS || sinceStart >= MAX_UTTERANCE_MS) finish();
      return;
    }

    ring.push(x);
    ringMs += ms;
    while (ring.length > 1 && ringMs - msOf(ring[0]) >= PRE_ROLL_MS + START_MS) ringMs -= msOf(ring.shift()!);

    if (mode === "paused") {
      if (warmup > 0) {
        warmup -= ms;
        echo = Math.max(rms, echo * ECHO_DECAY);
        return;
      }
      const bargeAt = Math.max(BARGE_MIN, echo * BARGE_RATIO);
      if (rms > bargeAt) {
        above += ms;
        if (above >= BARGE_MS) {
          mode = "live";
          window.speechSynthesis?.cancel();
          h.onBargeIn?.();
          begin();
        }
      } else {
        above = 0;
        echo = Math.max(rms, echo * ECHO_DECAY);
      }
      return;
    }

    if (grace > 0) {
      grace -= ms;
      return;
    }
    if (rms > threshold()) {
      above += ms;
      if (above >= START_MS) begin();
    } else {
      above = 0;
      // Follow the room down fast and up slowly, so speech doesn't drag the floor up.
      floor = Math.min(MAX_FLOOR, floor + (rms - floor) * (rms < floor ? 0.1 : 0.01));
    }
  };
  source.connect(node);
  node.connect(ctx.destination);

  // iOS suspends the context when other audio (our own speech) grabs the session; nudge it back.
  let stopped = false;
  const wake = () => {
    if (!stopped && ctx.state !== "running") void ctx.resume().catch(() => {});
  };
  ctx.onstatechange = wake;
  document.addEventListener("visibilitychange", wake);

  return {
    stop() {
      stopped = true;
      document.removeEventListener("visibilitychange", wake);
      node.onaudioprocess = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
    pause(allowBargeIn = true) {
      drop();
      above = 0;
      warmup = BARGE_WARMUP_MS;
      mode = allowBargeIn ? "paused" : "muted";
    },
    resume() {
      if (mode === "live") return;
      mode = "live";
      above = 0;
      grace = RESUME_GRACE_MS;
      // The pre-roll heard our own voice; don't glue it onto the next question.
      ring = [];
      ringMs = 0;
      wake();
    },
  };
}
