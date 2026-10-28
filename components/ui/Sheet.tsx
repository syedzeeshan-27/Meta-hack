"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import { CloseIcon } from "./icons";

/**
 * Bottom sheet on phones, centred dialog from 640px up.
 * `onDark` gives it the dark camera surface (for sheets opened over the camera).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  onDark,
  size = "md",
  scrim = "dim",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onDark?: boolean;
  size?: "md" | "half";
  /** "clear" keeps what's behind visible (e.g. the camera and its outlines under Ask). */
  scrim?: "dim" | "clear";
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const surface = onDark ? "bg-neutral-900/95 text-white backdrop-blur" : "bg-surface text-ink";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className={`anim-fade absolute inset-0 ${scrim === "clear" ? "bg-transparent" : "bg-black/50"}`} onClick={onClose} aria-hidden />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`anim-sheet relative flex w-full flex-col rounded-t-2xl outline-none sm:max-w-lg sm:rounded-2xl ${surface} ${
          size === "half" ? "max-h-[55dvh]" : "max-h-[88dvh]"
        } pb-[env(safe-area-inset-bottom)]`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-current opacity-20 sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label="Close" onDark={onDark} size={48} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 pb-5 pt-2">{children}</div>
        {footer && <div className={`border-t px-5 py-4 ${onDark ? "border-white/10" : "border-line"}`}>{footer}</div>}
      </div>
    </div>
  );
}
