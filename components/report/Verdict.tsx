import type { ReactNode } from "react";
import type { Money } from "@/lib/inspect/types";
import { formatMoney, formatRange, plural } from "./format";

/** The answer first: how many new issues, the fair deduction, and what isn't chargeable. */
export function Verdict({
  newCount,
  existingCount,
  wearCount,
  missingCount,
  unpriced,
  total,
  actions,
}: {
  newCount: number;
  existingCount: number;
  wearCount: number;
  missingCount: number;
  /** New issues with no price estimate (not in the total). */
  unpriced: number;
  total: Money;
  actions?: ReactNode;
}) {
  const clean = newCount === 0;
  const priced = !clean && total.high > 0;

  let note: string;
  if (clean) note = "The full deposit should be returned.";
  else if (!priced) note = "No local repair prices were found for these issues.";
  else {
    note = `Local repair prices for the new ${newCount === 1 ? "issue" : "issues"} only. Sources are under each issue.`;
    if (unpriced > 0) note += ` ${plural(unpriced, "issue")} had no price, so ${unpriced === 1 ? "it isn't" : "they aren't"} included.`;
  }

  const context = [
    existingCount > 0 && `${existingCount} ${existingCount === 1 ? "mark was" : "marks were"} already there at move-in`,
    wearCount > 0 && `${plural(wearCount, "sign")} of normal wear (not chargeable)`,
    missingCount > 0 && `${plural(missingCount, "item")} not seen at move-out`,
  ].filter((s): s is string => Boolean(s));

  return (
    <section
      aria-labelledby="verdict-title"
      className="rounded-xl border border-line bg-surface p-5 sm:p-7 print:break-inside-avoid"
    >
      <h2 id="verdict-title" className="text-[28px] leading-[34px] font-semibold tracking-tight text-balance">
        {clean ? (
          <>
            <span className="text-ok">No new damage</span> since move-in
          </>
        ) : (
          <>
            <span className="text-new">{plural(newCount, "new issue")}</span> since move-in
          </>
        )}
      </h2>

      <div className={`mt-5 rounded-lg px-4 py-4 sm:px-5 ${clean ? "bg-ok/8" : "bg-new/6"}`}>
        <p className="text-sm font-medium text-muted">Fair deduction</p>
        <p
          className={`mt-1 text-[34px] leading-[40px] font-semibold tracking-tight tabular-nums ${
            clean ? "text-ok" : priced ? "text-new" : ""
          }`}
        >
          {clean ? formatMoney(0, total.currency) : priced ? formatRange(total) : "Not estimated"}
        </p>
        <p className="mt-1.5 text-sm leading-snug">{note}</p>
      </div>

      {context.length > 0 && <p className="mt-4 text-sm leading-relaxed text-muted">{context.join(" · ")}</p>}

      {actions && <div className="mt-5 border-t border-line pt-5 print:hidden">{actions}</div>}
    </section>
  );
}
