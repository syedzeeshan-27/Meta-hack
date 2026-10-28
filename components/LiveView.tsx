"use client";

// Ask, full screen (/live): point the camera at anything and talk. Same camera and Ask session as the
// walkthrough's Ask sheet, plus the "Noticed" memory strip fed by the open-weights watcher (only here).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import CameraView from "@/components/CameraView";
import CameraStage, { type CameraHandle } from "@/components/camera/CameraStage";
import { AnswerCard } from "@/components/camera/AnswerCard";
import { useLatest } from "@/components/camera/hooks";
import { PHASE_LABEL, useAskSession } from "@/components/camera/useAskSession";
import type { Guide } from "@/lib/types";
import type { WatchResponse } from "@/lib/live-types";
import {
  AlertIcon,
  Button,
  CaptionBar,
  Chip,
  HomeIcon,
  IconButton,
  MicIcon,
  MicOffIcon,
  NoteIcon,
  SparkleIcon,
  StatusPill,
} from "@/components/ui";

const ASK_MAX_SIDE = 1024;
const WATCH_MAX_SIDE = 640;
const WATCH_EVERY_MS = 3000;
const MEMORY_SHOWN = 3;
const REMARK_SHOWN_MS = 12000;

type Memory = { t: number; caption: string };

export default function LiveView() {
  const router = useRouter();
  const camRef = useRef<CameraHandle>(null);
  const levelRef = useRef<HTMLSpanElement>(null);
  const lastRemarkRef = useRef("");
  const watchFailsRef = useRef(0);

  const [view, setView] = useState<"live" | "guide">("live");
  const [guide, setGuide] = useState<Guide | null>(null);
  const [memory, setMemory] = useState<Memory[]>([]);
  const [watchModel, setWatchModel] = useState("");
  const [watchOff, setWatchOff] = useState(false);
  const [remark, setRemark] = useState<{ text: string; t: number } | null>(null);
  const [now, setNow] = useState(0);

  const s = useAskSession({
    capture: () => camRef.current?.captureFrame(ASK_MAX_SIDE, 0.8) ?? null,
    // The assistant built a step guide ("help me assemble this"): hand the screen to the step view.
    onGuide: (g) => {
      setGuide(g);
      setView("guide");
    },
    paused: view !== "live",
    levelRef,
  });
  const sRef = useLatest(s);
  const started = s.running;

  function start() {
    setRemark(null);
    setNow(Date.now());
    void s.start("I'm listening. Just talk."); // inside the tap: mic + speech need it on iOS
  }

  // Clock for "12s ago" and for hiding an old remark.
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [started]);

  // The watcher: a small frame every few seconds while nobody is asking anything.
  useEffect(() => {
    if (!started || view !== "live" || watchOff) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const quiet = sRef.current.isQuiet() && document.visibilityState === "visible";
      const frame = quiet ? (camRef.current?.captureFrame(WATCH_MAX_SIDE, 0.6) ?? null) : null;
      if (frame) {
        try {
          const res = await fetch("/api/watch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sRef.current.session(), frame }),
          });
          const data = (await res.json()) as WatchResponse & { error?: string };
          if (!res.ok || data.error || typeof data.caption !== "string") throw new Error(data.error ?? `HTTP ${res.status}`);
          watchFailsRef.current = 0;
          if (stopped) return;
          setWatchModel(data.model);
          if (data.caption) setMemory((m) => [...m, { t: Date.now(), caption: data.caption }].slice(-MEMORY_SHOWN));
          if (data.remark && sRef.current.isQuiet() && data.remark !== lastRemarkRef.current) {
            lastRemarkRef.current = data.remark;
            setRemark({ text: data.remark, t: Date.now() });
            sRef.current.speak(data.remark);
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
  }, [started, view, watchOff, sRef]);

  // Hidden by navigation or unmounted: stop the answer stream too (mic and speech stop in their own hooks).
  useLayoutEffect(() => () => sRef.current.stop(), [sRef]);

  if (view === "guide" && guide) return <CameraView guide={guide} onExit={() => setView("live")} />;

  const showRemark = remark && !s.asking && now - remark.t < REMARK_SHOWN_MS;
  const showCard = s.heard || s.answer || s.error || s.asking;
  const phase = s.phase;

  const top = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <IconButton onDark label="Home" onClick={() => router.push("/")}>
          <HomeIcon />
        </IconButton>
        <StatusPill tone={s.muted ? "neutral" : phase === "thinking" ? "neutral" : "info"} pulse={!s.muted && phase !== "listening"}>
          {s.muted ? "Mic off" : PHASE_LABEL[phase]}
        </StatusPill>
        {guide ? (
          <Chip onDark icon={<NoteIcon className="size-4" />} onClick={() => setView("guide")}>
            Steps
          </Chip>
        ) : (
          <span className="size-12" aria-hidden />
        )}
      </div>
      {memory.length > 0 && (
        <div className="max-w-[85%] self-start rounded-xl bg-black/55 px-3 py-2 text-xs leading-4 backdrop-blur">
          <p className="mb-1 font-semibold uppercase tracking-wider text-cam-info">
            Noticed{watchModel && <span className="font-normal normal-case tracking-normal text-white/60"> · {watchModel}</span>}
          </p>
          <ul className="flex flex-col gap-0.5">
            {memory
              .slice()
              .reverse()
              .map((m) => (
                <li key={m.t} className="text-white/85">
                  {m.caption} <span className="text-white/55">· {ago(now, m.t)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );

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
  ) : showRemark ? (
    <CaptionBar text={remark.text} sub="Noticed" />
  ) : null;

  const bottom = (
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

      <span className="justify-self-end">
        {guide && (
          <span className="flex flex-col items-center gap-1.5">
            <IconButton onDark size={56} label="Open the step guide" onClick={() => setView("guide")}>
              <NoteIcon className="size-6" />
            </IconButton>
            <span className="text-xs font-medium text-white/85 drop-shadow">Steps</span>
          </span>
        )}
      </span>
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
              <SparkleIcon className="size-8" />
            </span>
            <h1 className="text-[28px] font-semibold leading-[34px]">Ask about anything</h1>
            <p className="text-base text-white/75">
              Point your phone at something and just talk. Ask what it is, whether it&rsquo;s damaged, or what a fix would cost.
            </p>
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
    </CameraStage>
  );
}

function ago(now: number, t: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 3) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}
