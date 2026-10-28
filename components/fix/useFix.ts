"use client";

// The fix session: always-on mic (VAD) -> transcribe (with hints from the repair so far) -> /api/fix,
// streamed and spoken sentence by sentence. Also runs what the turns ask for: the sound test, the parts
// and price research after a verdict, the safety watcher during a repair, and saving the repair card.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { StageOutline } from "@/components/camera/CameraStage";
import { useLatest } from "@/components/camera/hooks";
import { short } from "@/components/camera/util";
import { splitSentences, useSpeech } from "@/components/camera/useSpeech";
import { useVadQuestions } from "@/components/camera/useVadQuestions";
import { listenToDevice, ListenNeedsTap } from "@/lib/listen";
import { firstOpenGate } from "@/lib/repair/safety";
import type { FixEvent, FixRequest, HazardResponse, RepairState, Research, SaveRepairRequest, Source } from "@/lib/repair/types";
import type { Frame } from "@/lib/types";
import { rememberRepair } from "./history";
import { applyEvent, newRepair, NO_REPAIR, speechHints, withResearch } from "./state";

const HISTORY_TURNS = 4;
/** A second utterance this soon after the first, before any answer was spoken, is the rest of the same sentence. */
const MERGE_MS = 6000;
const ASK_SIDE = 1024;
const WATCH_SIDE = 640;
const WATCH_EVERY_MS = 4000;

export type FixPhase = "listening" | "hearing" | "thinking" | "speaking" | "measuring";
export type FixOutline = StageOutline & { phrase: string };
export type Hazard = NonNullable<HazardResponse["hazard"]>;
export type ListenState = { ask: string; seconds: number; bands: number[]; needsTap: boolean };
export type CardState = { saving: boolean; id?: string; error?: string };

type Turn = { question: string; answer: string };

export function useFix({
  capture,
  city,
  levelRef,
}: {
  capture: (maxSide: number, quality: number) => Frame | null;
  city: string;
  levelRef?: RefObject<HTMLElement | null>;
}) {
  const speech = useSpeech();
  const [repair, setRepair] = useState<RepairState>(NO_REPAIR);
  const repairRef = useRef(repair);
  const historyRef = useRef<Turn[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const askedSeqRef = useRef(0);
  const reqRef = useRef(0);
  const voiceReqRef = useRef(0);
  const lastAskRef = useRef<{ question: string; at: number; spoke: boolean } | null>(null);
  const pendingListenRef = useRef<{ ask: string; seconds: number } | null>(null);
  const researchKeyRef = useRef("");
  const beforeRef = useRef<Frame | null>(null);
  const hazardRef = useRef<Hazard | null>(null);

  const [muted, setMuted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [transcribing, setTranscribing] = useState(0);
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [outline, setOutline] = useState<FixOutline | null>(null);
  const [listen, setListen] = useState<ListenState | null>(null);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState("");
  const [hazard, setHazardState] = useState<Hazard | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [watcherModel, setWatcherModel] = useState("");
  const [watcherOff, setWatcherOff] = useState(false);
  const [card, setCard] = useState<CardState>({ saving: false });
  const cityRef = useLatest(city);

  function update(fn: (st: RepairState) => RepairState) {
    repairRef.current = fn(repairRef.current);
    setRepair(repairRef.current);
  }

  function setHazard(h: Hazard | null) {
    hazardRef.current = h;
    setHazardState(h);
  }

  const mic = useVadQuestions(
    {
      onUtterance: (wav) => void onUtterance(wav),
      onBargeIn: () => silence(),
    },
    muted || listen ? "muted" : speech.speaking ? "barge" : "live",
    levelRef,
  );

  const phase: FixPhase = listen
    ? "measuring"
    : mic.hearing
      ? "hearing"
      : speech.speaking
        ? "speaking"
        : asking || transcribing > 0
          ? "thinking"
          : "listening";

  // ---------- turns ----------

  async function onUtterance(wav: Blob) {
    const seq = ++seqRef.current;
    setTranscribing((n) => n + 1);
    let text = "";
    try {
      const hints = speechHints(repairRef.current);
      const url = `/api/transcribe${hints.length ? `?k=${encodeURIComponent(hints.join(","))}` : ""}`;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      const data = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      text = (data.transcript ?? "").trim();
    } catch (err) {
      if (seq === seqRef.current) setError(`Didn't catch that: ${short(err)}`);
      return;
    } finally {
      setTranscribing((n) => n - 1);
    }
    if (!/[a-z0-9]{2,}/i.test(text) || isFiller(text) || seq < askedSeqRef.current) return;
    // They paused mid-sentence and the mic cut it in two: ask the whole thing, not just the end.
    const last = lastAskRef.current;
    const question = last && !last.spoke && now() - last.at < MERGE_MS ? `${last.question} ${text}` : text;
    askedSeqRef.current = seq;
    void ask(question);
  }

  async function ask(question: string, opts: { display?: string } = {}) {
    const frame = capture(ASK_SIDE, 0.8);
    if (!frame) {
      setHeard(opts.display ?? question);
      setError("The camera isn't on, so I can't see it.");
      return;
    }
    beforeRef.current ??= frame;
    ctrlRef.current?.abort();
    speech.stop();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const reqId = ++reqRef.current;
    voiceReqRef.current = reqId;
    const turn = { question, at: now(), spoke: false };
    lastAskRef.current = turn;
    setHeard(opts.display ?? question);
    setAnswer("");
    setStatus("");
    setError("");
    setSources([]);
    setAsking(true);

    let full = "";
    let spoken = 0;
    let finished = false;
    const talk = (final: boolean) => {
      const { sentences, used } = splitSentences(full.slice(spoken), final);
      spoken += used;
      if (voiceReqRef.current !== reqId || !sentences.length) return;
      turn.spoke = true;
      sentences.forEach(speech.speak);
    };

    const body: FixRequest = { question, frame, repair: repairRef.current, history: historyRef.current.slice(-HISTORY_TURNS) };
    try {
      const res = await fetch("/api/fix", {
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
        } else if (ev.type === "status") setStatus(ev.message);
        else if (ev.type === "sources") setSources(ev.items);
        else if (ev.type === "outline") {
          if (ev.outlines.length)
            setOutline({ key: `fix-${reqId}-${ev.phrase}`, width: ev.width, height: ev.height, outlines: ev.outlines, tone: ev.tone, phrase: ev.phrase });
        } else if (ev.type === "listen") pendingListenRef.current = { ask: ev.ask, seconds: ev.seconds };
        else if (ev.type === "error") throw new Error(ev.message);
        else if (ev.type === "done") break;
        else {
          update((st) => applyEvent(st, ev));
          if (ev.type === "verdict") void runResearch();
          if (ev.type === "step" || ev.type === "guide") setOutline(null);
          if (ev.type === "finish") finished = true;
        }
      }
      talk(true);
      if (full.trim()) historyRef.current = [...historyRef.current, { question, answer: full.trim() }].slice(-HISTORY_TURNS);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(short(err));
      if (voiceReqRef.current === reqId) speech.speak("Sorry, something went wrong. Say that again?");
    } finally {
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
        setStatus("");
        setAsking(false);
      }
    }
    if (finished) void saveCard();
    if (pendingListenRef.current) void runListen();
  }

  /** The person talked over the answer: stop the voice, let the text finish. */
  function silence() {
    voiceReqRef.current = 0;
    speech.stop();
  }

  // ---------- sound test ----------

  async function runListen(fromTap = false) {
    const p = pendingListenRef.current ?? (listen && { ask: listen.ask, seconds: listen.seconds });
    pendingListenRef.current = null;
    if (!p) return;
    setListen({ ...p, bands: [], needsTap: false });
    // Let the instruction finish first, or we'd record our own voice.
    if (!fromTap) await waitUntil(() => !speech.busy(), 15000);
    try {
      const result = await listenToDevice(p.seconds, (bands) => setListen((l) => l && { ...l, bands }));
      setListen(null);
      void ask(result.summary, { display: "Sound test done. Here's what I measured." });
    } catch (err) {
      if (err instanceof ListenNeedsTap) setListen({ ...p, bands: [], needsTap: true });
      else {
        setListen(null);
        setError(`Sound test didn't work: ${short(err)}`);
      }
    }
  }

  function cancelListen() {
    pendingListenRef.current = null;
    setListen(null);
  }

  // ---------- research (after a verdict) ----------

  async function runResearch() {
    const st = repairRef.current;
    if (!st.verdict || !st.object) return;
    const key = `${st.object.name}|${st.verdict.cause}|${st.verdict.path}`;
    if (researchKeyRef.current === key) return;
    researchKeyRef.current = key;
    setResearching(true);
    setResearchError("");
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: st.object, complaint: st.complaint, cause: st.verdict.cause, path: st.verdict.path, city: st.city }),
      });
      const data = (await res.json().catch(() => ({}))) as Research & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      update((s) => withResearch(s, data));
    } catch (err) {
      researchKeyRef.current = "";
      setResearchError(short(err));
    } finally {
      setResearching(false);
    }
  }

  // ---------- safety watcher (during a repair with hazards) ----------

  const hazardsKey = repair.verdict?.hazards.join(",") ?? "";
  const watching = mic.running && !watcherOff && !!hazardsKey && (repair.stage === "verdict" || repair.stage === "fixing");
  const captureRef = useLatest(capture);

  async function checkHazard(frame: Frame): Promise<HazardResponse> {
    const st = repairRef.current;
    const res = await fetch("/api/hazard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frame,
        object: st.object?.name,
        step: st.guide?.steps[st.stepIndex]?.instruction,
        hazards: st.verdict?.hazards ?? [],
        gatesPassed: st.gatesPassed,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as HazardResponse & { error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }
  const checkHazardRef = useLatest(checkHazard);
  const raiseRef = useLatest((h: Hazard) => {
    setHazard(h);
    ctrlRef.current?.abort();
    silence();
    speech.speak(`Stop. ${h.say}`);
    if (h.outline)
      setOutline({ key: `hazard-${Date.now()}`, ...h.outline, tone: "new", phrase: h.phrase ?? "hazard" });
  });

  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const frame = document.visibilityState === "visible" && !hazardRef.current ? captureRef.current(WATCH_SIDE, 0.6) : null;
      if (frame) {
        try {
          const data = await checkHazardRef.current(frame);
          fails = 0;
          if (stopped) return;
          setWatcherModel(data.model);
          if (data.hazard && !hazardRef.current) raiseRef.current(data.hazard);
        } catch {
          // Not configured or down: the camera checks at each gate still apply.
          if (++fails >= 3) {
            setWatcherOff(true);
            return;
          }
        }
      }
      if (!stopped) timer = setTimeout(tick, WATCH_EVERY_MS);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watching, captureRef, checkHazardRef, raiseRef]);

  /** "It's safe now": look again before letting them carry on. */
  async function recheckHazard() {
    const frame = capture(ASK_SIDE, 0.8);
    if (!frame) return;
    setRechecking(true);
    try {
      const data = await checkHazard(frame);
      if (data.hazard) {
        setHazard(data.hazard);
        speech.speak(`Not yet. ${data.hazard.say}`);
      } else {
        setHazard(null);
        setOutline(null);
        speech.speak("Thanks, that looks safe. Carry on.");
      }
    } catch {
      // The watcher is down: trust them, but say it.
      setHazard(null);
      setOutline(null);
      speech.speak("Okay. Please double-check it yourself before carrying on.");
    } finally {
      setRechecking(false);
    }
  }

  // ---------- steps (buttons) ----------

  function goToStep(i: number) {
    const guide = repairRef.current.guide;
    if (!guide) return;
    let target = Math.max(0, Math.min(guide.steps.length - 1, i));
    const open = firstOpenGate(guide.steps, repairRef.current.gatesPassed);
    const blocked = open >= 0 && target > open;
    if (blocked) target = open;
    update((st) => ({ ...st, stepIndex: target }));
    setOutline(null);
    silence();
    speech.speak(blocked ? `Safety check first. ${guide.steps[target].instruction}` : guide.steps[target].instruction);
  }

  async function showStepPart() {
    const st = repairRef.current;
    const step = st.guide?.steps[st.stepIndex];
    const frame = capture(ASK_SIDE, 0.8);
    if (!step || !frame) return;
    setStatus(`Finding the ${step.part}…`);
    try {
      const res = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frame.image, width: frame.width, height: frame.height, phrase: step.part }),
      });
      const data = (await res.json()) as { width: number; height: number; outlines: FixOutline["outlines"]; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.outlines.length) setOutline({ key: `part-${Date.now()}`, width: data.width, height: data.height, outlines: data.outlines, tone: "info", phrase: step.part });
      else speech.speak(`I can't spot the ${step.part} right now. Try moving a little closer.`);
    } catch (err) {
      setError(short(err));
    } finally {
      setStatus("");
    }
  }

  // ---------- the repair card ----------

  async function saveCard() {
    if (card.saving || card.id) return;
    setCard({ saving: true });
    try {
      const after = capture(ASK_SIDE, 0.8);
      const body: SaveRepairRequest = {
        repair: repairRef.current,
        ...(beforeRef.current && { before: beforeRef.current }),
        ...(after && { after }),
      };
      const res = await fetch("/api/repairs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`);
      const st = repairRef.current;
      rememberRepair({
        id: data.id,
        title: [st.object?.brand, st.object?.name].filter(Boolean).join(" ") || "Repair",
        fixed: !!st.outcome?.fixed,
        at: Date.now(),
      });
      setCard({ saving: false, id: data.id });
    } catch (err) {
      setCard({ saving: false, error: short(err) });
    }
  }

  // ---------- session ----------

  /** Call inside a tap: unlocks speech on iOS and starts the mic. */
  function start(greeting: string): Promise<boolean> {
    update(() => newRepair(cityRef.current.trim()));
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
    const started = mic.start();
    void started.then((ok) => {
      if (ok) speech.speak(greeting);
    });
    return started;
  }

  function stop() {
    mic.stop();
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    seqRef.current++;
    askedSeqRef.current = seqRef.current;
    silence();
  }

  const stopRef = useLatest(stop);
  // Hidden by navigation or unmounted: stop the answer stream too (mic and speech stop in their own hooks).
  useLayoutEffect(() => () => stopRef.current(), [stopRef]);

  return {
    repair,
    phase,
    heard,
    answer,
    status,
    error,
    sources,
    outline,
    clearOutline: () => setOutline(null),
    thinking: asking || transcribing > 0,
    listen,
    runListenNow: () => void runListen(true),
    cancelListen,
    researching,
    researchError,
    retryResearch: () => void runResearch(),
    hazard,
    rechecking,
    recheckHazard: () => void recheckHazard(),
    watcherModel,
    watching,
    card,
    saveCard: () => void saveCard(),
    ask: (q: string) => void ask(q),
    goToStep,
    showStepPart: () => void showStepPart(),
    start,
    stop,
    running: mic.running,
    starting: mic.starting,
    micError: mic.error,
    muted,
    setMuted,
    speaking: speech.speaking,
    speak: speech.speak,
    stopSpeaking: silence,
  };
}

export type FixSession = ReturnType<typeof useFix>;

// ---------- helpers ----------

/** Only ever called from event handlers and async turns, never while rendering. */
const now = () => Date.now();

async function waitUntil(ok: () => boolean, maxMs: number) {
  const end = Date.now() + maxMs;
  // A short grace so the first queued sentence has started.
  await new Promise((r) => setTimeout(r, 300));
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 150));
}

/** SSE over a POST body: `data: <json>` blocks separated by a blank line. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<FixEvent> {
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

function parseEvent(block: string): FixEvent | null {
  const data = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as FixEvent;
  } catch {
    return null;
  }
}

/** Background noise often transcribes as a lone filler word; don't send those as questions. */
const FILLERS = new Set(["uh", "um", "hmm", "mm", "ah", "oh", "the", "a", "and", "so", "okay", "ok", "yeah", "hey"]);
function isFiller(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return words.length <= 2 && words.every((w) => FILLERS.has(w));
}
