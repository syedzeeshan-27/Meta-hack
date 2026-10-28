"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_STEPS } from "@/lib/demo-steps";
import type { SegmentResponse } from "@/lib/types";
import { startRecording, type WavRecorder } from "@/lib/wav-recorder";

const MAX_FRAME_WIDTH = 1280;

export default function FixCam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<WavRecorder | null>(null);
  const [live, setLive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [seg, setSeg] = useState<SegmentResponse | null>(null);
  const [busy, setBusy] = useState<"" | "looking" | "listening" | "thinking">("");
  const [status, setStatus] = useState("Tap start and point at the chair.");
  const [heard, setHeard] = useState("");

  const step = DEMO_STEPS[stepIndex];

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
      setStatus("");
      speak(step.instruction);
    } catch (err) {
      setStatus(`Camera blocked: ${String(err)}`);
    }
  }

  /** Grab the current camera frame as a JPEG data URL, capped at MAX_FRAME_WIDTH. */
  function captureFrame(): string {
    const video = videoRef.current!;
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  const showMe = useCallback(async () => {
    if (!live || busy) return;
    setBusy("looking");
    setSeg(null);
    try {
      const res = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: captureFrame(), phrase: step.part }),
      });
      const data = (await res.json()) as SegmentResponse & { error?: string };
      if (data.error) throw new Error(data.error);
      setSeg(data);
      setStatus(
        data.outlines.length
          ? `Found the ${step.part} (${(data.ms / 1000).toFixed(1)}s${data.fake ? ", demo data" : ""})`
          : `Couldn't spot the ${step.part}. Try moving closer.`,
      );
    } catch (err) {
      setStatus(`Something went wrong: ${String(err)}`);
    } finally {
      setBusy("");
    }
  }, [live, busy, step.part]);

  function goTo(i: number) {
    const next = Math.max(0, Math.min(DEMO_STEPS.length - 1, i));
    setStepIndex(next);
    setSeg(null);
    speak(DEMO_STEPS[next].instruction);
  }

  async function startTalking() {
    if (busy) return;
    try {
      recorderRef.current = await startRecording();
      setBusy("listening");
    } catch (err) {
      setStatus(`Mic blocked: ${String(err)}`);
    }
  }

  async function stopTalking() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setBusy("thinking");
    try {
      const wav = await recorder.stop();
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      const data = (await res.json()) as { transcript?: string; error?: string };
      if (data.error) throw new Error(data.error);
      const said = (data.transcript ?? "").trim();
      setHeard(said);
      setBusy("");
      handleCommand(said.toLowerCase());
    } catch (err) {
      setStatus(`Didn't catch that: ${String(err)}`);
      setBusy("");
    }
  }

  // Simple voice commands for now; free-form questions go to Muse Spark in the next chunk.
  function handleCommand(said: string) {
    if (/\b(next|done|finished)\b/.test(said)) goTo(stepIndex + 1);
    else if (/\b(back|previous)\b/.test(said)) goTo(stepIndex - 1);
    else if (/\b(show|where|which)\b/.test(said)) void showMe();
    else if (/\b(repeat|again)\b/.test(said)) speak(step.instruction);
  }

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black select-none">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {seg && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${seg.width} ${seg.height}`}
          preserveAspectRatio="xMidYMid slice"
        >
          {seg.outlines.map((o) => (
            <path
              key={o.id}
              d={o.path}
              transform={o.transform}
              className="part-outline"
              vectorEffect="non-scaling-stroke"
              strokeWidth={4}
            />
          ))}
        </svg>
      )}

      {/* Step card */}
      <section className="absolute inset-x-0 top-0 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="rounded-2xl bg-black/70 p-4 backdrop-blur">
          <p className="text-xs font-medium uppercase tracking-wider text-cyan-300">
            Step {stepIndex + 1} of {DEMO_STEPS.length}
          </p>
          <p className="mt-1 text-lg leading-snug">{step.instruction}</p>
          {(status || heard) && (
            <p className="mt-2 text-sm text-white/60">
              {heard && <span className="text-white/80">&ldquo;{heard}&rdquo; · </span>}
              {status}
            </p>
          )}
        </div>
      </section>

      {/* Controls */}
      <section className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {!live ? (
          <button onClick={startCamera} className="w-full rounded-full bg-cyan-400 py-4 text-lg font-semibold text-black">
            Start
          </button>
        ) : (
          <>
            <button
              onClick={() => goTo(stepIndex - 1)}
              disabled={stepIndex === 0}
              className="rounded-full bg-white/15 px-5 py-4 disabled:opacity-30"
            >
              Back
            </button>
            <button
              onPointerDown={startTalking}
              onPointerUp={stopTalking}
              onPointerLeave={stopTalking}
              className={`h-20 w-20 shrink-0 rounded-full text-sm font-semibold ${
                busy === "listening" ? "scale-110 bg-red-500" : "bg-white text-black"
              } transition`}
            >
              {busy === "listening" ? "Listening" : busy === "thinking" ? "…" : "Hold to talk"}
            </button>
            <button
              onClick={showMe}
              disabled={!!busy}
              className="rounded-full bg-cyan-400 px-5 py-4 font-semibold text-black disabled:opacity-50"
            >
              {busy === "looking" ? "Looking…" : "Show me"}
            </button>
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
