"use client";

// Ask, wired up: mic (VAD) → transcribe → streamed answer → speech, with the camera frame from a
// CameraStage the caller already has open. Used by the walkthrough's Ask sheet and by /live.

import { useState, type RefObject } from "react";
import type { Guide } from "@/lib/types";
import type { Frame } from "@/lib/live-types";
import { useAsk } from "./useAsk";
import { useSpeech } from "./useSpeech";
import { useVadQuestions } from "./useVadQuestions";

export type AskPhase = "listening" | "hearing" | "thinking" | "speaking";

export const PHASE_LABEL: Record<AskPhase, string> = {
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
};

export function useAskSession({
  capture,
  onGuide,
  paused = false,
  levelRef,
}: {
  /** The camera frame to ask about (called when the person stops talking). */
  capture: () => Frame | null;
  onGuide?: (g: Guide) => void;
  /** Stop listening without stopping the session (e.g. while a step view has the screen). */
  paused?: boolean;
  /** Element with the `mic-level` class to scale with the mic level. */
  levelRef?: RefObject<HTMLElement | null>;
}) {
  const speech = useSpeech();
  const ask = useAsk({ speech, onGuide });
  const [muted, setMuted] = useState(false);
  const mic = useVadQuestions(
    {
      onUtterance: (wav) => void ask.onUtterance(wav, capture()),
      onBargeIn: () => ask.silence(),
    },
    muted || paused ? "muted" : speech.speaking ? "barge" : "live",
    levelRef,
  );

  const phase: AskPhase = mic.hearing ? "hearing" : speech.speaking ? "speaking" : ask.thinking ? "thinking" : "listening";

  /** Call inside a tap: unlocks speech on iOS and starts the mic. */
  function start(greeting?: string): Promise<boolean> {
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
    const started = mic.start();
    void started.then((ok) => {
      if (ok && greeting) speech.speak(greeting);
    });
    return started;
  }

  function stop() {
    mic.stop();
    ask.cancel();
    speech.stop();
  }

  return {
    ...ask,
    start,
    stop,
    running: mic.running,
    starting: mic.starting,
    micError: mic.error,
    muted,
    setMuted,
    phase,
    speaking: speech.speaking,
    speak: speech.speak,
    stopSpeaking: () => ask.silence(),
    /** Nobody talking, nothing in flight: a good moment for an unprompted remark. */
    isQuiet: () => !mic.isHearing() && !ask.isBusy() && !speech.busy(),
  };
}

export type AskSession = ReturnType<typeof useAskSession>;
