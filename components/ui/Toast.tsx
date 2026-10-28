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

  const toneClass: Record<Tone, string> = {
    neutral: "bg-neutral-900 text-white",
    info: "bg-neutral-900 text-white",
    existing: "bg-amber-950 text-amber-100",
    new: "bg-red-950 text-red-100",
    ok: "bg-green-950 text-green-100",
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-[60] flex justify-center px-4"
      >
        {toast && (
          <div
            key={toast.id}
            className={`anim-sheet max-w-md rounded-full px-5 py-3 text-sm font-medium shadow-lg ${toneClass[toast.tone]}`}
          >
            {toast.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
