"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { Tone } from "./Chip";

type Toast = { id: number; text: string; tone: Tone };
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

/** One toast at a time, bottom-centre, above the safe area. Use `useToast()` anywhere. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((text: string, tone: Tone = "neutral") => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), text, tone });
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const dot: Record<Tone, string> = {
    neutral: "bg-white/60",
    info: "bg-cam-info",
    existing: "bg-cam-existing",
    new: "bg-cam-new",
    ok: "bg-cam-ok",
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4"
      >
        {toast && (
          <div
            key={toast.id}
            className="anim-sheet flex max-w-md items-center gap-2.5 rounded-full bg-neutral-900 px-5 py-3 text-sm font-medium text-white shadow-lg"
          >
            <span className={`size-2 shrink-0 rounded-full ${dot[toast.tone]}`} aria-hidden />
            {toast.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
