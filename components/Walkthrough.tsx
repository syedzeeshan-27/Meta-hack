"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import AskSheet from "@/components/AskSheet";
import CameraStage, { type CameraHandle, type CameraStatus, type StageOutline } from "@/components/camera/CameraStage";
import { CoachOverlay, type CoachTip } from "@/components/camera/CoachOverlay";
import { DesktopHandoff } from "@/components/camera/DesktopHandoff";
import { RoundButton } from "@/components/camera/RoundButton";
import { useIsDesktop, useLatest, useLocalFlag, useOnline } from "@/components/camera/hooks";
import { outlineClass, type OutlineTone } from "@/components/camera/outlines";
import { useAskSession } from "@/components/camera/useAskSession";
import { clock, plural, short } from "@/components/camera/util";
import {
  Button,
  ButtonLink,
  CaptionBar,
  Card,
  CheckIcon,
  ChevronDownIcon,
  Chip,
  CloseIcon,
  IconButton,
  MicIcon,
  Page,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Sheet,
  SparkleIcon,
  Spinner,
  StatusPill,
  type Tone,
} from "@/components/ui";

const ROOM_PICKS = ["Living room", "Bedroom", "Kitchen", "Bathroom", "Balcony"];
const POLL_MS = 2500;
const MAX_IN_FLIGHT = 2;
const MAX_TRIES = 4;
const FLASH_MS = 2800;
const SPEAK_GAP_MS = 6000;
const HINT_MS = 2000;
const CAPTION_MS = 5000;
const MIN_NOTE_MS = 600;
const STRIP_SIZE = 3;
const MIN_ROOM_PHOTOS = 3;
const ASK_MAX_SIDE = 1024;
const COACH_KEY = "dg.coach.v1";
const JSON_HEADERS = { "Content-Type": "application/json" };

type Mode = "idle" | "recording" | "paused";
type PickerKind = "start" | "change" | "next";
type Upload = { body: AddFrameRequest; tries: number; error?: string };
type Flash = { id: string; outlines: DefectOutline[] };
type Caption = { text: string; sub?: string };
type Finishing = { stage: "uploading" | "saving" | "failed" | "error"; message?: string; total: number };
type ConfirmFinish = { thin: { name: string; photos: number }[]; empty: boolean };
type Timers = Partial<Record<"flash" | "hint" | "caption", ReturnType<typeof setTimeout>>>;

const HINT_TEXT: Record<SkipReason, string> = {
  dark: "Too dark: turn on a light.",
  blurry: "Too blurry: hold steady for a second.",
};

const SEVERITY_RANK: Record<Severity, number> = { major: 0, moderate: 1, minor: 2 };

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export default function Walkthrough({ id }: { id: string }) {
  const router = useRouter();
  const camRef = useRef<CameraHandle>(null);
  const samplerRef = useRef<KeyframeSampler | null>(null);
  const roomRef = useRef("");
  const modeRef = useRef<Mode>("idle");
  const capturingRef = useRef(false);
  const askOpenRef = useRef(false);
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
  const finishRunRef = useRef(0);

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loadError, setLoadError] = useState("");
  const [missing, setMissing] = useState(false);
  const [room, setRoom] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [startDismissed, setStartDismissed] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [customRoom, setCustomRoom] = useState("");
  const [confirm, setConfirm] = useState<ConfirmFinish | null>(null);
  const [doneRooms, setDoneRooms] = useState<string[]>([]);
  const [camStatus, setCamStatus] = useState<CameraStatus>("idle");
  const [uploads, setUploads] = useState({ active: 0, failed: 0 });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [hint, setHint] = useState<SkipReason | null>(null);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [voice, setVoice] = useState<"idle" | "recording" | "sending">("idle");
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [rec, setRec] = useState({ acc: 0, since: 0 });
  const [now, setNow] = useState(0);
  const [cameraAnyway, setCameraAnyway] = useState(false);

  const isDesktop = useIsDesktop();
  const online = useOnline();
  const [coachSeen, markCoachSeen] = useLocalFlag(COACH_KEY);
  const ask = useAskSession({ capture: () => camRef.current?.captureFrame(ASK_MAX_SIDE, 0.8) ?? null });
  const askLatest = useLatest(ask);

  const kind: InspectionKind = inspection?.kind ?? "move_in";
  const recording = mode === "recording";
  const camLive = camStatus === "live";
  const camUp = camLive || camStatus === "starting" || camStatus === "paused";
  const showCoach = camLive && !coachSeen;
  const sheet: PickerKind | null = mode === "idle" && !startDismissed ? "start" : picker;
  const sheetOpen = !!sheet && camUp && !showCoach && !finishing;
  const capturing = recording && camLive && !sheetOpen && !finishing && !askOpen && !leaveOpen && !showCoach;

  function changeMode(m: Mode) {
    const t = Date.now();
    setRec((r) => (m === "recording" ? (r.since ? r : { acc: r.acc, since: t }) : r.since ? { acc: r.acc + t - r.since, since: 0 } : r));
    setNow(t);
    modeRef.current = m;
    setMode(m);
  }

  // ---------- speech + captions ----------

  function speak(text: string, force = false) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || !text || recorderRef.current || holdingRef.current || askOpenRef.current) return;
    const t = Date.now();
    if (!force && t - lastSpokeRef.current < SPEAK_GAP_MS) return;
    lastSpokeRef.current = t;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    utterRef.current = u; // Chrome drops events for utterances that get garbage-collected
    synth.speak(u);
  }

  function showCaption(text: string, sub?: string) {
    clearTimeout(timersRef.current.caption);
    setCaption({ text, sub });
    timersRef.current.caption = setTimeout(() => setCaption(null), CAPTION_MS);
  }

  /** Caption always; speech when it isn't throttled. */
  function say(text: string, force = false) {
    if (!text) return;
    showCaption(text);
    speak(text, force);
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
    say(lineFor(hit.frame.defects));
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
    // Offline: hold the queue (don't burn retries); the `online` listener pumps again.
    while (navigator.onLine !== false && inflightRef.current < MAX_IN_FLIGHT && queueRef.current.length) {
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
      job.error = short(err);
      const status = err instanceof HttpError ? err.status : 0;
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
      if (!permanent && navigator.onLine === false) {
        queueRef.current.unshift(job); // went offline mid-upload: wait for the connection, no retry used
      } else if (!permanent && ++job.tries < MAX_TRIES) {
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

  // Back online: send what waited, and retry what failed.
  useEffect(() => {
    const onOnline = () => retryFailed();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryFailed only touches refs and state setters
  }, []);

  // ---------- keyframes ----------

  // Keep the sampler in step with what's on screen. Declared before the sampler effect so the ref is set first.
  useEffect(() => {
    capturingRef.current = capturing;
    const s = samplerRef.current;
    if (!s) return;
    if (capturing) s.resume();
    else s.pause();
  }, [capturing]);

  // One sampler per live camera stream (a hidden tab releases the camera; it comes back as a new stream).
  useEffect(() => {
    if (camStatus !== "live") return;
    const video = camRef.current?.video();
    if (!video) return;
    const sampler = createKeyframeSampler(video, { onKeyframe: (k) => onKeyframe(k), onSkip: (r) => onSkip(r) });
    if (!capturingRef.current) sampler.pause();
    sampler.start();
    samplerRef.current = sampler;
    return () => {
      sampler.stop();
      if (samplerRef.current === sampler) samplerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callbacks only touch refs and state setters
  }, [camStatus]);

  // REC clock.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [recording]);

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
  const unsent = uploads.active + uploads.failed;
  const hasUnsent = unsent > 0;
  useEffect(() => {
    if (!hasUnsent) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsent]);

  // Next keeps this page alive (hidden) after navigating away. Pause so coming back doesn't film straight away,
  // and close the transient sheets (Ask's mic is released by its own hook).
  useLayoutEffect(
    () => () => {
      if (modeRef.current === "recording") changeMode("paused");
      const rec = recorderRef.current;
      recorderRef.current = null;
      holdingRef.current = false;
      if (rec) void rec.stop().catch(() => {});
      setVoice("idle");
      askOpenRef.current = false;
      askLatest.current.stop();
      setAskOpen(false);
      setLeaveOpen(false);
      window.speechSynthesis?.cancel();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only
    [],
  );

  // ---------- rooms ----------

  /** start: the first room (starts recording). record: switch and keep filming. keep: switch, same mode. */
  function chooseRoom(name: string, then: "start" | "record" | "keep") {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!clean) return;
    if (clean !== roomRef.current) samplerRef.current?.reset(); // keep the first view of a new room straight away
    roomRef.current = clean;
    setRoom(clean);
    setCustomRoom("");
    setOtherOpen(false);
    setConfirm(null);
    setDoneRooms((d) => d.filter((r) => r !== clean));
    try {
      sessionStorage.setItem(roomKey(id), clean);
    } catch {}
    setPicker(null);
    if (then === "start") {
      // iOS only lets speech play once something was spoken inside a tap.
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
      changeMode("recording");
      say(`Recording ${clean}. Move slowly.`, true);
    } else if (then === "record") {
      changeMode("recording");
      say(`Recording ${clean}.`, true);
    } else showCaption(`Now in ${clean}`);
  }

  function pickRoom(name: string) {
    chooseRoom(name, sheet === "start" ? "start" : sheet === "next" ? "record" : "keep");
  }

  function openStart() {
    setStartDismissed(false);
    setPicker("start");
  }

  function closeSheet() {
    if (sheet === "start") setStartDismissed(true);
    if (sheet === "next") setDoneRooms((d) => d.filter((r) => r !== room)); // closed it: still filming this room
    setPicker(null);
    setOtherOpen(false);
    setConfirm(null);
  }

  function doneWithRoom() {
    if (room) setDoneRooms((d) => (d.includes(room) ? d : [...d, room]));
    setPicker("next");
  }

  function togglePause() {
    if (mode === "idle" || !room) return openStart();
    changeMode(recording ? "paused" : "recording");
  }

  // ---------- leaving ----------

  function requestLeave() {
    if (unsent > 0) setLeaveOpen(true);
    else router.push("/");
  }

  // ---------- Ask (same camera, sheet over it) ----------

  function openAsk() {
    window.speechSynthesis?.cancel();
    askOpenRef.current = true;
    setAskOpen(true);
    void ask.start(); // inside the tap: the mic needs it on iOS
  }

  function closeAsk() {
    askOpenRef.current = false;
    ask.stop();
    ask.clearOutline();
    setAskOpen(false);
  }

  // ---------- voice notes (hold to talk) ----------

  async function voiceDown() {
    if (voice !== "idle" || holdingRef.current) return;
    holdingRef.current = true;
    window.speechSynthesis?.cancel();
    try {
      const r = await startRecording();
      if (!holdingRef.current) {
        void r.stop().catch(() => {});
        showCaption("Hold the button while you talk.", "Voice note");
        return;
      }
      recorderRef.current = r;
      noteStartRef.current = Date.now();
      setVoice("recording");
    } catch (err) {
      holdingRef.current = false;
      showCaption(`Microphone blocked: ${short(err)}`, "Voice note");
    }
  }

  async function voiceUp() {
    holdingRef.current = false;
    const r = recorderRef.current;
    if (!r) return;
    recorderRef.current = null;
    const t = noteStartRef.current;
    const noteRoom = roomRef.current;
    setVoice("sending");
    let text = "";
    try {
      const wav = await r.stop();
      if (Date.now() - t < MIN_NOTE_MS) {
        showCaption("Hold the button while you talk.", "Voice note");
        return;
      }
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      const heard = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
      if (!res.ok || heard.error) throw new Error(heard.error ?? `HTTP ${res.status}`);
      text = (heard.transcript ?? "").trim();
      if (!/[a-z0-9]{2,}/i.test(text)) {
        showCaption("Didn't catch that. Hold the button and try again.", "Voice note");
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
      showCaption(`“${text}”`, `Note saved · ${noteRoom}`);
    } catch (err) {
      showCaption(text ? `Not saved: “${text}”. ${short(err)}` : `Note not saved: ${short(err)}`, "Voice note");
    } finally {
      setVoice("idle");
    }
  }

  // ---------- finish ----------

  function requestFinish() {
    const filmed = inspection?.rooms.filter((r) => r.frames.length > 0) ?? [];
    const thin = filmed.filter((r) => r.frames.length < MIN_ROOM_PHOTOS).map((r) => ({ name: r.name, photos: r.frames.length }));
    if (!filmed.length || thin.length) setConfirm({ thin, empty: !filmed.length });
    else void finishInspection();
  }

  async function finishInspection(force = false) {
    const run = ++finishRunRef.current;
    setPicker(null);
    setConfirm(null);
    setOtherOpen(false);
    const total = queueRef.current.length + inflightRef.current + backoffRef.current;
    setFinishing({ stage: "uploading", total });
    await waitForUploads();
    if (run !== finishRunRef.current) return;
    if (failedRef.current.length && !force) {
      const n = failedRef.current.length;
      setFinishing({ stage: "failed", message: `${plural(n, "photo")} didn't upload.`, total });
      return;
    }
    setFinishing({ stage: "saving", total });
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
      if (run === finishRunRef.current) setFinishing({ stage: "error", message: short(err), total });
    }
  }

  function closeFinishing() {
    if (finishing?.stage === "saving") return; // the finish call is already on its way (about a second)
    finishRunRef.current++;
    setFinishing(null);
  }

  // ---------- derived ----------

  const currentRoom = inspection?.rooms.find((r) => r.name === room);
  const roomFrames = currentRoom?.frames ?? [];
  const checking = roomFrames.filter((f) => f.status === "pending").length;
  const marks = uniqueMarks(roomFrames);
  const strip = marks.slice(0, STRIP_SIZE);
  const tally = [plural(roomFrames.length, "photo"), plural(marks.length, "mark"), checking ? `${checking} checking` : ""]
    .filter(Boolean)
    .join(" · ");

  const resumeRoom = room || inspection?.rooms.at(-1)?.name || "";
  const roomNames = [...ROOM_PICKS, ...(inspection?.rooms.map((r) => r.name).filter((n) => !ROOM_PICKS.includes(n)) ?? [])];
  if (room && !roomNames.includes(room)) roomNames.push(room);
  const roomOptions = roomNames.map((name) => {
    const photos = inspection?.rooms.find((r) => r.name === name)?.frames.length ?? 0;
    return { name, photos, done: doneRooms.includes(name) || (photos > 0 && name !== room) };
  });
  const hasPhotos = !!inspection?.rooms.some((r) => r.frames.length > 0);

  const tone: OutlineTone = kind === "move_out" ? "new" : "existing";
  const stageOutlines: StageOutline[] = [
    ...(flash
      ? flash.outlines.map((o, i) => ({ key: `${flash.id}-${i}`, width: o.width, height: o.height, outlines: o.outlines, tone }))
      : []),
    ...(askOpen && ask.outline ? [ask.outline] : []),
  ];

  const elapsed = rec.acc + (rec.since ? Math.max(0, now - rec.since) : 0);
  // The pill is an aria-live region: keep the ticking clock out of what screen readers announce.
  const pill: { tone: Tone; pulse?: boolean; text: ReactNode } = !online
    ? { tone: "existing", text: unsent ? `Offline · ${unsent} waiting` : "Offline" }
    : capturing
      ? { tone: "info", pulse: true, text: <>REC<span aria-hidden> {clock(elapsed)}</span></> }
      : loadError
        ? { tone: "existing", text: "Reconnecting…" }
        : uploads.active
          ? { tone: "info", text: `Uploading ${uploads.active}` }
          : mode === "idle"
            ? { tone: "neutral", text: "Ready" }
            : { tone: "neutral", text: "Paused" };

  const captionLine: Caption | null =
    voice === "recording"
      ? { text: "Listening… let go to save the note.", sub: "Voice note" }
      : capturing && hint
        ? { text: HINT_TEXT[hint] }
        : (caption ?? (mode === "idle" && !sheetOpen ? { text: "Tap Start, then pick the room you're in." } : null));

  const kindLabel = kind === "move_out" ? "Move-out" : "Move-in";
  const coachTips: CoachTip[] = [
    { title: "Walk slowly", body: "Point at each wall, the floor, the ceiling and the fittings. Photos are taken for you." },
    { title: "Get close to marks", body: "Hold steady for a second near cracks, stains, chips and anything broken." },
    kind === "move_out"
      ? { title: "We'll note them for you", body: "Marks get a red outline. At the end we compare them with your move-in record." }
      : { title: "We'll note them for you", body: "Marks get an amber outline and go into your record. Hold the mic to add a voice note." },
  ];

  // ---------- render ----------

  if (missing) {
    return (
      <DocScreen title="We couldn’t find this inspection." body="The link may be wrong, or the inspection was removed.">
        <ButtonLink href="/" className="mt-5">
          Back home
        </ButtonLink>
      </DocScreen>
    );
  }

  if (inspection?.finishedAt) {
    const photos = inspection.rooms.reduce((n, r) => n + r.frames.length, 0);
    return (
      <DocScreen
        ok
        title={kind === "move_out" ? "Move-out finished" : "Move-in saved"}
        body={`${inspection.property} · ${plural(inspection.rooms.length, "room")} · ${plural(photos, "photo")}`}
      >
        <div className="mt-5 flex flex-wrap gap-3">
          {kind === "move_out" && <ButtonLink href={`/r/${encodeURIComponent(id)}`}>View report</ButtonLink>}
          <ButtonLink href="/" variant={kind === "move_out" ? "secondary" : "primary"}>
            Back home
          </ButtonLink>
        </div>
      </DocScreen>
    );
  }

  if (isDesktop === null) return <main className="h-dvh w-full bg-black" />;
  if (isDesktop && !cameraAnyway) {
    return (
      <DesktopHandoff
        what={inspection ? `film ${inspection.property} (${kindLabel.toLowerCase()})` : "film the flat"}
        onUseAnyway={() => setCameraAnyway(true)}
      />
    );
  }

  const top = (
    <div className="flex items-center justify-between gap-2">
      <Chip onDark onClick={() => (mode === "idle" ? openStart() : setPicker("change"))} className="min-w-0 max-w-[45%]" aria-label={`Room: ${room || "none"}. Change room`}>
        <span className="truncate">{room || "Choose room"}</span>
        <ChevronDownIcon className="size-4 shrink-0 opacity-70" />
      </Chip>
      <StatusPill tone={pill.tone} pulse={pill.pulse}>
        {pill.text}
      </StatusPill>
      <IconButton onDark label="Close walkthrough" onClick={requestLeave}>
        <CloseIcon />
      </IconButton>
    </div>
  );

  const bottom = (
    <>
      {(mode !== "idle" || roomFrames.length > 0 || uploads.failed > 0) && (
        <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/90">
          <span className="drop-shadow">{tally}</span>
          {strip.length > 0 && (
            <ul className="flex -space-x-2" aria-label="Latest marks">
              {strip.map(({ frame, defect }) => (
                <li key={`${frame.id}-${defect.id}`}>
                  <DefectThumb frame={frame} defect={defect} tone={tone} />
                </li>
              ))}
            </ul>
          )}
          {uploads.failed > 0 && (
            <Chip tone="existing" onDark onClick={retryFailed}>
              {uploads.failed} not uploaded · Retry
            </Chip>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 items-end">
        <span className="flex flex-col items-center gap-1.5 justify-self-start">
          <IconButton onDark size={56} label="Ask about what you see" onClick={openAsk}>
            <SparkleIcon className="size-6" />
          </IconButton>
          <span className="text-xs font-medium text-white/85 drop-shadow">Ask</span>
        </span>
        <span className="justify-self-center">
          <RoundButton
            solid
            size={72}
            label={recording ? "Pause" : mode === "idle" ? "Start" : "Resume"}
            caption={recording ? "Pause" : mode === "idle" ? "Start" : "Resume"}
            aria-pressed={mode === "idle" ? undefined : !recording}
            onClick={togglePause}
          >
            {recording ? <PauseIcon className="size-8" /> : <PlayIcon className="size-8" />}
          </RoundButton>
        </span>
        <span className="justify-self-end">
          <RoundButton
            label="Voice note: hold to talk"
            caption={voice === "recording" ? "Listening…" : voice === "sending" ? "Saving…" : "Hold for note"}
            solid={voice === "recording"}
            disabled={voice === "sending" || !room}
            className={`touch-none ${voice === "recording" ? "scale-110" : ""}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              void voiceDown();
            }}
            onPointerUp={() => void voiceUp()}
            onPointerCancel={() => void voiceUp()}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                void voiceDown();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                void voiceUp();
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {voice === "sending" ? <Spinner className="size-5" /> : <MicIcon className="size-6" />}
          </RoundButton>
        </span>
      </div>
      {room && mode !== "idle" && (
        <Button variant="secondary" onDark className="max-w-full self-center" onClick={doneWithRoom}>
          <span className="truncate">Done with {room}</span>
        </Button>
      )}
    </>
  );

  const sheetTitle = confirm
    ? "Finish now?"
    : sheet === "start"
      ? "Which room are you in?"
      : sheet === "next"
        ? `${room} done. Where next?`
        : "Change room";

  const finishFooter =
    !confirm && (sheet !== "start" || hasPhotos) ? (
      <div className="flex flex-col gap-2">
        <Button variant="ok" onDark size="lg" block onClick={requestFinish}>
          Finish inspection
        </Button>
        {sheet === "next" && room && (
          <Button
            variant="ghost"
            onDark
            block
            onClick={() => {
              setDoneRooms((d) => d.filter((r) => r !== room));
              setPicker(null);
            }}
          >
            Keep filming {room}
          </Button>
        )}
      </div>
    ) : undefined;

  const uploadPct = finishing && finishing.total ? (finishing.total - Math.min(finishing.total, uploads.active)) / finishing.total : 1;

  return (
    <CameraStage
      ref={camRef}
      active={!!inspection}
      intro={{
        title: kind === "move_out" ? "Film your move-out" : "Film your move-in",
        body: "We use your phone's back camera to photograph each room as you walk. Nothing is saved until you pick a room and start.",
        action: "Turn on camera",
      }}
      onStatus={setCamStatus}
      onStartTap={() => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""))}
      outlines={stageOutlines}
      top={top}
      caption={captionLine && <CaptionBar key={captionLine.text} text={captionLine.text} sub={captionLine.sub} />}
      bottom={bottom}
    >
      {!inspection && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center" aria-live="polite">
          <Spinner className="size-6" />
          <p className="text-white/75">{loadError ? "Can’t reach the server. Retrying…" : "Loading…"}</p>
          {loadError && <p className="text-xs text-white/55">{loadError}</p>}
        </div>
      )}

      {showCoach && <CoachOverlay title={`${kindLabel} walkthrough`} tips={coachTips} onDone={markCoachSeen} />}

      {/* Room picker: start, change room, or after finishing a room */}
      {inspection && (
        <Sheet open={sheetOpen} onClose={closeSheet} onDark title={sheetTitle} footer={finishFooter}>
          {confirm ? (
            <div>
              <p className="text-base text-white/85">
                {confirm.empty
                  ? "You haven’t filmed anything yet. An empty record won’t protect your deposit."
                  : `Rooms with fewer than ${MIN_ROOM_PHOTOS} photos make weak evidence.`}
              </p>
              {confirm.thin.length > 0 && (
                <ul className="mt-3 space-y-1 text-base">
                  {confirm.thin.map((r) => (
                    <li key={r.name} className="flex justify-between gap-3 rounded-xl bg-white/10 px-4 py-3">
                      <span className="truncate">{r.name}</span>
                      <span className="shrink-0 text-white/70">{plural(r.photos, "photo")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex flex-col gap-2">
                {confirm.thin[0] ? (
                  <Button onDark size="lg" block onClick={() => chooseRoom(confirm.thin[0].name, "record")}>
                    <span className="truncate">Film more in {confirm.thin[0].name}</span>
                  </Button>
                ) : (
                  <Button onDark size="lg" block onClick={() => setConfirm(null)}>
                    Keep filming
                  </Button>
                )}
                <Button variant="secondary" onDark block onClick={() => void finishInspection()}>
                  Finish anyway
                </Button>
              </div>
            </div>
          ) : (
            <>
              {sheet === "start" && (
                <p className="text-sm text-white/75">
                  {kindLabel} · {inspection.property}. Walk slowly past the walls, floor, ceiling and fittings. Photos are taken for you.
                </p>
              )}
              {sheet === "start" && resumeRoom && (
                <Button onDark size="lg" block className="mt-4" onClick={() => chooseRoom(resumeRoom, "start")}>
                  <span className="truncate">Continue in {resumeRoom}</span>
                </Button>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {roomOptions.map((r) => {
                  const current = sheet === "change" && r.name === room;
                  return (
                    <Button
                      key={r.name}
                      variant={current ? "primary" : "secondary"}
                      onDark
                      className="min-w-0"
                      aria-current={current || undefined}
                      icon={r.done ? <CheckIcon className={`size-4 shrink-0 ${current ? "" : "text-cam-ok"}`} /> : undefined}
                      onClick={() => pickRoom(r.name)}
                    >
                      <span className="truncate">{r.name}</span>
                      {r.done && <span className="sr-only">(done)</span>}
                      {r.photos > 0 && <span className="shrink-0 text-sm opacity-60">{r.photos}</span>}
                    </Button>
                  );
                })}
              </div>
              {otherOpen ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    pickRoom(customRoom);
                  }}
                  className="mt-3 flex gap-2"
                >
                  <input
                    autoFocus
                    value={customRoom}
                    onChange={(e) => setCustomRoom(e.target.value)}
                    maxLength={40}
                    aria-label="Room name"
                    placeholder="e.g. Bedroom 2, Study"
                    className="min-h-12 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-base text-white outline-none placeholder:text-white/50 focus-visible:ring-2 focus-visible:ring-cam-info"
                  />
                  <Button type="submit" onDark disabled={!customRoom.trim()}>
                    Go
                  </Button>
                </form>
              ) : (
                <Button variant="ghost" onDark className="-ml-3 mt-2" icon={<PlusIcon />} onClick={() => setOtherOpen(true)}>
                  Other room
                </Button>
              )}
            </>
          )}
        </Sheet>
      )}

      {/* Finishing: waits for uploads, then saves */}
      <Sheet open={!!finishing} onClose={closeFinishing} onDark title="Finishing inspection">
        {finishing && (finishing.stage === "uploading" || finishing.stage === "saving") && (
          <div className="flex flex-col gap-3">
            <p className="text-base">
              {finishing.stage === "saving"
                ? kind === "move_out"
                  ? "Saving and starting the comparison…"
                  : "Saving your move-in record…"
                : !online
                  ? `You’re offline. ${plural(uploads.active, "photo")} will upload when you’re back online.`
                  : uploads.active
                    ? `Uploading ${plural(uploads.active, "photo")}…`
                    : "Finishing…"}
            </p>
            <Progress value={finishing.stage === "saving" ? 0.95 : uploadPct} busy={finishing.stage === "saving"} />
            <p className="text-sm text-white/65">
              {finishing.stage === "saving" ? "A few seconds." : online ? `About ${Math.max(2, Math.ceil(uploads.active / MAX_IN_FLIGHT) * 2)} s.` : "Keep this page open."}
            </p>
          </div>
        )}
        {finishing?.stage === "failed" && (
          <div className="flex flex-col gap-2">
            <p className="text-base font-semibold">{finishing.message}</p>
            <p className="text-sm text-white/70">Check your connection and try again, or finish without them.</p>
            <Button
              onDark
              block
              className="mt-3"
              onClick={() => {
                retryFailed();
                void finishInspection();
              }}
            >
              Retry upload
            </Button>
            <Button variant="secondary" onDark block onClick={() => void finishInspection(true)}>
              Finish without them
            </Button>
          </div>
        )}
        {finishing?.stage === "error" && (
          <div className="flex flex-col gap-2">
            <p className="text-base font-semibold">Couldn&rsquo;t finish the inspection.</p>
            <p className="break-words text-sm text-white/70">{finishing.message}</p>
            <Button onDark block className="mt-3" onClick={() => void finishInspection()}>
              Try again
            </Button>
          </div>
        )}
      </Sheet>

      {/* Leaving with uploads still pending */}
      <Sheet
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onDark
        title="Leave the walkthrough?"
        footer={
          <div className="flex flex-col gap-2">
            <Button onDark block onClick={() => setLeaveOpen(false)}>
              Keep filming
            </Button>
            <Button
              variant="ghost"
              onDark
              block
              onClick={() => {
                setLeaveOpen(false);
                router.push("/");
              }}
            >
              Leave anyway
            </Button>
          </div>
        }
      >
        <p className="text-base text-white/85">
          {plural(unsent, "photo")} {unsent === 1 ? "hasn’t" : "haven’t"} uploaded yet. If you leave now, they may not be saved.
        </p>
      </Sheet>

      <AskSheet open={askOpen} onClose={closeAsk} session={ask} />
    </CameraStage>
  );
}

/** Calm document screen for the non-camera states (not found, already finished). */
function DocScreen({ title, body, ok, children }: { title: string; body: string; ok?: boolean; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center">
      <Page>
        <Card className="sm:p-8">
          {ok && (
            <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-ok/10 text-ok" aria-hidden>
              <CheckIcon className="size-6" />
            </span>
          )}
          <h1 className="text-xl font-semibold leading-[26px]">{title}</h1>
          <p className="mt-1 text-base text-muted">{body}</p>
          {children}
        </Card>
      </Page>
    </div>
  );
}

function Progress({ value, busy }: { value: number; busy?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full overflow-hidden rounded-full bg-white/15">
      <div className={`h-full rounded-full bg-cam-info transition-[width] duration-200 ${busy ? "animate-pulse" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A tiny crop of the frame around the mark, with its outline; the whole frame if SAM couldn't place it. */
function DefectThumb({ frame, defect, tone }: { frame: Frame; defect: Defect; tone: OutlineTone }) {
  const o = defect.outline;
  const box = o ? cropBox(o) : null;
  const label = defect.description || defect.phrase;
  const cls = "size-9 shrink-0 rounded-lg bg-black ring-2 ring-black/70";
  if (!o || !box) {
    // eslint-disable-next-line @next/next/no-img-element -- stored photo URL, tiny thumbnail
    return <img src={frame.imageUrl} alt={label} title={label} className={`${cls} object-cover`} />;
  }
  return (
    <svg viewBox={box.join(" ")} preserveAspectRatio="xMidYMid slice" className={cls} role="img" aria-label={label}>
      <title>{label}</title>
      <image href={frame.imageUrl} x={0} y={0} width={o.width} height={o.height} preserveAspectRatio="none" />
      {o.outlines.map((p, i) => (
        <path key={`${p.id}-${i}`} d={p.path} transform={p.transform} className={outlineClass(tone)} strokeWidth={2} vectorEffect="non-scaling-stroke" />
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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}
