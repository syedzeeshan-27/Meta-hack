"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Speech out: a queue of sentences on speechSynthesis, with a watchdog for browsers that never fire onend (iOS). */
export function useSpeech() {
  const ttsRef = useRef({ gen: 0, count: 0, misses: 0, live: new Set<SpeechSynthesisUtterance>() });
  const [speaking, setSpeaking] = useState(false);

  const speak = useCallback((text: string) => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const clean = forSpeech(text);
    if (!synth || !clean) return;
    const tts = ttsRef.current;
    const gen = tts.gen;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.05;
    const done = () => {
      tts.live.delete(u);
      if (gen !== tts.gen) return;
      tts.count = Math.max(0, tts.count - 1);
      if (!tts.count) setSpeaking(false);
    };
    u.onend = done;
    u.onerror = done;
    // Keep a reference: Chrome drops `onend` for utterances that get garbage-collected.
    tts.live.add(u);
    tts.count++;
    setSpeaking(true);
    synth.speak(u);
  }, []);

  const stop = useCallback(() => {
    const tts = ttsRef.current;
    tts.gen++;
    tts.count = 0;
    tts.live.clear();
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  /** True while anything is queued (readable from timers, unlike `speaking`). */
  const busy = useCallback(() => ttsRef.current.count > 0, []);

  useEffect(() => {
    if (!speaking) return;
    const id = setInterval(() => {
      const tts = ttsRef.current;
      const synth = window.speechSynthesis;
      if (tts.count && synth && !synth.speaking && !synth.pending) {
        if (++tts.misses >= 2) {
          tts.misses = 0;
          tts.gen++;
          tts.count = 0;
          setSpeaking(false);
        }
      } else tts.misses = 0;
    }, 1000);
    return () => clearInterval(id);
  }, [speaking]);

  // Hidden (navigated away) or unmounted: stop talking.
  useEffect(() => stop, [stop]);

  return { speaking, speak, stop, busy };
}

export type Speech = ReturnType<typeof useSpeech>;

/** Strip markdown and links so the voice doesn't read out asterisks and URLs. */
export function forSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")
    .replace(/[*_#`>]/g, "")
    .trim();
}

/** Complete sentences at the start of `text` (end punctuation + space, or a line break). */
export function splitSentences(text: string, final: boolean): { sentences: string[]; used: number } {
  const sentences: string[] = [];
  const re = /[.!?]+["')\]]*\s+|\n+/g;
  let used = 0;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const s = text.slice(used, end).trim();
    // "1." alone is a list number, not a sentence: keep it with what follows.
    if (!/[a-z]/i.test(s)) continue;
    sentences.push(s);
    used = end;
  }
  if (final && /[a-z0-9]/i.test(text.slice(used))) {
    sentences.push(text.slice(used).trim());
    used = text.length;
  }
  return { sentences, used };
}
