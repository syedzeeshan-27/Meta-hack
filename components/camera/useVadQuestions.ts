"use client";

// Always-on mic for Ask: voice activity detection turns speech into one WAV per question.
// start() must be called inside a tap (iOS only starts audio from a user gesture).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { startVad, type Vad } from "@/lib/vad";
import { useLatest } from "./hooks";
import { mediaError } from "./util";

/** live: listening. barge: we're talking, only loud speech breaks in. muted: not listening. */
export type MicMode = "live" | "barge" | "muted";

export function useVadQuestions(
  handlers: { onUtterance: (wav: Blob) => void; onBargeIn: () => void },
  mode: MicMode,
  /** Optional element with the `mic-level` class: it scales with the mic level. */
  levelRef?: RefObject<HTMLElement | null>,
) {
  const vadRef = useRef<Vad | null>(null);
  const genRef = useRef(0);
  const hearingRef = useRef(false);
  const h = useLatest(handlers);
  const level = useLatest(levelRef);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hearing, setHearingState] = useState(false);
  const [error, setError] = useState("");

  const setHearing = useCallback((v: boolean) => {
    hearingRef.current = v;
    setHearingState(v);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (vadRef.current) return true;
    const gen = ++genRef.current;
    setStarting(true);
    setError("");
    try {
      // startVad builds its AudioContext before awaiting, so it still counts as the caller's tap.
      const vad = await startVad({
        onSpeechStart: () => setHearing(true),
        onSpeechCancel: () => setHearing(false),
        onUtterance: (wav) => {
          setHearing(false);
          h.current.onUtterance(wav);
        },
        onLevel: (v) => level.current?.current?.style.setProperty("--level", v.toFixed(3)),
        onBargeIn: () => h.current.onBargeIn(),
      });
      if (gen !== genRef.current) {
        vad.stop();
        return false;
      }
      vadRef.current = vad;
      setRunning(true);
      return true;
    } catch (err) {
      if (gen === genRef.current) setError(mediaError(err, "microphone"));
      return false;
    } finally {
      if (gen === genRef.current) setStarting(false);
    }
  }, [h, level, setHearing]);

  const stop = useCallback(() => {
    genRef.current++;
    vadRef.current?.stop();
    vadRef.current = null;
    setRunning(false);
    setStarting(false);
    setHearing(false);
  }, [setHearing]);

  // Listen unless muted; while we talk, only a loud barge-in gets through.
  useEffect(() => {
    const vad = vadRef.current;
    if (!vad) return;
    if (mode === "muted") vad.pause(false);
    else if (mode === "barge") vad.pause(true);
    else vad.resume();
  }, [running, mode]);

  // Next hides this page on navigation (Activity) or it unmounts: release the mic.
  useLayoutEffect(() => stop, [stop]);

  return { start, stop, running, starting, hearing, error, isHearing: () => hearingRef.current };
}
