"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";

export type CoachTip = { title: string; body: string };

/** First-run tips over the camera: one screen, one button. The caller remembers that it was seen. */
export function CoachOverlay({ title, tips, onDone }: { title: string; tips: CoachTip[]; onDone: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-title"
      className="anim-fade absolute inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/80 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] backdrop-blur-sm sm:items-center"
    >
      <div className="w-full max-w-sm">
        <h2 id="coach-title" className="text-[28px] font-semibold leading-[34px]">
          {title}
        </h2>
        <ol className="mt-6 space-y-5">
          {tips.map((t, i) => (
            <li key={t.title} className="flex gap-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-semibold" aria-hidden>
                {i + 1}
              </span>
              <div>
                <p className="text-lg font-semibold leading-snug">{t.title}</p>
                <p className="mt-0.5 text-base text-white/75">{t.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Button ref={button} onDark size="lg" block className="mt-8" onClick={onDone}>
          Got it
        </Button>
      </div>
    </section>
  );
}
