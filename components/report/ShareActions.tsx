"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { PrintIcon, ShareIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { ChatIcon } from "./icons";

const CLOSED_DETAILS = "[data-report] details:not([open])";
const IMAGES = "[data-report] img";

// The page URL, read once on the client (empty during server render).
const noSubscribe = () => () => {};
const clientHref = () => window.location.href;
const serverHref = () => "";

/** Loads every photo (they're lazy on screen) and waits up to 8 s, so the PDF has no blank boxes. */
async function loadAllImages() {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(IMAGES));
  imgs.forEach((img) => (img.loading = "eager"));
  const loaded = Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))]);
}

function useReportActions(title: string, text: string) {
  const toast = useToast();
  const href = useSyncExternalStore(noSubscribe, clientHref, serverHref);
  const [preparing, setPreparing] = useState(false);

  /** Phones get the native share sheet; desktops copy the link (a share dialog there is more confusing than useful). */
  async function share() {
    const url = window.location.href;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", "ok");
    } catch {
      toast("Couldn't copy the link. Copy it from the address bar instead.");
    }
  }

  async function savePdf() {
    setPreparing(true);
    try {
      await loadAllImages();
    } finally {
      setPreparing(false);
    }
    window.print();
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(href ? `${text}\n${href}` : text)}`;
  return { share, savePdf, preparing, whatsapp };
}

/**
 * Share link · WhatsApp · Save PDF, inside the verdict card. Also prepares the page for printing
 * (Ctrl+P too): collapsed sections are opened for the printout and closed again afterwards.
 */
export function ReportActions({ title, text }: { title: string; text: string }) {
  const { share, savePdf, preparing, whatsapp } = useReportActions(title, text);

  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = Array.from(document.querySelectorAll<HTMLDetailsElement>(CLOSED_DETAILS));
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

  return (
    <div id="report-actions" className="flex flex-wrap gap-2 sm:gap-3">
      <Button onClick={share} icon={<ShareIcon />} className="w-full sm:w-auto">
        Share link
      </Button>
      <a
        href={whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass({ variant: "secondary", className: "flex-1 sm:flex-none" })}
      >
        <ChatIcon />
        WhatsApp
      </a>
      <Button
        variant="secondary"
        onClick={savePdf}
        loading={preparing}
        icon={<PrintIcon />}
        className="flex-1 sm:flex-none"
      >
        Save PDF
      </Button>
    </div>
  );
}

/** Phones only: a bottom bar with Share once the verdict's buttons have scrolled away. */
export function StickyShare({ title, text }: { title: string; text: string }) {
  const { share, savePdf, preparing } = useReportActions(title, text);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const target = document.getElementById("report-actions");
    if (!target) return;
    const io = new IntersectionObserver(([entry]) =>
      setShow(!entry.isIntersecting && entry.boundingClientRect.top < 0),
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  return (
    <div
      inert={!show}
      aria-hidden={!show}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur transition-[transform,opacity] duration-200 sm:hidden print:hidden ${
        show ? "" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="flex gap-2">
        <Button onClick={share} icon={<ShareIcon />} className="flex-1">
          Share report
        </Button>
        <Button variant="secondary" onClick={savePdf} loading={preparing} icon={<PrintIcon />} aria-label="Save PDF" />
      </div>
    </div>
  );
}
