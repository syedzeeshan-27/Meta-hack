"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AddFrameRequest,
  AddFrameResponse,
  AddNoteRequest,
  Defect,
  DefectOutline,
  Frame,
  Inspection,
  InspectionKind,
  Severity,
} from "@/lib/inspect/types";
import { createKeyframeSampler, type Keyframe, type KeyframeSampler, type SkipReason } from "@/lib/keyframes";
import { startRecording, type WavRecorder } from "@/lib/wav-recorder";

const ROOM_PICKS = ["Living room", "Bedroom", "Kitchen", "Bathroom", "Balcony"];
const POLL_MS = 2500;
const MAX_IN_FLIGHT = 2;
const MAX_TRIES = 4;
const FLASH_MS = 2800;
const SPEAK_GAP_MS = 6000;
const HINT_MS = 2000;
const TOAST_MS = 3500;
const MIN_NOTE_MS = 600;
const STRIP_SIZE = 3;
const JSON_HEADERS = { "Content-Type": "application/json" };

type Mode = "idle" | "recording" | "paused";
type Sheet = "start" | "change" | "next";
type Upload = { body: AddFrameRequest; tries: number; error?: string };
type Flash = { id: string; outlines: DefectOutline[] };
type Toast = { text: string; error?: boolean };
type Finishing = { stage: "uploading" | "saving" | "failed" | "error"; message?: string };
type Timers = Partial<Record<"flash" | "hint" | "toast", ReturnType<typeof setTimeout>>>;

/** Move-in marks are amber ("already here"); move-out marks use the red tone-problem class. */
const AMBER_STROKE = "rgb(251 191 36)";
const RED_STROKE = "rgb(248 113 113)";
const AMBER_OUTLINE: CSSProperties = {
  stroke: AMBER_STROKE,
  fill: "rgb(251 191 36 / 0.18)",
  filter: "drop-shadow(0 0 6px rgb(251 191 36 / 0.9))",
};

const HINT_TEXT: Record<SkipReason, string> = {
  dark: "Too dark. Switch on a light.",
  blurry: "Hold steady for a moment.",
};

const SEVERITY_RANK: Record<Severity, number> = { major: 0, moderate: 1, minor: 2 };

const chip = "flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs backdrop-blur";

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export default function Walkthrough({ id }: { id: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const samplerRef = useRef<KeyframeSampler | null>(null);
  const roomRef = useRef("");
  const modeRef = useRef<Mode>("idle");
  const capturingRef = useRef(false);
  // Upload queue: never drops a frame silently. Failed ones wait in failedRef until retried.
  const queueRef = useRef<Upload[]>([]);
  const failedRef = useRef<Upload[]>([]);
  const inflightRef = useRef(0);
  const backoffRef = useRef(0);
  const drainRef = useRef<(() => void)[]>([]);
  /** Frames the server accepted that a poll hasn't returned yet (the poll may have been read before they landed). */
  const uploadedRef = useRef(new Map<string, { room: string; frame: Frame }>());
  /** Frame ids already indexed (or failed) when we last looked; null until the first poll. */
  const seenRef = useRef<Set<string> | null>(null);
  const lastKeyTRef = useRef(0);
  const lastSpokeRef = useRef(0);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const recorderRef = useRef<WavRecorder | null>(null);
  const holdingRef = useRef(false);
  const noteStartRef = useRef(0);
  const hintRef = useRef<SkipReason | null>(null);
  const timersRef = useRef<Timers>({});

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loadError, setLoadError] = useState("");
  const [missing, setMissing] = useState(false);
  const [room, setRoom] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [picker, setPicker] = useState<Sheet | null>(null);
  const [customRoom, setCustomRoom] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [uploads, setUploads] = useState({ active: 0, failed: 0 });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [hint, setHint] = useState<SkipReason | null>(null);
  const [voice, setVoice] = useState<"idle" | "recording" | "sending">("idle");
  const [toast, setToast] = useState<Toast | null>(null);
  const [finishing, setFinishing] = useState<Finishing | null>(null);

  const kind: InspectionKind = inspection?.kind ?? "move_in";
  const live = mode !== "idle";
  const recording = mode === "recording";
  const capturing = recording && !picker && !finishing;
  const sheet: Sheet | null = mode === "idle" ? "start" : picker;

  function changeMode(m: Mode) {
    modeRef.current = m;
    setMode(m);
  }

  // ---------- speech ----------

  function speak(text: string, force = false) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || !text || recorderRef.current || holdingRef.current) return;
    const now = Date.now();
    if (!force && now - lastSpokeRef.current < SPEAK_GAP_MS) return;
    lastSpokeRef.current = now;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    utterRef.current = u; // Chrome drops events for utterances that get garbage-collected
    synth.speak(u);
  }

  function showToast(text: string, error = false) {
    clearTimeout(timersRef.current.toast);
    setToast({ text, error });
    timersRef.current.toast = setTimeout(() => setToast(null), TOAST_MS);
  }

  // ---------- inspection state from the server ----------

  function onInspection(data: Inspection) {
    const local = uploadedRef.current;
    const present = new Set(data.rooms.flatMap((r) => r.frames.map((f) => f.id)));
    for (const frameId of [...local.keys()]) if (present.has(frameId)) local.delete(frameId);
    let merged = data;
    for (const { room: r, frame } of local.values()) merged = withFrame(merged, r, frame);
    setInspection(merged);
    announce(data);
  }

  /** Newly indexed frames: flash the newest one's outlines if the camera is still on that view, and say one line. */
  function announce(data: Inspection) {
    const all = data.rooms.flatMap((r) => r.frames.map((frame) => ({ room: r.name, frame })));
    if (!seenRef.current) {
      seenRef.current = new Set(all.filter((x) => x.frame.status !== "pending").map((x) => x.frame.id));
      return;
    }
    const seen = seenRef.current;
    const fresh = all.filter((x) => x.frame.status !== "pending" && !seen.has(x.frame.id));
    fresh.forEach((x) => seen.add(x.frame.id));
    if (!capturingRef.current) return;

    const hit = fresh
      .filter((x) => x.frame.status === "indexed" && x.frame.defects.length > 0 && x.room === roomRef.current)
      .sort((a, b) => b.frame.t - a.frame.t)[0];
    if (!hit) return;

    // Only the latest keyframe: no newer one means the view hasn't changed much since, so outlines still line up.
    const latest = Math.max(lastKeyTRef.current, ...all.map((x) => x.frame.t));
    if (hit.frame.t >= latest) {
      const outlines = hit.frame.defects.flatMap((d) => (d.outline && d.outline.outlines.length ? [d.outline] : []));
      if (outlines.length) {
        clearTimeout(timersRef.current.flash);
        setFlash({ id: hit.frame.id, outlines });
        timersRef.current.flash = setTimeout(() => setFlash(null), FLASH_MS);
      }
    }
    speak(lineFor(hit.frame.defects));
  }

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    const run = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/inspections/${encodeURIComponent(id)}`, { cache: "no-store" });
          const data = (await res.json().catch(() => ({}))) as Inspection & { error?: string };
          if (!res.ok || data.error || !Array.isArray(data.rooms)) throw new HttpError(data.error ?? `HTTP ${res.status}`, res.status);
          if (!alive) return;
          fails = 0;
          setLoadError("");
          setMissing(false);
          onInspection(data);
        } catch (err) {
          if (!alive) return;
          if (err instanceof HttpError && err.status === 404) setMissing(true);
          else if (++fails >= 2) setLoadError(short(err));
        }
      }
      if (alive) timer = setTimeout(run, POLL_MS);
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onInspection only touches refs and state setters
  }, [id]);

  // Remember the room across a reload.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(roomKey(id));
      if (saved && !roomRef.current) {
        roomRef.current = saved;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
        setRoom(saved);
      }
    } catch {}
  }, [id]);

  // ---------- uploads ----------

  function onKeyframe(k: Keyframe) {
    lastKeyTRef.current = k.t;
    const r = roomRef.current;
    if (!r) return;
    queueRef.current.push({ body: { room: r, t: k.t, image: k.image, width: k.width, height: k.height }, tries: 0 });
    pump();
  }

  function onSkip(reason: SkipReason) {
    if (hintRef.current !== reason) {
      hintRef.current = reason;
      setHint(reason);
    }
    clearTimeout(timersRef.current.hint);
    timersRef.current.hint = setTimeout(() => {
      hintRef.current = null;
      setHint(null);
    }, HINT_MS);
  }

  function pump() {
    while (inflightRef.current < MAX_IN_FLIGHT && queueRef.current.length) {
      const job = queueRef.current.shift()!;
      inflightRef.current++;
      void send(job);
    }
    syncUploads();
  }

  function syncUploads() {
    const active = queueRef.current.length + inflightRef.current + backoffRef.current;
    setUploads({ active, failed: failedRef.current.length });
    if (!active && drainRef.current.length) {
      const waiters = drainRef.current;
      drainRef.current = [];
      waiters.forEach((w) => w());
    }
  }

  function waitForUploads(): Promise<void> {
    if (!(queueRef.current.length + inflightRef.current + backoffRef.current)) return Promise.resolve();
    return new Promise((resolve) => drainRef.current.push(resolve));
  }

  async function send(job: Upload) {
    try {
      const res = await fetch(`/api/inspections/${encodeURIComponent(id)}/frames`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(job.body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AddFrameResponse> & { error?: string };
      if (!res.ok || data.error || !data.frame) throw new HttpError(data.error ?? `HTTP ${res.status}`, res.status);
      const frame = data.frame;
      uploadedRef.current.set(frame.id, { room: job.body.room, frame });
      setInspection((i) => i && withFrame(i, job.body.room, frame));
    } catch (err) {
      job.tries++;
      job.error = short(err);
      const status = err instanceof HttpError ? err.status : 0;
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
      if (!permanent && job.tries < MAX_TRIES) {
        backoffRef.current++;
        setTimeout(() => {
          backoffRef.current--;
          queueRef.current.unshift(job);
          pump();
        }, 1000 * 2 ** job.tries);
      } else failedRef.current.push(job);
    } finally {
      inflightRef.current--;
      pump();
    }
  }

  function retryFailed() {
    const jobs = failedRef.current;
    failedRef.current = [];
    queueRef.current.push(...jobs.map((j) => ({ ...j, tries: 0 })));
    pump();
  }

  // ---------- camera + keyframes ----------

  // Keep the sampler in step with what's on screen. Defined before the camera effect so the ref is set first.
  useEffect(() => {
    capturingRef.current = capturing;
    const s = samplerRef.current;
    if (!s) return;
    if (capturing) s.resume();
    else s.pause();
  }, [capturing]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let sampler: KeyframeSampler | null = null;
    const video = videoRef.current;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (err) {
        if (!cancelled) setCameraError(short(err));
        return;
      }
      if (cancelled || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (cancelled) return;
      setCameraError("");
      sampler = createKeyframeSampler(video, { onKeyframe: (k) => onKeyframe(k), onSkip: (r) => onSkip(r) });
      if (!capturingRef.current) sampler.pause();
      sampler.start();
      samplerRef.current = sampler;
    })();
    return () => {
      cancelled = true;
      sampler?.stop();
      if (samplerRef.current === sampler) samplerRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callbacks only touch refs and state setters
  }, [live]);

  // Keep the screen awake while recording.
  useEffect(() => {
    if (!recording || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const acquire = async () => {
      if (done || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (done) void l.release().catch(() => {});
        else lock = l;
      } catch {}
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [recording]);

  // Warn before closing the tab with photos still uploading.
  const uploading = uploads.active > 0;
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  // Next keeps this page alive (hidden) after navigating away. Pause so coming back doesn't film straight away.
  useLayoutEffect(
    () => () => {
      if (modeRef.current === "recording") changeMode("paused");
      const rec = recorderRef.current;
      recorderRef.current = null;
      holdingRef.current = false;
      if (rec) void rec.stop().catch(() => {});
      setVoice("idle");
      window.speechSynthesis?.cancel();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only
    [],
  );

  // ---------- rooms ----------

  function chooseRoom(name: string) {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!clean) return;
    if (clean !== roomRef.current) samplerRef.current?.reset(); // keep the first view of a new room straight away
    roomRef.current = clean;
    setRoom(clean);
    setCustomRoom("");
    try {
      sessionStorage.setItem(roomKey(id), clean);
    } catch {}
    const from = sheet;
    setPicker(null);
    if (from === "start") {
      // iOS only lets speech play once something was spoken inside a tap.
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
      changeMode("recording");
      speak(`Recording ${clean}. Move slowly.`, true);
    } else if (from === "next") {
      changeMode("recording");
      speak(`Recording ${clean}.`, true);
    }
  }

  // ---------- voice notes (hold to talk) ----------

  async function voiceDown() {
    if (voice !== "idle" || holdingRef.current) return;
    holdingRef.current = true;
    window.speechSynthesis?.cancel();
    try {
      const rec = await startRecording();
      if (!holdingRef.current) {
        void rec.stop().catch(() => {});
        showToast("Hold the button while you talk.");
        return;
      }
      recorderRef.current = rec;
      noteStartRef.current = Date.now();
      setVoice("recording");
    } catch (err) {
      holdingRef.current = false;
      showToast(`Mic blocked: ${short(err)}`, true);
    }
  }

  async function voiceUp() {
    holdingRef.current = false;
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    const t = noteStartRef.current;
    const noteRoom = roomRef.current;
    setVoice("sending");
    let text = "";
    try {
      const wav = await rec.stop();
      if (Date.now() - t < MIN_NOTE_MS) {
        showToast("Hold the button while you talk.");
        return;
      }
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      const heard = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
      if (!res.ok || heard.error) throw new Error(heard.error ?? `HTTP ${res.status}`);
      text = (heard.transcript ?? "").trim();
      if (!/[a-z0-9]{2,}/i.test(text)) {
        showToast("Didn't catch that. Try again.");
        return;
      }
      const body: AddNoteRequest = { room: noteRoom, t, text };
      const saved = await fetch(`/api/inspections/${encodeURIComponent(id)}/notes`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      const ok = (await saved.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!saved.ok || ok.error) throw new Error(ok.error ?? `HTTP ${saved.status}`);
      showToast(`Note saved: “${text}”`);
    } catch (err) {
      showToast(text ? `Note not saved (“${text}”): ${short(err)}` : `Note not saved: ${short(err)}`, true);
    } finally {
      setVoice("idle");
    }
  }

  // ---------- finish ----------

  async function finishInspection(force = false) {
    setPicker(null);
    setFinishing({ stage: "uploading" });
    await waitForUploads();
    if (failedRef.current.length && !force) {
      const n = failedRef.current.length;
      setFinishing({ stage: "failed", message: `${n} ${n === 1 ? "photo" : "photos"} didn't upload.` });
      return;
    }
    setFinishing({ stage: "saving" });
    try {
      const res = await fetch(`/api/inspections/${encodeURIComponent(id)}/finish`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Partial<Inspection> & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      window.speechSynthesis?.cancel();
      changeMode("idle");
      setFinishing(null);
      setInspection((i) => (i ? { ...i, finishedAt: data.finishedAt ?? Date.now() } : i));
      const k = data.kind ?? inspection?.kind;
      router.push(k === "move_out" ? `/r/${encodeURIComponent(id)}` : `/?saved=${encodeURIComponent(id)}`);
    } catch (err) {
      setFinishing({ stage: "error", message: short(err) });
    }
  }

  // ---------- derived ----------

  const currentRoom = inspection?.rooms.find((r) => r.name === room);
  const roomFrames = currentRoom?.frames ?? [];
  const checking = roomFrames.filter((f) => f.status === "pending").length;
  const marks = uniqueMarks(roomFrames);
  const strip = marks.slice(0, STRIP_SIZE);
  const notes = currentRoom?.notes.length ?? 0;
  const tally = [
    plural(roomFrames.length, "photo"),
    `${marks.length} ${marks.length === 1 ? "mark" : "marks"} noted`,
    checking ? `${checking} checking` : "",
    notes ? plural(notes, "note") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const resumeRoom = room || inspection?.rooms.at(-1)?.name || "";
  const roomOptions = [...ROOM_PICKS, ...(inspection?.rooms.map((r) => r.name).filter((n) => !ROOM_PICKS.includes(n)) ?? [])].map((name) => ({
    name,
    photos: inspection?.rooms.find((r) => r.name === name)?.frames.length ?? 0,
  }));

  const outlineClass = kind === "move_out" ? "part-outline tone-problem" : "part-outline";
  const outlineStyle = kind === "move_out" ? undefined : AMBER_OUTLINE;
  const kindLabel = kind === "move_out" ? "Move-out" : "Move-in";

  // ---------- render ----------

  let body: ReactNode;
  if (missing) {
    body = (
      <Centered>
        <p className="text-lg font-semibold">We couldn&rsquo;t find this inspection.</p>
        <Link href="/" className="mt-4 block rounded-full bg-white py-3 font-semibold text-black">
          Back home
        </Link>
      </Centered>
    );
  } else if (!inspection) {
    body = (
      <Centered>
        <p className="text-white/70">{loadError ? "Can’t reach the server. Retrying…" : "Loading…"}</p>
        {loadError && <p className="mt-1 text-xs text-white/40">{loadError}</p>}
      </Centered>
    );
  } else if (inspection.finishedAt) {
    const photos = inspection.rooms.reduce((n, r) => n + r.frames.length, 0);
    body = (
      <Centered>
        <p className="text-lg font-semibold">{kind === "move_out" ? "Move-out finished" : "Move-in saved"}</p>
        <p className="mt-1 text-sm text-white/60">
          {inspection.property} · {plural(inspection.rooms.length, "room")} · {plural(photos, "photo")}
        </p>
        {kind === "move_out" && (
          <Link href={`/r/${encodeURIComponent(id)}`} className="mt-4 block rounded-full bg-white py-3 font-semibold text-black">
            View report
          </Link>
        )}
        <Link href="/" className="mt-2 block py-2 text-sm text-white/60">
          Back home
        </Link>
      </Centered>
    );
  } else {
    body = (
      <>
        {flash &&
          flash.outlines.map((o, i) => (
            <svg
              key={`${flash.id}-${i}`}
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${o.width} ${o.height}`}
              preserveAspectRatio="xMidYMid slice"
            >
              {o.outlines.map((p, j) => (
                <path
                  key={`${p.id}-${j}`}
                  d={p.path}
                  transform={p.transform}
                  className={outlineClass}
                  style={outlineStyle}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={4}
                />
              ))}
            </svg>
          ))}

        {/* Top bar: exit, room, status */}
        <header className="absolute inset-x-0 top-0 flex flex-col gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <Link href="/" className={chip}>
              Exit
            </Link>
            <button onClick={() => setPicker("change")} disabled={!live} className={`${chip} min-w-0 text-sm font-medium`}>
              <span className="truncate">{room || "Choose room"}</span>
              <span aria-hidden className="text-white/60">
                ▾
              </span>
            </button>
            <span className={`${chip} ml-auto shrink-0`}>
              <span className={`h-2 w-2 rounded-full ${capturing ? "animate-pulse bg-red-500" : "bg-white/40"}`} />
              {capturing ? "Recording" : mode === "paused" ? "Paused" : "Ready"}
            </span>
          </div>
          {live && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-black/60 px-2.5 py-1 backdrop-blur">{tally}</span>
              {uploads.active > 0 && <span className="rounded-full bg-black/60 px-2.5 py-1 text-white/80 backdrop-blur">{uploads.active} uploading</span>}
              {uploads.failed > 0 && (
                <button onClick={retryFailed} className="rounded-full bg-red-500/90 px-2.5 py-1">
                  {uploads.failed} didn&rsquo;t upload · Retry
                </button>
              )}
              {capturing && hint && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-black">{HINT_TEXT[hint]}</span>}
              {loadError && <span className="rounded-full bg-black/60 px-2.5 py-1 text-white/60 backdrop-blur">Reconnecting…</span>}
            </div>
          )}
        </header>

        {live && cameraError && (
          <Centered>
            <p className="font-semibold">Camera blocked</p>
            <p className="mt-1 text-sm text-white/60">{cameraError}</p>
            <p className="mt-2 text-sm text-white/60">Allow camera access for this site, then try again.</p>
            <button
              onClick={() => {
                setCameraError("");
                changeMode("idle");
              }}
              className="mt-4 w-full rounded-full bg-white py-3 font-semibold text-black"
            >
              Try again
            </button>
          </Centered>
        )}

        {/* Bottom bar: latest marks, then Voice note · Pause/Resume · Finish room */}
        {live && (
          <footer className="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-gradient-to-t from-black/70 to-transparent p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {toast && (
              <p className={`max-w-full self-center rounded-2xl px-3 py-1.5 text-center text-sm backdrop-blur ${toast.error ? "bg-red-500/90" : "bg-black/70"}`}>
                {toast.text}
              </p>
            )}
            {strip.length > 0 && (
              <ul className="-mx-3 flex gap-2 overflow-x-auto px-3">
                {strip.map(({ frame, defect }) => (
                  <li key={`${frame.id}-${defect.id}`} className="flex w-60 shrink-0 items-center gap-2 rounded-xl bg-black/60 p-1.5 pr-3 backdrop-blur">
                    <DefectThumb frame={frame} defect={defect} kind={kind} />
                    <p className="line-clamp-2 text-xs leading-snug text-white/90">{defect.description || defect.phrase}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-3 items-center">
              <button
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  void voiceDown();
                }}
                onPointerUp={() => void voiceUp()}
                onPointerCancel={() => void voiceUp()}
                onContextMenu={(e) => e.preventDefault()}
                disabled={voice === "sending"}
                className={`justify-self-start touch-none rounded-full px-4 py-3 text-sm font-medium transition disabled:opacity-60 ${
                  voice === "recording" ? "scale-105 bg-red-500" : "bg-white/15 backdrop-blur"
                }`}
              >
                {voice === "recording" ? "Listening…" : voice === "sending" ? "Saving…" : "Voice note"}
              </button>
              <button
                onClick={() => changeMode(recording ? "paused" : "recording")}
                aria-pressed={!recording}
                className={`h-20 w-20 justify-self-center rounded-full text-sm font-semibold shadow-lg ${
                  recording ? "border-4 border-white/80 bg-red-500 text-white" : "bg-white text-black"
                }`}
              >
                {recording ? "Pause" : "Resume"}
              </button>
              <button onClick={() => setPicker("next")} className="justify-self-end rounded-full bg-white/15 px-4 py-3 text-sm font-medium backdrop-blur">
                Finish room
              </button>
            </div>
          </footer>
        )}

        {/* Room picker sheet: start, change room, or after finishing a room */}
        {sheet && !cameraError && (
          <div className="absolute inset-0 flex items-end bg-black/50" onClick={sheet === "start" ? undefined : () => setPicker(null)}>
            <section
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-neutral-900 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
              <h2 className="text-lg font-semibold">
                {sheet === "start" ? "Which room are you in?" : sheet === "next" ? `${room} done. Where next?` : "Change room"}
              </h2>
              {sheet === "start" && (
                <p className="mt-1 text-sm text-white/60">
                  {kindLabel} · {inspection.property}. Walk slowly and point at the walls, floor, ceiling and fittings. Photos are taken for you.
                </p>
              )}
              {sheet === "start" && resumeRoom && (
                <button onClick={() => chooseRoom(resumeRoom)} className="mt-4 w-full rounded-full bg-white py-3 font-semibold text-black">
                  Continue in {resumeRoom}
                </button>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {roomOptions.map((r) => (
                  <button
                    key={r.name}
                    onClick={() => chooseRoom(r.name)}
                    className={`rounded-xl px-3 py-3 text-left text-sm ${r.name === room && sheet === "change" ? "bg-white text-black" : "bg-white/10"}`}
                  >
                    <span className="block truncate font-medium">{r.name}</span>
                    {r.photos > 0 && <span className="block text-xs opacity-60">{plural(r.photos, "photo")}</span>}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  chooseRoom(customRoom);
                }}
                className="mt-2 flex gap-2"
              >
                <input
                  value={customRoom}
                  onChange={(e) => setCustomRoom(e.target.value)}
                  maxLength={40}
                  placeholder="Other room, e.g. Bedroom 2"
                  className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-3 text-base outline-none placeholder:text-white/40 focus:ring-2 focus:ring-white/40"
                />
                <button type="submit" disabled={!customRoom.trim()} className="rounded-xl bg-white/20 px-4 text-sm font-medium disabled:opacity-40">
                  Go
                </button>
              </form>
              {sheet === "next" && (
                <div className="mt-5 flex flex-col gap-2 border-t border-white/10 pt-4">
                  <button onClick={() => void finishInspection()} className="w-full rounded-full bg-white py-3.5 font-semibold text-black">
                    Finish inspection
                  </button>
                  <button onClick={() => setPicker(null)} className="py-2 text-sm text-white/60">
                    Keep filming {room}
                  </button>
                </div>
              )}
              {sheet === "change" && (
                <button onClick={() => setPicker(null)} className="mt-3 w-full py-2 text-sm text-white/60">
                  Cancel
                </button>
              )}
              {sheet === "start" && (
                <Link href="/" className="mt-3 block py-2 text-center text-sm text-white/60">
                  Back home
                </Link>
              )}
            </section>
          </div>
        )}

        {finishing && (
          <Centered dim>
            {finishing.stage === "uploading" && (
              <p>{uploads.active > 0 ? `Uploading ${plural(uploads.active, "photo")} before finishing…` : "Finishing…"}</p>
            )}
            {finishing.stage === "saving" && <p>{kind === "move_out" ? "Saving and starting the comparison…" : "Saving your move-in record…"}</p>}
            {finishing.stage === "failed" && (
              <>
                <p className="font-semibold">{finishing.message}</p>
                <p className="mt-1 text-sm text-white/60">Check your connection and try again, or finish without them.</p>
                <button
                  onClick={() => {
                    retryFailed();
                    void finishInspection();
                  }}
                  className="mt-4 w-full rounded-full bg-white py-3 font-semibold text-black"
                >
                  Retry upload
                </button>
                <button onClick={() => void finishInspection(true)} className="mt-2 w-full rounded-full bg-white/15 py-3 text-sm font-medium">
                  Finish without them
                </button>
                <button onClick={() => setFinishing(null)} className="mt-1 w-full py-2 text-sm text-white/60">
                  Back
                </button>
              </>
            )}
            {finishing.stage === "error" && (
              <>
                <p className="font-semibold">Couldn&rsquo;t finish the inspection.</p>
                <p className="mt-1 break-words text-sm text-white/60">{finishing.message}</p>
                <button onClick={() => void finishInspection()} className="mt-4 w-full rounded-full bg-white py-3 font-semibold text-black">
                  Try again
                </button>
                <button onClick={() => setFinishing(null)} className="mt-1 w-full py-2 text-sm text-white/60">
                  Back
                </button>
              </>
            )}
          </Centered>
        )}
      </>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      {body}
    </main>
  );
}

function Centered({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <div className={`absolute inset-0 flex items-center justify-center p-6 ${dim ? "bg-black/70" : "pointer-events-none"}`}>
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-center">{children}</div>
    </div>
  );
}

/** A tiny crop of the frame around the mark, with its outline; the whole frame if SAM couldn't place it. */
function DefectThumb({ frame, defect, kind }: { frame: Frame; defect: Defect; kind: InspectionKind }) {
  const o = defect.outline;
  const box = o ? cropBox(o) : null;
  if (!o || !box) {
    // eslint-disable-next-line @next/next/no-img-element -- stored photo URL, tiny thumbnail
    return <img src={frame.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <svg viewBox={box.join(" ")} preserveAspectRatio="xMidYMid slice" className="h-11 w-11 shrink-0 rounded-lg bg-black" aria-hidden>
      <image href={frame.imageUrl} x={0} y={0} width={o.width} height={o.height} preserveAspectRatio="none" />
      {o.outlines.map((p, i) => (
        <path
          key={`${p.id}-${i}`}
          d={p.path}
          transform={p.transform}
          fill="none"
          stroke={kind === "move_out" ? RED_STROKE : AMBER_STROKE}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** Square viewBox around all the outline boxes, with some margin, kept inside the frame. */
function cropBox(o: DefectOutline): [number, number, number, number] | null {
  const boxes = o.outlines.map((x) => x.box).filter((b) => b && b.right > b.left && b.bottom > b.top);
  if (!boxes.length || !o.width || !o.height) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.right));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  const longest = Math.max(o.width, o.height);
  const side = Math.min(Math.min(o.width, o.height), Math.max(longest * 0.15, Math.max(right - left, bottom - top) * 1.6));
  const x = clamp((left + right) / 2 - side / 2, 0, o.width - side);
  const y = clamp((top + bottom) / 2 - side / 2, 0, o.height - side);
  return [round(x), round(y), round(side), round(side)];
}

/** Marks in a room, newest first, one per phrase (the same crack shows up in several photos). */
function uniqueMarks(frames: Frame[]): { frame: Frame; defect: Defect }[] {
  const byPhrase = new Map<string, { frame: Frame; defect: Defect }>();
  for (const frame of [...frames].sort((a, b) => b.t - a.t)) {
    for (const defect of frame.defects) {
      const key = (defect.phrase || defect.description).trim().toLowerCase();
      if (!byPhrase.has(key)) byPhrase.set(key, { frame, defect });
    }
  }
  return [...byPhrase.values()];
}

function lineFor(defects: Defect[]): string {
  const [top, ...rest] = [...defects].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (!top) return "";
  const what = top.phrase || top.description;
  return rest.length ? `Noted: ${what}, and ${rest.length} more.` : `Noted: ${what}.`;
}

function withFrame(i: Inspection, room: string, frame: Frame): Inspection {
  if (i.rooms.some((r) => r.frames.some((f) => f.id === frame.id))) return i;
  const rooms = i.rooms.some((r) => r.name === room)
    ? i.rooms.map((r) => (r.name === room ? { ...r, frames: [...r.frames, frame] } : r))
    : [...i.rooms, { name: room, notes: [], frames: [frame] }];
  return { ...i, rooms };
}

function roomKey(id: string) {
  return `dg.room.${id}`;
}

function plural(n: number, word: string) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}
