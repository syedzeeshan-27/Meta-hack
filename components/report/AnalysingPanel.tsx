"use client";

import { useSyncExternalStore } from "react";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";
import { plural } from "./format";

// A clock that ticks once a second on the client (0 during server render).
const everySecond = (tick: () => void) => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const serverSeconds = () => 0;

function elapsedText(s: number) {
  if (s >= 3600) return "over an hour";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Analysing…" with a sense of progress. The bar is an estimate from elapsed time, and says so. */
export function AnalysingPanel({
  startedAt,
  photosIn,
  photosOut,
}: {
  /** When the move-out walkthrough finished (the analysis starts then), ms. */
  startedAt: number;
  photosIn: number;
  photosOut: number;
}) {
  const now = useSyncExternalStore(everySecond, nowSeconds, serverSeconds);
  const elapsed = now ? Math.max(0, now - Math.floor(startedAt / 1000)) : 0;
  // Eases towards 95%: about 70% at one minute, never "done" until the report actually appears.
  const pct = Math.round(4 + 91 * (1 - Math.exp(-elapsed / 50)));
  const slow = elapsed > 180;

  return (
    <Card aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink/5">
          <Spinner className="size-5" />
        </span>
        <h2 className="text-xl leading-[26px] font-semibold">Analysing the move-out</h2>
      </div>
      <p className="mt-3 leading-relaxed text-muted">
        Usually about a minute. You can keep this page open; it updates by itself and shows the report when it&rsquo;s
        ready.
      </p>

      <div
        role="progressbar"
        aria-label="Estimated progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-5 h-2 overflow-hidden rounded-full bg-ink/10"
      >
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-sm text-muted tabular-nums">
        <span>{now ? `${elapsedText(elapsed)} so far` : "Starting…"}</span>
        <span>about 1 min</span>
      </div>

      <ol className="mt-5 space-y-2.5 text-sm">
        <li className="flex items-center gap-2.5">
          <CheckIcon className="size-4 shrink-0 text-ok" />
          Move-out walkthrough finished · {plural(photosOut, "photo")}
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="mx-0.5 size-3 shrink-0 rounded-full border-2 border-muted/50" />
          Comparing with the move-in record · {plural(photosIn, "photo")}
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="mx-0.5 size-3 shrink-0 rounded-full border-2 border-muted/50" />
          Checking local repair prices for anything new
        </li>
      </ol>

      {slow && (
        <p className="mt-5 rounded-lg bg-ink/5 px-4 py-3 text-sm leading-relaxed">
          This is taking longer than usual. You can close this page: the same link will show the report once it&rsquo;s
          done.
        </p>
      )}
    </Card>
  );
}
