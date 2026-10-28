import type { Money } from "@/lib/inspect/types";
import { formatRange, plural } from "./format";

function Count({ label, value, note, tone }: { label: string; value: number; note: string; tone: "new" | "plain" }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0 sm:px-5">
      <dt className="text-sm leading-snug text-(color:--muted)">{label}</dt>
      <dd className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "new" ? "text-(color:--new)" : ""}`}>{value}</dd>
      <dd className="text-xs text-(color:--muted)">{note}</dd>
    </div>
  );
}

/** The answer first: what can fairly be deducted, and how much of what was found isn't chargeable. */
export function Summary({
  newCount,
  existingCount,
  wearCount,
  total,
  photosIn,
  photosOut,
  roomCount,
}: {
  newCount: number;
  existingCount: number;
  wearCount: number;
  total: Money;
  photosIn: number;
  photosOut: number;
  roomCount: number;
}) {
  return (
    <section aria-labelledby="summary-title" className="mt-8 rounded-2xl border border-(--line) bg-(--card) p-5 sm:p-7 print:break-inside-avoid">
      <h2 id="summary-title" className="text-sm font-semibold tracking-wide text-(color:--muted) uppercase">
        Fair deduction
      </h2>
      <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
        {newCount === 0 ? formatRange({ low: 0, high: 0, currency: total.currency }) : formatRange(total)}
      </p>
      <p className="mt-2 text-base leading-relaxed text-(color:--muted)">
        {newCount === 0
          ? "No new damage was found. Nothing here should come out of the deposit."
          : `Local repair cost for the ${plural(newCount, "new issue")} only. Marks that were already there and normal wear are not included.`}
      </p>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-(--line) border-t border-(--line) pt-5">
        <Count label="New issues" value={newCount} note="chargeable" tone="new" />
        <Count label="Already there at move-in" value={existingCount} note="not chargeable" tone="plain" />
        <Count label="Normal wear and tear" value={wearCount} note="not chargeable" tone="plain" />
      </dl>

      <p className="mt-5 text-sm text-(color:--muted)">
        Compared {plural(photosOut, "move-out photo")} with {plural(photosIn, "move-in photo")} across{" "}
        {plural(roomCount, "room")}.
      </p>
    </section>
  );
}
