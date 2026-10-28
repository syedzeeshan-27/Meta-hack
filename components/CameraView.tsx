"use client";

import { useEffect, useRef, useState } from "react";
import type { Guide, Outline } from "@/lib/types";
import { startRecording, type WavRecorder } from "@/lib/wav-recorder";

const MAX_FRAME_WIDTH = 1280;

type Frame = { image: string; width: number; height: number };
/** Outlines on screen: cyan = "here it is", red = "this is wrong", green = "parts I counted". */
type Overlay = { width: number; height: number; outlines: Outline[]; tone: "show" | "problem" | "parts" };
type Busy = "" | "listening" | "thinking" | "looking" | "checking";

type SegmentResult = { width: number; height: number; outlines: Outline[]; via: string; ms: number; error?: string };
type AskResult = {
  say: string;
  goToStep?: number;
  outline?: { width: number; height: number; outlines: Outline[]; phrase: string };
  ms?: number;
  error?: string;
};
type CheckResult = {
  say: string;
  error?: string;
  // step
  done?: boolean;
  problem?: { width: number; height: number; outlines: Outline[]; phrase: string };
  // parts
  outlines?: { width: number; height: number; outlines: Outline[] }[];
  // final
  ok?: boolean;
  reference?: string;
};

export default function CameraView({ guide, onExit }: { guide: Guide; onExit: () => void }) {
  const steps = guide.steps;
  const hasSteps = steps.length > 0;
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<WavRecorder | null>(null);
  const [live, setLive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState(hasSteps ? "Tap start and point your camera at it." : "Tap start, point at anything and ask.");
  const [reference, setReference] = useState<string | null>(null);

  const step = hasSteps ? steps[stepIndex] : null;
  const isLast = hasSteps && stepIndex === steps.length - 1;

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setLive(true);
      if (step) say(step.instruction);
      else say("I'm looking. Hold the button and ask me anything.");
    } catch (err) {
      setAnswer(`Camera blocked: ${String(err)}`);
    }
  }

  /** Grab the current camera frame as a JPEG data URL, capped at MAX_FRAME_WIDTH. */
  function captureFrame(): Frame {
    const video = videoRef.current!;
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { image: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height };
  }

  function say(text: string) {
    setAnswer(text);
    speak(text);
  }

  function goTo(i: number) {
    if (!hasSteps) return;
    const next = Math.max(0, Math.min(steps.length - 1, i));
    setStepIndex(next);
    setOverlay(null);
    say(steps[next].instruction);
  }

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json()) as T & { error?: string };
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function run(kind: Busy, fn: () => Promise<void>) {
    if (!live || busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      say(`Something went wrong. ${String(err).slice(0, 120)}`);
    } finally {
      setBusy("");
    }
  }

  const showMe = () =>
    run("looking", async () => {
      if (!step) return;
      setOverlay(null);
      const data = await post<SegmentResult>("/api/segment", { ...captureFrame(), phrase: step.part });
      if (data.outlines.length) {
        setOverlay({ ...data, tone: "show" });
        setAnswer(`That's the ${step.part}.`);
      } else say(`I can't spot the ${step.part}. Try moving a little closer.`);
    });

  const checkThisStep = () =>
    run("checking", async () => {
      setOverlay(null);
      const data = await post<CheckResult>("/api/check", { kind: "step", frame: captureFrame(), guide, stepIndex });
      if (data.problem) setOverlay({ ...data.problem, tone: "problem" });
      say(data.say);
    });

  const checkParts = () =>
    run("checking", async () => {
      setOverlay(null);
      const data = await post<CheckResult>("/api/check", { kind: "parts", frame: captureFrame(), guide });
      const all = data.outlines ?? [];
      if (all.length) setOverlay({ width: all[0].width, height: all[0].height, outlines: all.flatMap((o) => o.outlines), tone: "parts" });
      say(data.say);
    });

  const finalCheck = () =>
    run("checking", async () => {
      setOverlay(null);
      setAnswer("Drawing how it should look, then comparing… (about 15 seconds)");
      const data = await post<CheckResult>("/api/check", { kind: "final", frame: captureFrame(), guide });
      if (data.reference) setReference(data.reference);
      say(data.say);
    });

  async function startTalking() {
    if (!live || busy) return;
    window.speechSynthesis?.cancel();
    try {
      recorderRef.current = await startRecording();
      setBusy("listening");
    } catch (err) {
      setAnswer(`Mic blocked: ${String(err)}`);
    }
  }

  async function stopTalking() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    // Grab the frame at the moment they finish speaking: that's what they're asking about.
    const frame = captureFrame();
    setBusy("thinking");
    try {
      const wav = await recorder.stop();
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      const heardData = (await res.json()) as { transcript?: string; error?: string };
      if (heardData.error) throw new Error(heardData.error);
      const question = (heardData.transcript ?? "").trim();
      setHeard(question);
      if (!question) {
        say("I didn't hear anything. Hold the button while you talk.");
        return;
      }
      // Everything goes to Muse Spark: it sees the frame, knows the guide, and decides what to do.
      const reply = await post<AskResult>("/api/ask", { question, frame, guide, stepIndex });
      if (reply.goToStep !== undefined && reply.goToStep !== stepIndex) {
        setStepIndex(reply.goToStep);
        setOverlay(null);
      }
      if (reply.outline?.outlines.length) setOverlay({ ...reply.outline, tone: "show" });
      say(reply.say);
    } catch (err) {
      say(`Didn't catch that. ${String(err).slice(0, 120)}`);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const busyLabel: Record<Busy, string> = {
    "": "",
    listening: "Listening…",
    thinking: "Thinking…",
    looking: "Looking…",
    checking: "Checking…",
  };

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
              className={`part-outline ${overlay.tone === "problem" ? "tone-problem" : overlay.tone === "parts" ? "tone-parts" : ""}`}
              vectorEffect="non-scaling-stroke"
              strokeWidth={4}
            />
          ))}
        </svg>
      )}

      {/* Step / answer card */}
      <section className="absolute inset-x-0 top-0 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="rounded-2xl bg-black/70 p-4 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-cyan-300">
              {hasSteps ? `Step ${stepIndex + 1} of ${steps.length}` : guide.product || "Ask anything"}
            </p>
            <div className="flex items-center gap-3 text-xs text-white/60">
              {hasSteps && (
                <>
                  <button onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0} className="disabled:opacity-30">
                    ‹ Prev
                  </button>
                  <button onClick={() => goTo(stepIndex + 1)} disabled={isLast} className="disabled:opacity-30">
                    Next ›
                  </button>
                </>
              )}
              <button onClick={onExit} className="underline-offset-2 hover:underline">
                Close
              </button>
            </div>
          </div>
          {step && <p className="mt-1 text-lg leading-snug">{step.instruction}</p>}
          <p className={`mt-2 text-sm ${step ? "text-white/70" : "text-base text-white"}`}>
            {heard && <span className="text-white/50">You: &ldquo;{heard}&rdquo;<br /></span>}
            {busy ? busyLabel[busy] : answer}
          </p>
          {live && hasSteps && (
            <div className="mt-3 flex gap-2">
              {stepIndex === 0 && guide.parts.length > 0 && (
                <button onClick={checkParts} disabled={!!busy} className="rounded-full bg-white/15 px-3 py-1.5 text-xs disabled:opacity-40">
                  Check my parts
                </button>
              )}
              {isLast && (
                <button onClick={finalCheck} disabled={!!busy} className="rounded-full bg-white/15 px-3 py-1.5 text-xs disabled:opacity-40">
                  Final check
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* What it should look like (final check) */}
      {reference && (
        <button onClick={() => setReference(null)} className="absolute bottom-36 right-4 w-32 overflow-hidden rounded-xl border-2 border-cyan-300 shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
          <img src={reference} alt="How it should look" className="block w-full" />
          <span className="block bg-black/80 py-1 text-center text-[10px]">How it should look · tap to close</span>
        </button>
      )}

      {/* Controls */}
      <section className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {!live ? (
          <button onClick={startCamera} className="w-full rounded-full bg-cyan-400 py-4 text-lg font-semibold text-black">
            Start
          </button>
        ) : (
          <>
            {hasSteps ? (
              <button onClick={checkThisStep} disabled={!!busy} className="rounded-full bg-white/15 px-5 py-4 font-medium disabled:opacity-40">
                Done?
              </button>
            ) : (
              <span className="w-20" />
            )}
            <button
              onPointerDown={startTalking}
              onPointerUp={stopTalking}
              onPointerLeave={stopTalking}
              onContextMenu={(e) => e.preventDefault()}
              className={`h-20 w-20 shrink-0 touch-none rounded-full text-sm font-semibold transition ${
                busy === "listening" ? "scale-110 bg-red-500 text-white" : "bg-white text-black"
              }`}
            >
              {busy === "listening" ? "Listening" : busy === "thinking" ? "…" : "Hold to talk"}
            </button>
            {hasSteps ? (
              <button onClick={showMe} disabled={!!busy} className="rounded-full bg-cyan-400 px-5 py-4 font-semibold text-black disabled:opacity-40">
                Show me
              </button>
            ) : (
              <span className="w-20" />
            )}
          </>
        )}
      </section>
    </main>
  );
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
