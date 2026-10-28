"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AlertIcon, Button, ButtonLink, CameraIcon, Card, CardHeader, CheckIcon, ShieldIcon } from "@/components/ui";
import type { Inspection } from "@/lib/inspect/types";
import { createInspection, errorText } from "./api";
import type { Flat } from "./flats";
import { formatDay, formatRange, plural } from "./format";
import { useComparison, type ComparisonView } from "./useComparison";

export function FlatCard({ flat, highlight }: { flat: Flat; highlight: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const result = useComparison(flat.moveOut?.finishedAt ? flat.moveOut.id : undefined);

  // Next keeps this page alive (hidden) while the walkthrough runs; don't come back to a spinning button.
  useLayoutEffect(
    () => () => {
      setStarting(false);
      setError("");
    },
    [],
  );

  useEffect(() => {
    if (!highlight) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [highlight]);

  async function startMoveOut(baseline: Inspection) {
    setStarting(true);
    setError("");
    try {
      const created = await createInspection({
        kind: "move_out",
        property: baseline.property,
        city: baseline.city,
        baselineId: baseline.id,
      });
      router.push(`/inspect/${encodeURIComponent(created.id)}`);
    } catch (err) {
      setError(`Couldn't start the move-out: ${errorText(err)}. Tap Start move-out to try again.`);
      setStarting(false);
    }
  }

  const { moveIn, moveOut, next } = flat;
  const forFlat = ` for ${flat.name}`;

  return (
    <Card
      ref={ref}
      className={`transition-shadow duration-500 ${highlight ? "ring-2 ring-ok ring-offset-2 ring-offset-paper" : ""}`}
    >
      <CardHeader title={flat.name} subtitle={flat.city} />

      <ul className="flex flex-col gap-1.5 text-sm">
        {moveIn ? (
          <StatusRow state={moveIn.finishedAt ? "done" : "active"} label="Move-in">
            {moveIn.finishedAt
              ? `${formatDay(moveIn.finishedAt)} · ${plural(moveIn.rooms.length, "room")}`
              : inProgress(moveIn)}
          </StatusRow>
        ) : (
          <StatusRow state="todo" label="Move-in">
            record not found
          </StatusRow>
        )}
        {moveOut ? (
          <StatusRow state={moveOut.finishedAt ? "done" : "active"} label="Move-out">
            {moveOut.finishedAt ? formatDay(moveOut.finishedAt) : inProgress(moveOut)}
          </StatusRow>
        ) : (
          <StatusRow state="todo" label="Move-out">
            not done yet
          </StatusRow>
        )}
      </ul>

      {result && <ResultLine result={result} />}

      <div className="mt-4">
        {next.kind === "continue_move_in" && (
          <ButtonLink
            href={`/inspect/${encodeURIComponent(next.inspection.id)}`}
            variant="secondary"
            block
            icon={<CameraIcon />}
            aria-label={`Continue move-in${forFlat}`}
          >
            Continue move-in
          </ButtonLink>
        )}
        {next.kind === "start_move_out" && (
          <Button
            variant="secondary"
            block
            icon={<CameraIcon />}
            loading={starting}
            onClick={() => void startMoveOut(next.baseline)}
            aria-label={`Start move-out${forFlat}`}
          >
            {starting ? "Starting…" : "Start move-out"}
          </Button>
        )}
        {next.kind === "continue_move_out" && (
          <ButtonLink
            href={`/inspect/${encodeURIComponent(next.inspection.id)}`}
            variant="secondary"
            block
            icon={<CameraIcon />}
            aria-label={`Continue move-out${forFlat}`}
          >
            Continue move-out
          </ButtonLink>
        )}
        {next.kind === "view_report" && (
          <ButtonLink
            href={`/r/${encodeURIComponent(next.inspection.id)}`}
            variant="secondary"
            block
            icon={<ShieldIcon />}
            aria-label={`View report${forFlat}`}
          >
            View report
          </ButtonLink>
        )}
      </div>

      <div aria-live="polite">
        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-sm text-ink">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-muted" />
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

function inProgress(i: Inspection): string {
  const rooms = i.rooms.length;
  return rooms ? `in progress · ${plural(rooms, "room")} so far` : "in progress · just started";
}

const dotClass = {
  done: "bg-ok",
  active: "border-2 border-info",
  todo: "border-2 border-muted/50",
} as const;

/** "● Move-in 12 Oct · 5 rooms". The dot is decoration; the words carry the meaning. */
function StatusRow({ state, label, children }: { state: keyof typeof dotClass; label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${dotClass[state]}`} />
      <span className="min-w-0">
        <span className="font-medium text-ink">{label}</span> <span className="text-muted">{children}</span>
      </span>
    </li>
  );
}

function ResultLine({ result }: { result: ComparisonView }) {
  let body: ReactNode;
  switch (result.state) {
    case "loading":
      body = (
        <>
          <span aria-hidden className="block h-5 w-48 animate-pulse rounded bg-ink/5" />
          <span className="sr-only">Checking the result…</span>
        </>
      );
      break;
    case "ready":
      body =
        result.newCount > 0 ? (
          <p className="font-semibold text-new">
            {plural(result.newCount, "new issue")}
            {result.total.high > 0 && ` · ${formatRange(result.total)}`}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 font-semibold text-ok">
            <CheckIcon className="size-4" />
            No new damage
          </p>
        );
      break;
    case "running":
      body = <p className="text-muted">Analysing… about 1 min</p>;
      break;
    case "not_started":
      body = <Muted>Not analysed yet — open report</Muted>;
      break;
    case "failed":
      body = <Muted>Couldn&rsquo;t analyse — open report</Muted>;
      break;
    case "error":
      body = <Muted>Couldn&rsquo;t check the result — open report</Muted>;
      break;
  }
  return (
    <div aria-live="polite" className="mt-3 min-h-6">
      {body}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted">
      <AlertIcon className="size-4 shrink-0" />
      {children}
    </p>
  );
}
