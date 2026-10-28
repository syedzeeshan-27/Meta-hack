"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CameraView from "@/components/CameraView";
import type { Guide, Outline } from "@/lib/types";
import type { Frame, LiveEvent, LiveRequest, WatchResponse } from "@/lib/live-types";
import { startVad, type Vad } from "@/lib/vad";

const ASK_FRAME_WIDTH = 768;
const WATCH_FRAME_WIDTH = 512;
const WATCH_EVERY_MS = 3000;
const HISTORY_TURNS = 4;
const MEMORY_SHOWN = 3;
const REMARK_SHOWN_MS = 12000;
const SESSION_KEY = "fixcam.session";

type Phase = "listening" | "hearing" | "thinking" | "speaking";
type Overlay = { width: number; height: number; outlines: Outline[]; phrase: string };
type Source = { title: string; url: string };
type Turn = { question: string; answer: string };
type Memory = { t: number; caption: string };
type Activity = { hearing: boolean; transcribing: number; asking: boolean };

const PHASE_LABEL: Record<Phase, string> = {
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
};

export default function LiveView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  const vadRef = useRef<Vad | null>(null);
  const camRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef("");
  const historyRef = useRef<Turn[]>([]);
  const guideRef = useRef<Guide | null>(null);
  const stepRef = useRef<number | undefined>(undefined);
  const askRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0); // newest utterance
  const askedSeqRef = useRef(0); // utterance the current answer belongs to
  const reqRef = useRef(0);
  const voiceReqRef = useRef(0); // the answer still allowed to talk (0 = none)
  const ttsRef = useRef({ gen: 0, count: 0, misses: 0, live: new Set<SpeechSynthesisUtterance>() });
  const actRef = useRef<Activity>({ hearing: false, transcribing: 0, asking: false });
  const lastRemarkRef = useRef("");
  const watchFailsRef = useRef(0);

  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<"live" | "guide">("live");
  const [guide, setGuide] = useState<Guide | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [act, setAct] = useState<Activity>({ hearing: false, transcribing: 0, asking: false });
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [memory, setMemory] = useState<Memory[]>([]);
  const [watchModel, setWatchModel] = useState("");
  const [watchOff, setWatchOff] = useState(false);
  const [remark, setRemark] = useState<{ text: string; t: number } | null>(null);
  const [now, setNow] = useState(0);

  const phase: Phase = act.hearing
    ? "hearing"
    : speaking
      ? "speaking"
      : act.transcribing > 0 || act.asking
        ? "thinking"
        : "listening";

  function activity(patch: Partial<Activity>) {
    actRef.current = { ...actRef.current, ...patch };
    setAct(actRef.current);
  }

  // ---------- camera ----------

  async function openCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    camRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => {});
    }
  }

  function closeCamera() {
    camRef.current?.getTracks().forEach((t) => t.stop());
    camRef.current = null;
  }

  function captureFrame(maxWidth: number, quality: number): Frame | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { image: canvas.toDataURL("image/jpeg", quality), width: canvas.width, height: canvas.height };
  }

  // ---------- speech out: a queue of sentences on speechSynthesis ----------

  function speak(text: string) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const clean = forSpeech(text);
    if (!synth || !clean) return;
    const tts = ttsRef.current;
    const gen = tts.gen;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.05;
    const done = () => {
      tts.live.delete(u);
      if (gen !== tts.gen) return;
      tts.count = Math.max(0, tts.count - 1);
      if (!tts.count) setSpeaking(false);
    };
    u.onend = done;
    u.onerror = done;
    // Keep a reference: Chrome drops `onend` for utterances that get garbage-collected.
    tts.live.add(u);
    tts.count++;
    setSpeaking(true);
    synth.speak(u);
  }

  function stopSpeaking() {
    const tts = ttsRef.current;
    tts.gen++;
    tts.count = 0;
    tts.live.clear();
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  // ---------- one question: transcribe, then stream the answer ----------

  async function onUtterance(wav: Blob) {
    const seq = ++seqRef.current;
    // The frame at the moment they stopped talking: that's what they're asking about.
    const frame = captureFrame(ASK_FRAME_WIDTH, 0.8);
    activity({ hearing: false, transcribing: actRef.current.transcribing + 1 });
    let question = "";
    try {
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      const data = (await res.json()) as { transcript?: string; error?: string };
      if (data.error) throw new Error(data.error);
      question = (data.transcript ?? "").trim();
    } catch (err) {
      if (seq === seqRef.current) setError(`Didn't catch that: ${short(err)}`);
      return;
    } finally {
      activity({ transcribing: actRef.current.transcribing - 1 });
    }
    // Noise, or a newer question already got its answer started.
    if (!/[a-z0-9]{2,}/i.test(question) || isFiller(question) || seq < askedSeqRef.current || !frame) return;
    askedSeqRef.current = seq;
    void ask(question, frame);
  }

  async function ask(question: string, frame: Frame) {
    askRef.current?.abort();
    stopSpeaking();
    const ctrl = new AbortController();
    askRef.current = ctrl;
    const reqId = ++reqRef.current;
    voiceReqRef.current = reqId;
    setHeard(question);
    setAnswer("");
    setStatus("");
    setError("");
    setSources([]);
    setOverlay(null);
    setRemark(null);
    activity({ asking: true });

    let full = "";
    let spoken = 0;
    const talk = (final: boolean) => {
      const { sentences, used } = splitSentences(full.slice(spoken), final);
      spoken += used;
      if (voiceReqRef.current === reqId) sentences.forEach(speak);
    };

    const body: LiveRequest = {
      sessionId: sessionRef.current,
      question,
      frame,
      history: historyRef.current.slice(-HISTORY_TURNS),
      ...(guideRef.current ? { guide: guideRef.current, stepIndex: stepRef.current } : {}),
    };
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      for await (const ev of readEvents(res.body)) {
        if (ctrl.signal.aborted) return;
        if (ev.type === "text") {
          full += ev.delta;
          setAnswer(full);
          talk(false);
        } else if (ev.type === "outline") {
          if (ev.outlines.length) setOverlay({ width: ev.width, height: ev.height, outlines: ev.outlines, phrase: ev.phrase });
        } else if (ev.type === "sources") setSources(ev.items);
        else if (ev.type === "status") setStatus(ev.message);
        else if (ev.type === "guide") {
          voiceReqRef.current = 0; // the step view does its own talking
          openGuide(ev.guide);
        } else if (ev.type === "step") stepRef.current = ev.stepIndex;
        else if (ev.type === "error") throw new Error(ev.message);
        else if (ev.type === "done") break;
      }
      talk(true);
      if (full.trim()) historyRef.current = [...historyRef.current, { question, answer: full.trim() }].slice(-HISTORY_TURNS);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(short(err));
      if (voiceReqRef.current === reqId) speak("Sorry, something went wrong.");
    } finally {
      if (askRef.current === ctrl) {
        askRef.current = null;
        setStatus("");
        activity({ asking: false });
      }
    }
  }

  // ---------- start / stop ----------

  async function start() {
    // iOS only lets speech play after something was spoken inside a tap.
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
    setStarting(true);
    setError("");
    // startVad builds its AudioContext before awaiting, so it still counts as this tap.
    const vadP = startVad({
      onSpeechStart: () => activity({ hearing: true }),
      onSpeechCancel: () => activity({ hearing: false }),
      onUtterance: (wav) => void onUtterance(wav),
      onLevel: (level) => levelRef.current?.style.setProperty("--level", level.toFixed(3)),
      onBargeIn: () => {
        voiceReqRef.current = 0;
        stopSpeaking();
      },
    });
    const [mic, cam] = await Promise.allSettled([vadP, openCamera()]);
    if (mic.status === "rejected" || cam.status === "rejected") {
      if (mic.status === "fulfilled") mic.value.stop();
      closeCamera();
      setError(`Camera or mic blocked: ${short(mic.status === "rejected" ? mic.reason : (cam as PromiseRejectedResult).reason)}`);
      setStarting(false);
      return;
    }
    vadRef.current = mic.value;
    sessionRef.current = sessionId();
    setNow(Date.now());
    setStarted(true);
    setStarting(false);
    speak("I'm listening. Just talk.");
  }

  function openGuide(g: Guide) {
    guideRef.current = g;
    stepRef.current = 0;
    setGuide(g);
    stopSpeaking();
    // The step view opens the camera itself; phones won't share it between two streams.
    closeCamera();
    setView("guide");
  }

  // ---------- effects ----------

  // Listen unless muted, in the step view, or talking (then only a loud barge-in gets through).
  useEffect(() => {
    const vad = vadRef.current;
    if (!vad) return;
    if (muted || view !== "live") vad.pause(false);
    else if (speaking) vad.pause(true);
    else vad.resume();
  }, [started, muted, view, speaking]);

  // Back from the step view: the <video> is new, so open the camera again.
  useEffect(() => {
    if (!started || view !== "live" || camRef.current) return;
    openCamera().catch((err) => setError(`Camera blocked: ${short(err)}`));
  }, [started, view]);

  // Clock for "12s ago", and a watchdog for browsers that never fire `onend` (iOS).
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      setNow(Date.now());
      const tts = ttsRef.current;
      const synth = window.speechSynthesis;
      if (tts.count && synth && !synth.speaking && !synth.pending) {
        if (++tts.misses >= 2) {
          tts.misses = 0;
          tts.gen++;
          tts.count = 0;
          setSpeaking(false);
        }
      } else tts.misses = 0;
    }, 1000);
    return () => clearInterval(id);
  }, [started]);

  // The watcher: a small frame every few seconds while nobody is asking anything.
  useEffect(() => {
    if (!started || view !== "live" || watchOff) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const a = actRef.current;
      const frame = !a.hearing && !a.transcribing && !a.asking && document.visibilityState === "visible" ? captureFrame(WATCH_FRAME_WIDTH, 0.6) : null;
      if (frame) {
        try {
          const res = await fetch("/api/watch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sessionRef.current, frame }),
          });
          const data = (await res.json()) as WatchResponse & { error?: string };
          if (!res.ok || data.error || typeof data.caption !== "string") throw new Error(data.error ?? `HTTP ${res.status}`);
          watchFailsRef.current = 0;
          if (stopped) return;
          setWatchModel(data.model);
          if (data.caption) setMemory((m) => [...m, { t: Date.now(), caption: data.caption }].slice(-MEMORY_SHOWN));
          const b = actRef.current;
          const quiet = !b.hearing && !b.transcribing && !b.asking && !ttsRef.current.count;
          if (data.remark && quiet && data.remark !== lastRemarkRef.current) {
            lastRemarkRef.current = data.remark;
            setRemark({ text: data.remark, t: Date.now() });
            speak(data.remark);
          }
        } catch {
          // Not configured or down: stop quietly.
          if (++watchFailsRef.current >= 2) {
            setWatchOff(true);
            return;
          }
        }
      }
      if (!stopped) timer = setTimeout(tick, WATCH_EVERY_MS);
    };
    timer = setTimeout(tick, WATCH_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [started, view, watchOff]);

  useEffect(
    () => () => {
      askRef.current?.abort();
      vadRef.current?.stop();
      closeCamera();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  if (view === "guide" && guide) return <CameraView guide={guide} onExit={() => setView("live")} />;

  const showRemark = remark && !act.asking && now - remark.t < REMARK_SHOWN_MS;
  const showCard = heard || answer || error || act.asking;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black select-none">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {overlay && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${overlay.width} ${overlay.height}`}
          preserveAspectRatio="xMidYMid slice"
        >
          {overlay.outlines.map((o, i) => (
            <path
              key={`${o.id}-${i}`}
              d={o.path}
              transform={o.transform}
              className="part-outline"
              vectorEffect="non-scaling-stroke"
              strokeWidth={4}
            />
          ))}
        </svg>
      )}

      {!started ? (
        <section className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-black via-black/90 to-black px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-center">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">FixCam Live</h1>
            <p className="mt-2 text-white/60">Point your phone at it and just talk. No buttons.</p>
          </div>
          <button
            onClick={start}
            disabled={starting}
            className="h-36 w-36 rounded-full bg-cyan-400 text-xl font-semibold text-black shadow-[0_0_60px_rgb(34_211_238/0.5)] disabled:opacity-60"
          >
            {starting ? "Starting…" : "Start"}
          </button>
          <p className="max-w-xs text-xs text-white/40">Uses your camera, microphone and speaker. Ask things like &ldquo;what&rsquo;s this part?&rdquo; or &ldquo;how do I fix this?&rdquo;</p>
          <Link href="/guide" className="text-sm text-white/60 underline underline-offset-4">
            Step-by-step mode
          </Link>
          {error && <p className="max-w-xs text-sm text-red-400">{error}</p>}
        </section>
      ) : (
        <>
          {/* Top bar + memory strip */}
          <section className="absolute inset-x-0 top-0 flex flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium backdrop-blur">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                FixCam Live
              </span>
              <div className="flex items-center gap-2">
                {guide && (
                  <button onClick={() => openGuide(guide)} className="rounded-full bg-black/60 px-3 py-1 text-xs backdrop-blur">
                    Steps
                  </button>
                )}
                <Link href="/guide" className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 backdrop-blur">
                  Step-by-step mode
                </Link>
              </div>
            </div>
            {memory.length > 0 && (
              <div className="self-start rounded-xl bg-black/50 px-3 py-2 text-[11px] leading-snug backdrop-blur">
                <p className="mb-0.5 text-[10px] uppercase tracking-wider text-cyan-300/80">
                  Memory{watchModel && <span className="normal-case tracking-normal text-white/40"> · {watchModel}</span>}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {memory
                    .slice()
                    .reverse()
                    .map((m) => (
                      <li key={m.t} className="text-white/75">
                        {m.caption} <span className="text-white/40">· {ago(now, m.t)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>

          {/* Answer + controls */}
          <section className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {showRemark && (
              <div className="self-start rounded-2xl bg-cyan-400/90 px-3 py-2 text-sm text-black shadow-lg">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider">Noticed</span>
                {remark.text}
              </div>
            )}
            {showCard && (
              <div className="max-h-[42dvh] overflow-y-auto rounded-2xl bg-black/70 p-4 backdrop-blur">
                {heard && <p className="text-sm text-white/50">You: &ldquo;{heard}&rdquo;</p>}
                {answer ? (
                  <p className="mt-1 whitespace-pre-wrap text-base leading-snug">{answer}</p>
                ) : act.asking ? (
                  <p className="mt-1 text-base text-white/60">Thinking…</p>
                ) : null}
                {act.asking && status && <p className="mt-2 text-xs text-white/40">{status}</p>}
                {overlay && <p className="mt-2 text-xs text-cyan-300">Outlined: {overlay.phrase}</p>}
                {sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {sources.map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        title={s.title}
                        className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/70"
                      >
                        {hostname(s.url)}
                      </a>
                    ))}
                  </div>
                )}
                {error && <p className="mt-2 break-words text-xs text-red-400">{error}</p>}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => setMuted((m) => !m)}
                className={`w-20 rounded-full px-3 py-2 text-xs font-medium backdrop-blur ${muted ? "bg-red-500 text-white" : "bg-black/60 text-white/80"}`}
              >
                {muted ? "Mic off" : "Mute"}
              </button>

              <button
                onClick={() => {
                  if (speaking) {
                    voiceReqRef.current = 0;
                    stopSpeaking();
                  } else if (muted) setMuted(false);
                }}
                aria-label={muted ? "Microphone off" : PHASE_LABEL[phase]}
                className="flex flex-col items-center gap-1.5"
              >
                <span className="relative flex h-16 w-16 items-center justify-center">
                  <span
                    ref={levelRef}
                    className={`mic-level absolute inset-0 rounded-full ${muted ? "bg-white/10" : phase === "hearing" ? "bg-cyan-400/50" : "bg-white/20"}`}
                  />
                  {phase === "thinking" && !muted && (
                    <span className="absolute inset-0 animate-spin rounded-full border-2 border-white/20 border-t-cyan-300" />
                  )}
                  <span
                    className={`relative h-10 w-10 rounded-full ${
                      muted ? "bg-white/30" : phase === "speaking" ? "mic-speak bg-cyan-300" : phase === "hearing" ? "bg-cyan-300" : "bg-white"
                    }`}
                  />
                </span>
                <span className="text-[11px] font-medium text-white/80 drop-shadow">
                  {muted ? "Mic off" : phase === "speaking" ? "Speaking · tap to stop" : `${PHASE_LABEL[phase]}…`}
                </span>
              </button>

              <span className="w-20" />
            </div>
          </section>
        </>
      )}
    </main>
  );
}

/** SSE over a POST body: `data: <json>` blocks separated by a blank line. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<LiveEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += decoder.decode(value, { stream: !done }).replace(/\r/g, "");
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const ev = parseEvent(buf.slice(0, cut));
        buf = buf.slice(cut + 2);
        if (ev) yield ev;
      }
      if (done) {
        const ev = parseEvent(buf);
        if (ev) yield ev;
        return;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function parseEvent(block: string): LiveEvent | null {
  const data = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as LiveEvent;
  } catch {
    return null;
  }
}

/** Complete sentences at the start of `text` (end punctuation + space, or a line break). */
function splitSentences(text: string, final: boolean): { sentences: string[]; used: number } {
  const sentences: string[] = [];
  const re = /[.!?]+["')\]]*\s+|\n+/g;
  let used = 0;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const s = text.slice(used, end).trim();
    // "1." alone is a list number, not a sentence: keep it with what follows.
    if (!/[a-z]/i.test(s)) continue;
    sentences.push(s);
    used = end;
  }
  if (final && /[a-z0-9]/i.test(text.slice(used))) {
    sentences.push(text.slice(used).trim());
    used = text.length;
  }
  return { sentences, used };
}

/** Strip markdown and links so the voice doesn't read out asterisks and URLs. */
function forSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")
    .replace(/[*_#`>]/g, "")
    .trim();
}

function sessionId(): string {
  const fresh = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) return saved;
    const id = fresh();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

function ago(now: number, t: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 3) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}

/** Background noise often transcribes as a lone filler word; don't send those to Spark as questions. */
const FILLERS = new Set(["uh", "um", "hmm", "mm", "ah", "oh", "the", "a", "and", "so", "okay", "ok", "yeah", "hey"]);
function isFiller(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return words.length <= 2 && words.every((w) => FILLERS.has(w));
}
