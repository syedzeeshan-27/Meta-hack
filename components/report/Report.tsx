import type { Comparison, Inspection } from "@/lib/inspect/types";
import { EvidenceSection } from "./EvidenceFooter";
import { NewIssueCard } from "./FindingCard";
import { formatRange, plural } from "./format";
import { MarkList, MissingItems } from "./OtherFindings";
import { ReportHeader } from "./ReportHeader";
import { resolveFindings, roomOrder, sortByRoom } from "./resolve";
import { ReportActions, StickyShare } from "./ShareActions";
import { Verdict } from "./Verdict";

const SHARE_TITLE = "Deposit inspection report";

/** The finished report, in the order a landlord or tenant needs it: verdict, new issues, the rest, evidence. */
export function Report({ moveIn, moveOut, comparison }: { moveIn: Inspection; moveOut: Inspection; comparison: Comparison }) {
  const rooms = roomOrder(moveIn, moveOut, comparison);
  const all = resolveFindings(moveIn, moveOut, comparison.findings);
  const pick = (status: string) => sortByRoom(all.filter((f) => f.status === status), rooms);
  const fresh = pick("new");
  const existing = pick("pre_existing");
  const wear = pick("wear");
  const missing = comparison.missingItems;

  const property = moveOut.property || moveIn.property;
  const city = moveOut.city || moveIn.city;
  const place = [property, city].filter(Boolean).join(", ");
  const priced = comparison.total.high > 0;
  const shareText =
    fresh.length === 0
      ? `Move-out inspection${place ? ` for ${place}` : ""}: no new damage since move-in, so the full deposit should be returned. Photos and fingerprints:`
      : `Move-out inspection${place ? ` for ${place}` : ""}: ${plural(fresh.length, "new issue")} since move-in${
          priced ? `, fair deduction ${formatRange(comparison.total)}` : ""
        }. Before/after photos, prices and sources:`;

  return (
    <>
      <ReportHeader
        property={property}
        city={city}
        moveInAt={moveIn.createdAt}
        moveOutAt={moveOut.finishedAt ?? moveOut.createdAt}
      />

      <Verdict
        newCount={fresh.length}
        existingCount={existing.length}
        wearCount={wear.length}
        missingCount={missing.length}
        unpriced={fresh.filter((f) => !f.cost).length}
        total={comparison.total}
        actions={<ReportActions title={SHARE_TITLE} text={shareText} />}
      />

      {fresh.length > 0 && (
        <section aria-labelledby="new-title" className="mt-10">
          <div className="flex items-baseline justify-between gap-3 print:break-after-avoid">
            <h2 id="new-title" className="text-xl leading-[26px] font-semibold">
              New issues
            </h2>
            <span className="text-sm text-muted">Chargeable · {fresh.length}</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Seen at move-out, not at move-in. <span className="print:hidden">Tap a photo to zoom in.</span>
          </p>
          <div className="mt-4 space-y-4">
            {fresh.map((f, i) => (
              <NewIssueCard
                key={`${f.after.frameId}-${f.after.defectId}-${i}`}
                finding={f}
                index={i}
                pageBreak={i > 0 && f.room !== fresh[i - 1].room}
              />
            ))}
          </div>
        </section>
      )}

      {(existing.length > 0 || wear.length > 0 || missing.length > 0) && (
        <div className="mt-10 space-y-3">
          {existing.length > 0 && <MarkList kind="pre_existing" findings={existing} />}
          {wear.length > 0 && <MarkList kind="wear" findings={wear} />}
          {missing.length > 0 && <MissingItems items={missing} />}
        </div>
      )}

      <EvidenceSection moveIn={moveIn} moveOut={moveOut} models={comparison.models} generatedAt={comparison.createdAt} />

      <StickyShare title={SHARE_TITLE} text={shareText} />
      {/* Room for the phone share bar, so it never covers the footer. */}
      <div aria-hidden className="h-20 sm:hidden print:hidden" />
    </>
  );
}
