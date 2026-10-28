import { plural } from "./format";
import { Collapsible, FindingRow, NewFindingCard } from "./FindingCard";
import type { ResolvedFinding } from "./resolve";

/** One room: new issues as full cards, then the not-chargeable marks collapsed. */
export function RoomSection({
  room,
  findings,
  photosIn,
  photosOut,
}: {
  room: string;
  findings: ResolvedFinding[];
  photosIn: number;
  photosOut: number;
}) {
  const fresh = findings.filter((f) => f.status === "new");
  const existing = findings.filter((f) => f.status === "pre_existing");
  const wear = findings.filter((f) => f.status === "wear");

  return (
    <section className="mt-10 first:mt-6" aria-label={room}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--line) pb-2 print:break-after-avoid">
        <h3 className="text-2xl font-semibold tracking-tight">{room}</h3>
        <p className="text-sm text-(color:--muted) tabular-nums">
          {plural(photosIn, "photo")} in · {plural(photosOut, "photo")} out
        </p>
      </div>

      {fresh.length > 0 ? (
        <div className="mt-4 space-y-5">
          {fresh.map((f, i) => (
            <NewFindingCard key={`${f.after.frameId}-${f.after.defectId}-${i}`} finding={f} />
          ))}
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-base text-(color:--ok)">
          <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 fill-none stroke-current" strokeWidth={2}>
            <path d="m5 10.5 3.2 3L15 6.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          No new damage found in this room.
        </p>
      )}

      {existing.length > 0 && (
        <Collapsible title="Already there at move-in" count={existing.length} note="Recorded at move-in, so not chargeable">
          {existing.map((f, i) => (
            <FindingRow key={`${f.after.frameId}-${f.after.defectId}-${i}`} finding={f} tone="existing" />
          ))}
        </Collapsible>
      )}
      {wear.length > 0 && (
        <Collapsible title="Normal wear and tear" count={wear.length} note="Expected from everyday use, not chargeable">
          {wear.map((f, i) => (
            <FindingRow key={`${f.after.frameId}-${f.after.defectId}-${i}`} finding={f} tone="wear" />
          ))}
        </Collapsible>
      )}
    </section>
  );
}
