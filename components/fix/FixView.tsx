"use client";

// The fix screen (/fix): point the camera at something broken and talk. FixCam diagnoses it with you
// (cause board + one test at a time), gives a safety verdict decided in code, looks up the part and price,
// walks you through the repair with a camera check per step while a safety watcher looks on, and ends
// with a shareable repair card.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import CameraStage, { type CameraHandle } from "@/components/camera/CameraStage";
import { AnswerCard } from "@/components/camera/AnswerCard";
import {
  AlertIcon,
  Button,
  ButtonLink,
  CheckIcon,
  EyeIcon,
  HomeIcon,
  IconButton,
  KeyboardIcon,
  MicIcon,
  MicOffIcon,
  ShieldIcon,
  Spinner,
  WrenchIcon,
} from "@/components/ui";
import { DiagnosisBoard } from "./DiagnosisBoard";
import { ListenMeter, StopOverlay, TypeSheet } from "./Overlays";
import { StepPanel } from "./StepPanel";
import { useFix, type FixPhase } from "./useFix";
import { VerdictSheet } from "./VerdictSheet";

const PHASE_LABEL: Record<FixPhase, string> = {
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
  measuring: "Measuring sound",
};

const GREETING = "What's broken? Point me at it and tell me what it's doing.";

export default function FixView() {
  const router = useRouter();
  const camRef = useRef<CameraHandle>(null);
  const levelRef = useRef<HTMLSpanElement>(null);
  const [city, setCity] = useCity();
  const [started, setStarted] = useState(false);
  const [typing, setTyping] = useState(false);
  const [verdictOpen, setVerdictOpen] = useState(false);
  const [seenVerdict, setSeenVerdict] = useState("");

  const s = useFix({ capture: (side, q) => camRef.current?.captureFrame(side, q) ?? null, city, levelRef });
  const { repair } = s;

  // A new verdict opens its sheet once.
  const verdictKey = repair.verdict ? `${repair.verdict.cause}|${repair.verdict.path}` : "";
  if (verdictKey !== seenVerdict) {
    setSeenVerdict(verdictKey);
    if (verdictKey && repair.stage === "verdict") setVerdictOpen(true);
  }

  function start() {
    setStarted(true);
    void s.start(GREETING); // inside the tap: mic + speech need it on iOS
  }

  const fixing = repair.stage === "fixing" && repair.guide;
  const phase = s.phase;

  const top = (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <IconButton onDark label="Home" onClick={() => router.push("/")}>
          <HomeIcon />
        </IconButton>
        <span className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-sm font-medium backdrop-blur" role="status" aria-live="polite">
          <span
            className={`size-2 rounded-full ${s.muted ? "bg-white/60" : phase === "measuring" ? "bg-cam-existing" : "bg-cam-info"} ${
              !s.muted && phase !== "listening" ? "animate-pulse" : ""
            }`}
            aria-hidden
          />
          {s.muted ? "Mic off" : PHASE_LABEL[phase]}
        </span>
        {s.watching ? (
          <span
            title={s.watcherModel ? `Safety watcher: ${s.watcherModel}` : "Safety watcher"}
            className="flex min-h-12 items-center gap-1.5 rounded-full bg-black/55 px-3 text-xs font-medium text-cam-ok backdrop-blur"
          >
            <ShieldIcon className="size-4" /> Safety watch
          </span>
        ) : (
          <span className="size-12" aria-hidden />
        )}
      </div>
      {fixing ? (
        <StepPanel guide={repair.guide!} stepIndex={repair.stepIndex} gatesPassed={repair.gatesPassed} onGo={s.goToStep} />
      ) : (
        <DiagnosisBoard repair={repair} />
      )}
    </div>
  );

  const showCard = s.heard || s.answer || s.error || s.thinking;
  const caption = showCard ? (
    <AnswerCard
      heard={s.heard}
      answer={s.answer}
      thinking={s.thinking}
      status={s.status}
      phrase={s.outline?.phrase}
      sources={s.sources}
      error={s.error}
    />
  ) : null;

  const done = repair.stage === "done" && repair.outcome;
  const actions = done ? (
    <div className="anim-fade rounded-2xl bg-black/80 p-4 backdrop-blur">
      <p className="flex items-center gap-2 text-lg font-semibold">
        {repair.outcome!.fixed ? <CheckIcon className="size-5 text-cam-ok" /> : <AlertIcon className="size-5 text-cam-existing" />}
        {repair.outcome!.fixed ? "Fixed" : "Repair ended"}
      </p>
      <p className="mt-1 text-sm text-white/80">{repair.outcome!.summary}</p>
      <div className="mt-3">
        {s.card.id ? (
          <ButtonLink onDark block href={`/r/${s.card.id}`}>
            Open your repair card
          </ButtonLink>
        ) : s.card.saving ? (
          <p className="flex items-center gap-2 text-sm text-white/80">
            <Spinner /> Making your repair card…
          </p>
        ) : s.card.error ? (
          <Button onDark block onClick={s.saveCard}>
            Couldn&rsquo;t save the card. Try again
          </Button>
        ) : null}
      </div>
    </div>
  ) : fixing ? (
    <div className="flex gap-2">
      <Button variant="secondary" onDark icon={<EyeIcon />} onClick={s.showStepPart}>
        Show me
      </Button>
      <Button onDark className="flex-1" icon={<CheckIcon />} disabled={s.thinking} onClick={() => s.ask("I've done this step. Check it.")}>
        Check this step
      </Button>
    </div>
  ) : repair.verdict ? (
    <Button variant="secondary" onDark block icon={<WrenchIcon />} onClick={() => setVerdictOpen(true)}>
      {repair.verdict.path === "shop" ? "See the verdict and repair shops" : "See the verdict, part and price"}
    </Button>
  ) : null;

  const bottom = (
    <div className="flex flex-col gap-3">
      {actions}
      <div className="grid grid-cols-3 items-end">
        <span className="flex flex-col items-center gap-1.5 justify-self-start">
          <IconButton
            onDark
            size={56}
            label={s.muted ? "Turn the mic on" : "Mute the mic"}
            aria-pressed={s.muted}
            onClick={() => {
              if (!s.muted) s.stopSpeaking();
              s.setMuted((m) => !m);
            }}
          >
            {s.muted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
          </IconButton>
          <span className="text-xs font-medium text-white/85 drop-shadow">{s.muted ? "Mic off" : "Mute"}</span>
        </span>

        <button
          onClick={() => {
            if (s.speaking) s.stopSpeaking();
            else if (s.muted) s.setMuted(false);
          }}
          aria-label={s.muted ? "Microphone off. Tap to turn on" : s.speaking ? "Speaking. Tap to stop" : PHASE_LABEL[phase]}
          className="flex flex-col items-center gap-1.5 justify-self-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <span className="relative flex size-[72px] items-center justify-center">
            <span
              ref={levelRef}
              className={`mic-level absolute inset-0 rounded-full ${s.muted ? "bg-white/10" : phase === "hearing" ? "bg-cam-info/50" : "bg-white/20"}`}
            />
            {phase === "thinking" && !s.muted && (
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-white/20 border-t-cam-info" aria-hidden />
            )}
            <span
              className={`relative size-12 rounded-full ${
                s.muted ? "bg-white/30" : phase === "speaking" ? "mic-speak bg-cam-info" : phase === "hearing" ? "bg-cam-info" : "bg-white"
              }`}
            />
          </span>
          <span className="text-xs font-medium text-white/85 drop-shadow">
            {s.muted ? "Tap to turn on" : phase === "speaking" ? "Tap to stop" : `${PHASE_LABEL[phase]}…`}
          </span>
        </button>

        <span className="flex flex-col items-center gap-1.5 justify-self-end">
          <IconButton onDark size={56} label="Type instead" onClick={() => setTyping(true)}>
            <KeyboardIcon className="size-6" />
          </IconButton>
          <span className="text-xs font-medium text-white/85 drop-shadow">Type</span>
        </span>
      </div>
    </div>
  );

  return (
    <CameraStage
      ref={camRef}
      active={started}
      explain={false}
      outlines={s.outline ? [s.outline] : undefined}
      top={top}
      caption={caption}
      bottom={bottom}
    >
      {!started && (
        <section className="anim-fade absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-cam-info/15 text-cam-info" aria-hidden>
              <WrenchIcon className="size-8" />
            </span>
            <h1 className="text-[28px] font-semibold leading-[34px]">What&rsquo;s broken?</h1>
            <p className="text-base text-white/75">
              Point your phone at it and tell me what it&rsquo;s doing. We&rsquo;ll find the cause together, check it&rsquo;s safe,
              and fix it step by step.
            </p>
            <label className="w-full text-left text-sm text-white/70">
              Your city, for local prices
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Hyderabad"
                autoComplete="address-level2"
                className="mt-1 min-h-12 w-full rounded-xl border border-white/20 bg-white/10 px-4 text-base text-white placeholder:text-white/40 focus:border-cam-info focus:outline-none"
              />
            </label>
            <Button onDark size="lg" block loading={s.starting} onClick={start}>
              {s.starting ? "Starting…" : "Start"}
            </Button>
            <p className="text-sm text-white/60">Uses your camera, microphone and speaker.</p>
            {s.micError && (
              <p className="flex gap-2 text-left text-sm text-white/85" role="alert">
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                <span>{s.micError} Allow it for this site, then tap Start.</span>
              </p>
            )}
            <Link href="/" className="flex min-h-12 items-center px-4 text-sm text-white/70 underline underline-offset-4">
              Back home
            </Link>
          </div>
        </section>
      )}

      {started && s.listen && <ListenMeter listen={s.listen} onTap={s.runListenNow} onCancel={s.cancelListen} />}
      {started && s.hazard && <StopOverlay hazard={s.hazard} model={s.watcherModel} rechecking={s.rechecking} onRecheck={s.recheckHazard} />}

      <VerdictSheet
        open={verdictOpen && !fixing}
        onClose={() => setVerdictOpen(false)}
        repair={repair}
        researching={s.researching}
        researchError={s.researchError}
        onRetryResearch={s.retryResearch}
        onFix={() => {
          setVerdictOpen(false);
          s.ask("Let's fix it.");
        }}
        onShop={() => {
          setVerdictOpen(false);
          s.ask("Okay, I'll take it to a repair shop.");
        }}
      />
      <TypeSheet open={typing} onClose={() => setTyping(false)} onSend={s.ask} />
    </CameraStage>
  );
}

// ---------- the city, remembered on this device ----------

const CITY_KEY = "fixcam.city";
const cityListeners = new Set<() => void>();
let cityMemory: string | null = null;

function readCity(): string {
  if (cityMemory !== null) return cityMemory;
  try {
    return localStorage.getItem(CITY_KEY) ?? "";
  } catch {
    return "";
  }
}

function useCity(): [string, (v: string) => void] {
  const city = useSyncExternalStore(
    (cb) => {
      cityListeners.add(cb);
      return () => cityListeners.delete(cb);
    },
    readCity,
    () => "",
  );
  const set = (v: string) => {
    cityMemory = v;
    try {
      localStorage.setItem(CITY_KEY, v);
    } catch {}
    cityListeners.forEach((l) => l());
  };
  return [city, set];
}
