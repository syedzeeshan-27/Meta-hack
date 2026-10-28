"use client";

import { useEffect } from "react";

const DETAILS = "[data-report] details:not([open])";
const IMAGES = "[data-report] img";

/** Loads every photo (they're lazy on screen) and waits up to 8 s, so the PDF has no blank boxes. */
async function loadAllImages() {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(IMAGES));
  imgs.forEach((img) => (img.loading = "eager"));
  const loaded = Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))]);
}

/**
 * "Print / Save PDF". Also handles Ctrl+P: collapsed sections (already-there marks, wear, full
 * fingerprints) are opened for printing and closed again afterwards.
 */
export function PrintButton() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = Array.from(document.querySelectorAll<HTMLDetailsElement>(DETAILS));
      opened.forEach((d) => (d.open = true));
      document.querySelectorAll<HTMLImageElement>(IMAGES).forEach((img) => (img.loading = "eager"));
    };
    const after = () => {
      opened.forEach((d) => (d.open = false));
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  async function print() {
    await loadAllImages();
    window.print();
  }

  return (
    <button
      type="button"
      onClick={print}
      className="inline-flex items-center gap-2 rounded-full border border-(--line) bg-(--card) px-4 py-2 text-sm font-medium transition-colors hover:border-(--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ink) print:hidden"
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth={1.6}>
        <path d="M5 7V3h10v4M5 14H3V8a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v6h-2M6 11h8v6H6z" strokeLinejoin="round" />
      </svg>
      Print / Save PDF
    </button>
  );
}
