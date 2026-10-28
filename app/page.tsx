"use client";

import { useEffect, useState } from "react";
import CameraView from "@/components/CameraView";
import type { Guide } from "@/lib/types";

const DEFAULT_PRODUCT = "Wakefit Gravita High Back Office Chair";
const STORAGE_KEY = "fixcam.guide";
const MAX_PAGE_SIDE = 1600;

const BASIS_LABEL: Record<Guide["basis"], string> = {
  manual: "From your photos and notes",
  web: "Found on the web",
  typical: "Typical steps. Add manual photos for exact ones",
};

export default function Home() {
  const [product, setProduct] = useState(DEFAULT_PRODUCT);
  const [pages, setPages] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [guide, setGuide] = useState<Guide | null>(null);
  const [mode, setMode] = useState<"setup" | "camera">("setup");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");

  // Bring back the last guide so a page refresh mid-build doesn't lose it.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
      if (saved) setGuide(JSON.parse(saved) as Guide);
    } catch {}
  }, []);

  async function addPages(files: FileList | null) {
    if (!files) return;
    const shrunk = await Promise.all([...files].map(shrinkImage));
    setPages((p) => [...p, ...shrunk]);
  }

  async function makeGuide() {
    setPlanning(true);
    setError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, manualImages: pages, userNotes: notes }),
      });
      const data = (await res.json()) as Guide & { error?: string };
      if (data.error) throw new Error(data.error);
      setGuide(data);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {}
    } catch (err) {
      setError(String(err));
    } finally {
      setPlanning(false);
    }
  }

  if (mode === "camera" && guide) return <CameraView guide={guide} onExit={() => setMode("setup")} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">FixCam</h1>
        <p className="mt-1 text-white/60">Point your phone at it. FixCam shows you exactly what to do.</p>
      </header>

      <section className="flex flex-col gap-3">
        <label className="text-sm font-medium text-white/80" htmlFor="product">
          What are you building or fixing?
        </label>
        <input
          id="product"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          className="rounded-xl bg-white/10 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-cyan-400"
        />

        <p className="text-sm font-medium text-white/80">Photos of the manual or the parts laid out (optional)</p>
        <div className="flex flex-wrap gap-2">
          {pages.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- local data URLs
            <img key={i} src={src} alt={`Manual page ${i + 1}`} className="h-20 w-16 rounded-lg object-cover" />
          ))}
          <label className="flex h-20 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-white/30 text-2xl text-white/60">
            +
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => addPages(e.target.files)}
            />
          </label>
        </div>
        {pages.length > 0 && (
          <button onClick={() => setPages([])} className="self-start text-xs text-white/50 underline">
            Clear photos
          </button>
        )}

        <label className="text-sm font-medium text-white/80" htmlFor="notes">
          How does it go together? (optional, in your own words)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. wheels into the base, then the gas lift, then the seat…"
          className="rounded-xl bg-white/10 px-4 py-3 text-base outline-none placeholder:text-white/30 focus:ring-2 focus:ring-cyan-400"
        />

        <button
          onClick={makeGuide}
          disabled={planning || !product.trim()}
          className="mt-2 rounded-full bg-cyan-400 py-4 text-lg font-semibold text-black disabled:opacity-50"
        >
          {planning ? (pages.length || notes.trim() ? "Reading your photos…" : "Looking it up…") : "Make my guide"}
        </button>
        {planning && <p className="text-center text-sm text-white/50">This takes about 20–60 seconds.</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {guide && (
        <section className="flex flex-col gap-3 rounded-2xl bg-white/5 p-4">
          <div>
            <p className="font-medium">{guide.product}</p>
            <p className="text-xs text-cyan-300">{BASIS_LABEL[guide.basis]}</p>
            {guide.sources.some((s) => s.startsWith("http")) && (
              <details className="mt-1 text-xs text-white/50">
                <summary className="cursor-pointer">Sources</summary>
                <ul className="mt-1 flex flex-col gap-1 break-all">
                  {guide.sources.map((s) => (
                    <li key={s}>
                      {s.startsWith("http") ? (
                        <a href={s} target="_blank" rel="noreferrer" className="underline">
                          {new URL(s).hostname}
                        </a>
                      ) : (
                        s
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <ol className="flex flex-col gap-2">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="w-5 shrink-0 text-right text-white/40">{i + 1}</span>
                <span>{s.instruction}</span>
              </li>
            ))}
          </ol>
          <button
            onClick={() => setMode("camera")}
            className="mt-2 rounded-full bg-white py-4 text-lg font-semibold text-black"
          >
            Start
          </button>
        </section>
      )}
    </main>
  );
}

/** Resizes a photo to at most MAX_PAGE_SIDE px and re-encodes it as JPEG, so uploads stay small. */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PAGE_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}
