"use client";

// The camera behind the fix screen. It owns the getUserMedia stream, the <video>, the outline overlay and
// the permission / error screens, and exposes captureFrame() through a ref.

import Link from "next/link";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { Outline } from "@/lib/types";
import { AlertIcon, Button, CameraIcon, Spinner } from "@/components/ui";
import { useLatest } from "./hooks";
import { outlineClass, type OutlineTone } from "./outlines";
import { mediaError } from "./util";

export type CameraFrame = { image: string; width: number; height: number };

export type CameraHandle = {
  /** The current view as a JPEG data URL, longest side capped at maxSide. Null while the camera isn't live. */
  captureFrame: (maxSide?: number, quality?: number) => CameraFrame | null;
  /** The <video> element (for samplers that read it directly). */
  video: () => HTMLVideoElement | null;
};

export type CameraStatus =
  | "idle" // not running (or still looking up the permission)
  | "prompt" // showing the explainer, waiting for a tap
  | "starting"
  | "live"
  | "paused" // tab hidden: the stream is released and comes back on its own
  | "blocked" // permission denied
  | "error"
  | "unsupported"; // no camera API (e.g. plain http on a phone)

/** One set of outlines in one frame's pixel space. A new `key` redraws it (and pulses it once). */
export type StageOutline = {
  key: string;
  width: number;
  height: number;
  outlines: Outline[];
  tone?: OutlineTone;
  /** Pulse when first drawn (default true). */
  fresh?: boolean;
};

export type CameraIntro = { title: string; body: string; action?: string };

const DEFAULT_INTRO: CameraIntro = {
  title: "Turn on your camera",
  body: "We use the camera on the back of your phone. Nothing is recorded until you start.",
  action: "Turn on camera",
};

export default function CameraStage({
  ref,
  active = true,
  explain = true,
  intro = DEFAULT_INTRO,
  homeHref = "/",
  outlines,
  top,
  caption,
  bottom,
  children,
  onStatus,
  onStartTap,
}: {
  ref?: Ref<CameraHandle>;
  /** Run the camera while true. */
  active?: boolean;
  /** Show the explainer before the browser's permission prompt (skipped once permission is granted). */
  explain?: boolean;
  intro?: CameraIntro;
  /** Where "Back home" goes on the explainer and error screens. */
  homeHref?: string;
  outlines?: StageOutline[];
  top?: ReactNode;
  caption?: ReactNode;
  bottom?: ReactNode;
  /** Extra layers (sheets, coach overlays). Always rendered. */
  children?: ReactNode;
  onStatus?: (status: CameraStatus) => void;
  /** Runs inside the explainer's tap (e.g. to unlock speech on iOS). */
  onStartTap?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const genRef = useRef(0);
  const tappedRef = useRef(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [detail, setDetail] = useState("");
  const statusRef = useLatest(status);
  const onStatusRef = useLatest(onStatus);

  useEffect(() => {
    onStatusRef.current?.(status);
  }, [status, onStatusRef]);

  function release() {
    genRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }

  async function open() {
    release();
    const gen = genRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      if (gen !== genRef.current) return;
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setStatus("blocked");
      else {
        setDetail(mediaError(err, "camera"));
        setStatus("error");
      }
      return;
    }
    if (gen !== genRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => {});
    }
    if (gen !== genRef.current) return;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      // Unplugged, or taken by another app. A hidden tab handles its own restart.
      if (gen !== genRef.current || document.visibilityState !== "visible") return;
      setDetail("The camera stopped. Tap Try again.");
      setStatus("error");
    });
    setStatus("live");
  }

  // Start while active; release while the tab is hidden (and when Next hides this page on navigation).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const begin = async () => {
      if (explain && !tappedRef.current) {
        const state = await permissionState();
        if (cancelled) return;
        if (state === "denied") return setStatus("blocked");
        if (state !== "granted") return setStatus("prompt");
      }
      if (document.visibilityState === "hidden") return setStatus("paused");
      void open();
    };
    void begin();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (statusRef.current === "live" || statusRef.current === "starting") {
          release();
          setStatus("paused");
        }
      } else if (statusRef.current === "paused") void open();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
      setStatus("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/release only touch refs and state setters
  }, [active, explain]);

  useImperativeHandle(
    ref,
    () => ({
      captureFrame(maxSide = 1024, quality = 0.8) {
        const video = videoRef.current;
        if (!video || !streamRef.current || !video.videoWidth || !video.videoHeight) return null;
        const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          return { image: canvas.toDataURL("image/jpeg", quality), width: canvas.width, height: canvas.height };
        } catch {
          return null;
        }
      },
      video: () => videoRef.current,
    }),
    [],
  );

  function tapStart() {
    tappedRef.current = true;
    onStartTap?.();
    void open();
  }

  const panel =
    status === "prompt" ? (
      <Panel icon={<CameraIcon className="size-8" />} title={intro.title} body={intro.body} homeHref={homeHref}>
        <Button onDark size="lg" block onClick={tapStart}>
          {intro.action ?? DEFAULT_INTRO.action}
        </Button>
      </Panel>
    ) : status === "blocked" ? (
      <Panel icon={<AlertIcon className="size-8" />} title="Camera blocked" body="Your browser isn't letting this page use the camera. To allow it:" homeHref={homeHref}>
        <BlockedSteps />
        <Button onDark size="lg" block onClick={tapStart}>
          Try again
        </Button>
      </Panel>
    ) : status === "error" ? (
      <Panel icon={<AlertIcon className="size-8" />} title="Camera didn't start" body={detail} homeHref={homeHref}>
        <Button onDark size="lg" block onClick={tapStart}>
          Try again
        </Button>
      </Panel>
    ) : status === "unsupported" ? (
      <Panel
        icon={<AlertIcon className="size-8" />}
        title="Camera not available"
        body="This browser can't use the camera on this page. Open the link in Chrome or Safari, and make sure it starts with https://."
        homeHref={homeHref}
      />
    ) : null;

  const showBars = active && !panel;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />

      {outlines?.map((o) => (
        <svg
          key={o.key}
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${o.width} ${o.height}`}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
        >
          {o.outlines.map((p, i) => (
            <path
              key={`${p.id}-${i}`}
              d={p.path}
              transform={p.transform}
              className={outlineClass(o.tone, o.fresh ?? true)}
              vectorEffect="non-scaling-stroke"
              strokeWidth={4}
            />
          ))}
        </svg>
      ))}

      {showBars && (status === "starting" || status === "paused") && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/70" aria-live="polite">
          <span className="flex items-center gap-2 text-sm">
            <Spinner /> {status === "paused" ? "Camera paused" : "Starting camera…"}
          </span>
        </div>
      )}

      {showBars && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          <div className="pointer-events-auto bg-gradient-to-b from-black/60 to-transparent px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
            {top}
          </div>
          <div className="pointer-events-auto flex flex-col gap-3 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-12">
            {caption}
            {bottom}
          </div>
        </div>
      )}

      {panel}
      {children}
    </main>
  );
}

/** Full-screen explainer / error screen: what happened, one button, and a way home. */
function Panel({
  icon,
  title,
  body,
  homeHref,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  homeHref: string;
  children?: ReactNode;
}) {
  return (
    <section className="anim-fade absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-white/10" aria-hidden>
          {icon}
        </span>
        <h1 className="text-[28px] font-semibold leading-[34px]">{title}</h1>
        {body && <p className="text-base text-white/75">{body}</p>}
        {children}
        <Link href={homeHref} className="mt-1 flex min-h-12 items-center px-4 text-sm text-white/70 underline underline-offset-4">
          Back home
        </Link>
      </div>
    </section>
  );
}

function BlockedSteps() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const steps = /iPhone|iPad|iPod/.test(ua)
    ? ["Tap aA (or the page icon) in the address bar", "Tap Website Settings", "Set Camera to Allow"]
    : /Android/.test(ua)
      ? ["Tap the icon left of the web address", "Tap Permissions, then Camera", "Choose Allow"]
      : ["Click the camera or lock icon in the address bar", "Allow the camera for this site", "Come back here"];
  return (
    <ol className="w-full space-y-2 rounded-xl bg-white/10 p-4 text-left text-sm text-white/90">
      {steps.map((s, i) => (
        <li key={s} className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">{i + 1}</span>
          <span className="pt-0.5">{s}</span>
        </li>
      ))}
      <li className="pl-9 text-white/70">Then tap Try again. If nothing changes, reload the page.</li>
    </ol>
  );
}

async function permissionState(): Promise<PermissionState | "unknown"> {
  try {
    const p = await navigator.permissions.query({ name: "camera" as PermissionName });
    return p.state;
  } catch {
    return "unknown";
  }
}
