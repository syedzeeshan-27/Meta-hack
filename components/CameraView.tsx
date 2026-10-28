"use client";

// Step-by-step guide over the camera (the old chair flow; reached from Ask when someone says
// "help me assemble this", and from the hidden /guide page). Uses the shared CameraStage.

import { useEffect, useRef, useState } from "react";
import type { Guide, Outline } from "@/lib/types";
import { startRecording, type WavRecorder } from "@/lib/wav-recorder";
import CameraStage, { type CameraHandle, type CameraStatus, type StageOutline } from "@/components/camera/CameraStage";
import { RoundButton } from "@/components/camera/RoundButton";
import type { OutlineTone } from "@/components/camera/outlines";
import { Button, CloseIcon, IconButton, MicIcon, Spinner } from "@/components/ui";

const MAX_FRAME_SIDE = 1280;

type Frame = { image: string; width: number; height: number };
/** Outlines on screen: info = "here it is", new = "this is wrong", ok = "parts I counted". */
type Overlay = { width: number; height: number; outlines: Outline[]; tone: OutlineTone };
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
  const camRef = useRef<CameraHandle>(null);
  const recorderRef = useRef<WavRecorder | null>(null);
  const overlayIdRef = useRef(0);
  const [started, setStarted] = useState(false);
  const [camStatus, setCamStatus] = useState<CameraStatus>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [overlay, setOverlay] = useState<(Overlay & { key: string }) | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState(hasSteps ? "Tap start and point your camera at it." : "Tap start, point at anything and ask.");
  const [reference, setReference] = useState<string | null>(null);

  const live = camStatus === "live";
  const step = hasSteps ? steps[stepIndex] : null;
  const isLast = hasSteps && stepIndex === steps.length - 1;

  function start() {
    setStarted(true);
    // Said inside the tap, so iOS lets it play.
    if (step) say(step.instruction);
    else say("I'm looking. Hold the button and ask me anything.");
  }

  function show(o: Overlay | null) {
    setOverlay(o && { ...o, key: `cv-${++overlayIdRef.current}` });
  }

  /** The current camera frame as a JPEG data URL, longest side capped at MAX_FRAME_SIDE. */
  function captureFrame(): Frame {
    const frame = camRef.current?.captureFrame(MAX_FRAME_SIDE, 0.85);
    if (!frame) throw new Error("The camera isn't ready yet.");
    return frame;
  }

  function say(text: string) {
    setAnswer(text);
    speak(text);
  }

  function goTo(i: number) {
    if (!hasSteps) return;
    const next = Math.max(0, Math.min(steps.length - 1, i));
    setStepIndex(next);
    show(null);
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
      show(null);
      const data = await post<SegmentResult>("/api/segment", { ...captureFrame(), phrase: step.part });
      if (data.outlines.length) {
        show({ ...data, tone: "info" });
        setAnswer(`That's the ${step.part}.`);
      } else say(`I can't spot the ${step.part}. Try moving a little closer.`);
    });

  const checkThisStep = () =>
    run("checking", async () => {
      show(null);
      const data = await post<CheckResult>("/api/check", { kind: "step", frame: captureFrame(), guide, stepIndex });
      if (data.problem) show({ ...data.problem, tone: "new" });
      say(data.say);
    });

  const checkParts = () =>
    run("checking", async () => {
      show(null);
      const data = await post<CheckResult>("/api/check", { kind: "parts", frame: captureFrame(), guide });
      const all = data.outlines ?? [];
      if (all.length) show({ width: all[0].width, height: all[0].height, outlines: all.flatMap((o) => o.outlines), tone: "ok" });
      say(data.say);
    });

  const finalCheck = () =>
    run("checking", async () => {
      show(null);
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
    setBusy("thinking");
    try {
      // Grab the frame at the moment they finish speaking: that's what they're asking about.
      const frame = captureFrame();
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
        show(null);
      }
      if (reply.outline?.outlines.length) show({ ...reply.outline, tone: "info" });
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

  const stageOutlines: StageOutline[] | undefined = overlay ? [overlay] : undefined;

  // Step / answer card
  const top = (
    <div className="rounded-2xl bg-black/80 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-cam-info">
          {hasSteps ? `Step ${stepIndex + 1} of ${steps.length}` : guide.product || "Ask anything"}
        </p>
        <div className="flex items-center gap-1">
          {hasSteps && (
            <>
              <Button variant="ghost" onDark onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0}>
                ‹ Prev
              </Button>
              <Button variant="ghost" onDark onClick={() => goTo(stepIndex + 1)} disabled={isLast}>
                Next ›
              </Button>
            </>
          )}
          <IconButton onDark size={40} label="Close the step guide" onClick={onExit}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>
      {step && <p className="mt-1 text-lg leading-snug">{step.instruction}</p>}
      <p aria-live="polite" className={`mt-2 ${step ? "text-sm text-white/75" : "text-base text-white"}`}>
        {heard && (
          <span className="text-white/60">
            You: &ldquo;{heard}&rdquo;
            <br />
          </span>
        )}
        {busy ? busyLabel[busy] : answer}
      </p>
      {live && hasSteps && ((stepIndex === 0 && guide.parts.length > 0) || isLast) && (
        <div className="mt-3 flex gap-2">
          {stepIndex === 0 && guide.parts.length > 0 && (
            <Button variant="secondary" onDark onClick={checkParts} disabled={!!busy}>
              Check my parts
            </Button>
          )}
          {isLast && (
            <Button variant="secondary" onDark onClick={finalCheck} disabled={!!busy}>
              Final check
            </Button>
          )}
        </div>
      )}
    </div>
  );

  const bottom = (
    <div className="grid grid-cols-3 items-end">
      <span className="justify-self-start">
        {hasSteps && (
          <Button variant="secondary" onDark onClick={checkThisStep} disabled={!!busy || !live}>
            Done?
          </Button>
        )}
      </span>
      <span className="justify-self-center">
        <RoundButton
          solid
          size={72}
          label="Hold to talk"
          caption={busy === "listening" ? "Listening…" : busy === "thinking" ? "Thinking…" : "Hold to talk"}
          className={`touch-none ${busy === "listening" ? "scale-110" : ""}`}
          disabled={!live}
          onPointerDown={startTalking}
          onPointerUp={stopTalking}
          onPointerLeave={stopTalking}
          onContextMenu={(e) => e.preventDefault()}
        >
          {busy === "thinking" ? <Spinner className="size-6" /> : <MicIcon className="size-7" />}
        </RoundButton>
      </span>
      <span className="justify-self-end">
        {hasSteps && (
          <Button onDark onClick={showMe} disabled={!!busy || !live}>
            Show me
          </Button>
        )}
      </span>
    </div>
  );

  return (
    <CameraStage ref={camRef} active={started} explain={false} onStatus={setCamStatus} outlines={stageOutlines} top={top} bottom={bottom}>
      {!started && (
        <section className="absolute inset-0 z-10 flex items-center justify-center bg-black px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
          <div className="flex w-full max-w-sm flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-cam-info">
              {hasSteps ? `${steps.length} steps` : "Ask anything"}
            </p>
            <h1 className="text-[28px] font-semibold leading-[34px]">{guide.product || "Step by step"}</h1>
            {step && <p className="text-base text-white/75">First: {step.instruction}</p>}
            <Button onDark size="lg" block onClick={start}>
              Start
            </Button>
            <Button variant="ghost" onDark block onClick={onExit}>
              Back
            </Button>
          </div>
        </section>
      )}

      {/* What it should look like (final check) */}
      {reference && (
        <button
          onClick={() => setReference(null)}
          className="absolute bottom-40 right-4 w-32 overflow-hidden rounded-xl border-2 border-cam-info shadow-lg"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
          <img src={reference} alt="How it should look" className="block w-full" />
          <span className="block bg-black/80 py-1 text-center text-xs">How it should look · tap to close</span>
        </button>
      )}
    </CameraStage>
  );
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
