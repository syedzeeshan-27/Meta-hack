"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/icons";

/**
 * Re-renders the server page every few seconds while the comparison is still running.
 * With `inspectionId`, it also asks the comparison route how the run is going, so a failed run
 * shows "Try again" (in place of `children`, the waiting panel) instead of "Analysing…" forever.
 */
export function AutoRefresh({
  everyMs = 3000,
  inspectionId,
  children,
}: {
  everyMs?: number;
  inspectionId?: string;
  children?: ReactNode;
}) {
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

  if (!failed) return <>{children}</>;
  return (
    <Card role="alert" className="print:hidden">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink/5">
          <AlertIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl leading-[26px] font-semibold">The comparison didn&rsquo;t finish</h2>
          <p className="mt-1 text-muted">
            The photos are saved, so nothing is lost. Running it again usually takes about a minute.
          </p>
          <p className="mt-2 text-sm break-words text-muted">Details: {failed}</p>
          <Button onClick={retry} loading={retrying} className="mt-5 w-full sm:w-auto">
            {retrying ? "Running again…" : "Try again"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
