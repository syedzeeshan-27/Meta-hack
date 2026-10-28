"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/icons";
import type { DefectOutline } from "@/lib/inspect/types";
import { ZoomInIcon, ZoomOutIcon } from "./icons";
import { OutlineOverlay, type OutlineTone } from "./Outline";

export type Photo = {
  src: string;
  width: number;
  height: number;
  alt: string;
  outline?: DefectOutline;
  tone: OutlineTone;
  /** Top line of the viewer, e.g. "After · Bedroom · move-out, 26 Oct 2026, 5:07 pm". */
  title: string;
  note?: string;
};

const MIN = 1;
const MAX = 6;
const STEP = 1.6;
type View = { s: number; x: number; y: number };
type Point = { x: number; y: number };
const RESET: View = { s: 1, x: 0, y: 0 };
const CENTRE: Point = { x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Full-screen photo with its outline. Pinch or scroll to zoom, drag to pan, double-tap to zoom in or reset,
 * Escape to close. The image and the outline share one transformed layer, so they stay aligned at any zoom.
 */
export function PhotoViewer({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>(RESET);
  const [smooth, setSmooth] = useState(false);
  const current = useRef<View>(RESET);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<(View & { d: number; m: Point }) | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ t: number; p: Point } | null>(null);

  /** Sets the view, keeping the photo from being panned off screen. */
  const apply = useCallback((next: View, animate = false) => {
    const w = stage.current?.clientWidth ?? 0;
    const h = stage.current?.clientHeight ?? 0;
    const s = clamp(next.s, MIN, MAX);
    const mx = ((s - 1) * w) / 2;
    const my = ((s - 1) * h) / 2;
    const v = { s, x: clamp(next.x, -mx, mx), y: clamp(next.y, -my, my) };
    current.current = v;
    setSmooth(animate);
    setView(v);
  }, []);

  /** Screen point -> offset from the centre of the stage. */
  const local = useCallback((clientX: number, clientY: number): Point => {
    const r = stage.current?.getBoundingClientRect();
    if (!r) return CENTRE;
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }, []);

  /** Zooms to scale s, keeping whatever is under point p where it is. */
  const zoomAt = useCallback(
    (s: number, p: Point, animate = false) => {
      const v = current.current;
      const ns = clamp(s, MIN, MAX);
      const k = ns / v.s;
      apply({ s: ns, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }, animate);
    },
    [apply],
  );

  // Lock page scroll and move focus into the viewer while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Keyboard: Escape closes, + / - / 0 zoom, Tab stays inside the viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        zoomAt(current.current.s * STEP, CENTRE, true);
      } else if (e.key === "-" || e.key === "_") {
        zoomAt(current.current.s / STEP, CENTRE, true);
      } else if (e.key === "0") {
        apply(RESET, true);
      } else if (e.key === "Tab") {
        const items = dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (!items?.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = dialog.current?.contains(document.activeElement);
        if (!inside || (e.shiftKey && document.activeElement === first)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomAt, apply]);

  // Wheel / trackpad zoom. Native listener because React's wheel handler is passive and can't preventDefault.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const speed = e.ctrlKey ? 0.01 : 0.002; // ctrl+wheel is a trackpad pinch
      zoomAt(current.current.s * Math.exp(-dy * speed), local(e.clientX, e.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, local]);

  /** Snapshot the view and finger positions whenever the number of fingers changes. */
  function beginGesture() {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) {
      gesture.current = null;
      return;
    }
    const two = pts.length >= 2;
    const m = two ? local((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2) : local(pts[0].x, pts[0].y);
    gesture.current = { ...current.current, d: two ? dist(pts[0], pts[1]) : 0, m };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = false;
    beginGesture();
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.d > 0) {
      // Pinch: scale by the change in finger distance, and keep the point between the fingers under them.
      const m = local((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      const s = clamp((g.s * dist(pts[0], pts[1])) / g.d, MIN, MAX);
      apply({ s, x: m.x - (s * (g.m.x - g.x)) / g.s, y: m.y - (s * (g.m.y - g.y)) / g.s });
      moved.current = true;
    } else {
      const p = local(pts[0].x, pts[0].y);
      const dx = p.x - g.m.x;
      const dy = p.y - g.m.y;
      if (Math.hypot(dx, dy) > 6) moved.current = true;
      if (g.s > 1) apply({ s: g.s, x: g.x + dx, y: g.y + dy });
    }
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (!cancelled && wasSingle && !moved.current) {
      // Double-tap (or double-click): zoom in on that spot, or back out if already zoomed.
      const p = local(e.clientX, e.clientY);
      const last = lastTap.current;
      if (last && e.timeStamp - last.t < 320 && dist(p, last.p) < 32) {
        lastTap.current = null;
        if (current.current.s > 1.05) apply(RESET, true);
        else zoomAt(2.5, p, true);
      } else {
        lastTap.current = { t: e.timeStamp, p };
      }
    }
    beginGesture();
  }

  const zoomed = view.s > 1.01;

  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={photo.title}
      className="anim-fade fixed inset-0 z-[70] flex flex-col bg-black text-white"
    >
      <div className="flex items-center gap-1 pt-[max(0.5rem,env(safe-area-inset-top))] pr-2 pb-2 pl-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{photo.title}</p>
          {photo.note && <p className="truncate text-xs text-white/70">{photo.note}</p>}
        </div>
        <IconButton label="Zoom out" onDark onClick={() => zoomAt(view.s / STEP, CENTRE, true)} disabled={!zoomed}>
          <ZoomOutIcon />
        </IconButton>
        <IconButton label="Zoom in" onDark onClick={() => zoomAt(view.s * STEP, CENTRE, true)} disabled={view.s >= MAX}>
          <ZoomInIcon />
        </IconButton>
        <IconButton ref={closeButton} label="Close" onDark onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      <div
        ref={stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, false)}
        onPointerCancel={(e) => onPointerEnd(e, true)}
        className={`relative flex-1 touch-none overflow-hidden select-none ${
          zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        }`}
      >
        <div
          className="absolute inset-0 origin-center will-change-transform"
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`,
            transition: smooth ? "transform 200ms ease-out" : "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- evidence photo shown as stored, never re-encoded */}
          <img
            src={photo.src}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {photo.outline && <OutlineOverlay outline={photo.outline} tone={photo.tone} />}
        </div>
      </div>

      <p className="px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-white/60">
        Pinch or scroll to zoom · double-tap to {zoomed ? "reset" : "zoom in"} · Esc to close
      </p>
    </div>,
    document.body,
  );
}
