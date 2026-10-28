"use client";

// One question at a time: transcribe what was said, then stream Spark's answer from /api/live
// (text, outlines, sources, status), speaking it sentence by sentence as it arrives.
// Shared by the Ask sheet in the walkthrough and the full-screen /live view.

import { useRef, useState } from "react";
import type { Guide } from "@/lib/types";
import type { Frame, LiveEvent, LiveRequest } from "@/lib/live-types";
import type { StageOutline } from "./CameraStage";
import { splitSentences, type Speech } from "./useSpeech";
import { short } from "./util";

const HISTORY_TURNS = 4;
const SESSION_KEY = "fixcam.session";

export type AskSource = { title: string; url: string };
export type AskOutline = StageOutline & { phrase: string };
type Turn = { question: string; answer: string };

export function useAsk({ speech, onGuide }: { speech: Speech; onGuide?: (g: Guide) => void }) {
  const sessionRef = useRef("");
  const historyRef = useRef<Turn[]>([]);
  const guideRef = useRef<Guide | null>(null);
  const stepRef = useRef<number | undefined>(undefined);
  const ctrlRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0); // newest utterance
  const askedSeqRef = useRef(0); // utterance the current answer belongs to
  const reqRef = useRef(0);
  const voiceReqRef = useRef(0); // the answer still allowed to talk (0 = none)
  const busyRef = useRef({ transcribing: 0, asking: false });

  const [transcribing, setTranscribing] = useState(0);
  const [asking, setAsking] = useState(false);
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<AskSource[]>([]);
  const [outline, setOutline] = useState<AskOutline | null>(null);

  function setBusy(patch: Partial<typeof busyRef.current>) {
    busyRef.current = { ...busyRef.current, ...patch };
    setTranscribing(busyRef.current.transcribing);
    setAsking(busyRef.current.asking);
  }

  function session(): string {
    if (!sessionRef.current) sessionRef.current = sessionId();
    return sessionRef.current;
  }

  /** A finished utterance from the mic, with the camera frame from the moment they stopped talking. */
  async function onUtterance(wav: Blob, frame: Frame | null) {
    const seq = ++seqRef.current;
    setBusy({ transcribing: busyRef.current.transcribing + 1 });
    let question = "";
    try {
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      const data = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      question = (data.transcript ?? "").trim();
    } catch (err) {
      if (seq === seqRef.current) setError(`Didn't catch that: ${short(err)}`);
      return;
    } finally {
      setBusy({ transcribing: busyRef.current.transcribing - 1 });
    }
    // Noise, or a newer question already got its answer started.
    if (!/[a-z0-9]{2,}/i.test(question) || isFiller(question) || seq < askedSeqRef.current) return;
    if (!frame) {
      setHeard(question);
      setError("The camera isn't on, so I can't see what you mean.");
      return;
    }
    askedSeqRef.current = seq;
    void ask(question, frame);
  }

  async function ask(question: string, frame: Frame) {
    ctrlRef.current?.abort();
    speech.stop();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const reqId = ++reqRef.current;
    voiceReqRef.current = reqId;
    setHeard(question);
    setAnswer("");
    setStatus("");
    setError("");
    setSources([]);
    setOutline(null);
    setBusy({ asking: true });

    let full = "";
    let spoken = 0;
    const talk = (final: boolean) => {
      const { sentences, used } = splitSentences(full.slice(spoken), final);
      spoken += used;
      if (voiceReqRef.current === reqId) sentences.forEach(speech.speak);
    };

    const body: LiveRequest = {
      sessionId: session(),
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
          if (ev.outlines.length)
            setOutline({ key: `ask-${reqId}`, width: ev.width, height: ev.height, outlines: ev.outlines, tone: "info", phrase: ev.phrase });
        } else if (ev.type === "sources") setSources(ev.items);
        else if (ev.type === "status") setStatus(ev.message);
        else if (ev.type === "guide") {
          guideRef.current = ev.guide;
          stepRef.current = 0;
          if (onGuide) {
            voiceReqRef.current = 0; // the step view does its own talking
            onGuide(ev.guide);
          }
        } else if (ev.type === "step") stepRef.current = ev.stepIndex;
        else if (ev.type === "error") throw new Error(ev.message);
        else if (ev.type === "done") break;
      }
      talk(true);
      if (full.trim()) historyRef.current = [...historyRef.current, { question, answer: full.trim() }].slice(-HISTORY_TURNS);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(short(err));
      if (voiceReqRef.current === reqId) speech.speak("Sorry, something went wrong.");
    } finally {
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
        setStatus("");
        setBusy({ asking: false });
      }
    }
  }

  /** The person talked over the answer: stop the voice, let the text finish. */
  function silence() {
    voiceReqRef.current = 0;
    speech.stop();
  }

  /** Stop everything in flight (closing the sheet, leaving the page). */
  function cancel() {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    seqRef.current++;
    askedSeqRef.current = seqRef.current;
    silence();
    setStatus("");
    setBusy({ asking: false });
  }

  function clearOutline() {
    setOutline(null);
  }

  /** Remember the step guide (the step view reports progress back). */
  function setStep(i: number | undefined) {
    stepRef.current = i;
  }

  return {
    heard,
    answer,
    status,
    error,
    sources,
    outline,
    asking,
    thinking: asking || transcribing > 0,
    /** For timers: something is being transcribed or answered right now. */
    isBusy: () => busyRef.current.asking || busyRef.current.transcribing > 0,
    session,
    onUtterance,
    ask,
    silence,
    cancel,
    clearOutline,
    setStep,
    setError,
  };
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

/** Background noise often transcribes as a lone filler word; don't send those to Spark as questions. */
const FILLERS = new Set(["uh", "um", "hmm", "mm", "ah", "oh", "the", "a", "and", "so", "okay", "ok", "yeah", "hey"]);
function isFiller(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return words.length <= 2 && words.every((w) => FILLERS.has(w));
}
