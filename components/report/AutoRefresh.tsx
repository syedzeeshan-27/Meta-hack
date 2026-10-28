"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Re-renders the server page every few seconds while the comparison is still running.
 * With `inspectionId`, it also asks the comparison route how the run is going, so a failed run
 * shows "Try again" instead of "Analysing…" forever.
 */
export function AutoRefresh({ everyMs = 3000, inspectionId }: { everyMs?: number; inspectionId?: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (failed) return;
    const timer = setInterval(async () => {
      if (inspectionId) {
        try {
          const res = await fetch(`/api/inspections/${inspectionId}/comparison`, { cache: "no-store" });
          if (!res.ok) {
            const body = (await res.json()) as { status?: string; detail?: string };
            if (body.status === "failed") {
              setFailed(body.detail ?? "The analysis stopped with an error.");
              return;
            }
          }
        } catch {}
      }
      router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, inspectionId, failed]);

  async function retry() {
    if (!inspectionId) return;
    setRetrying(true);
    try {
      await fetch(`/api/inspections/${inspectionId}/comparison`, { method: "POST" });
    } finally {
      setRetrying(false);
      setFailed(null);
      router.refresh();
    }
  }

  if (!failed) return null;
  return (
    <div className="mx-auto mt-4 max-w-md rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100 print:hidden">
      <p className="font-medium">The comparison didn&rsquo;t finish.</p>
      <p className="mt-1 opacity-80">{failed}</p>
      <button
        onClick={retry}
        disabled={retrying}
        className="mt-3 rounded-full bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {retrying ? "Running again… (up to a few minutes)" : "Try again"}
      </button>
    </div>
  );
}
