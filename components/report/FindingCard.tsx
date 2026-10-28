import { Chip, chipClass } from "@/components/ui/Chip";
import { EvidencePair } from "./EvidencePair";
import { formatRange, hostOf } from "./format";
import { ExternalLinkIcon } from "./icons";
import type { ResolvedFinding } from "./resolve";
import { SeverityChip } from "./SeverityBadge";

/** A NEW issue: before/after photos, what it is, how to fix it and a fair local price with sources. */
export function NewIssueCard({
  finding,
  index,
  pageBreak = false,
}: {
  finding: ResolvedFinding;
  index: number;
  /** Start a new printed page here (the first card of each room after the first). */
  pageBreak?: boolean;
}) {
  const { beforeShot, afterShot, cost } = finding;
  const detail = afterShot?.defect?.description;
  const titleId = `new-issue-${index}`;
  const sources = cost ? [...new Map(cost.sources.map((s) => [s.url, s])).values()] : [];

  return (
    <article
      aria-labelledby={titleId}
      className={`rounded-xl border border-line bg-surface p-4 sm:p-6 print:break-inside-avoid ${
        pageBreak ? "print:break-before-page" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="new">NEW</Chip>
        <SeverityChip severity={finding.severity} />
        <span className="ml-auto text-sm font-medium text-muted">{finding.room}</span>
      </div>

      <h3 id={titleId} className="mt-3 text-xl leading-[26px] font-semibold text-balance">
        {finding.summary}
      </h3>
      {detail && detail !== finding.summary && <p className="mt-1 text-sm leading-relaxed text-muted">{detail}</p>}

      <EvidencePair className="mt-5" room={finding.room} before={beforeShot} after={afterShot} />

      <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-[1fr_auto] sm:gap-8">
        <div className="min-w-0">
          <dt className="text-sm text-muted">Repair</dt>
          <dd className="mt-0.5 leading-relaxed">{finding.repair ?? "Not specified"}</dd>
        </div>
        <div className="sm:text-right">
          <dt className="text-sm text-muted">Fair cost</dt>
          <dd className="mt-0.5 text-xl font-semibold whitespace-nowrap tabular-nums">
            {cost ? formatRange(cost) : "Not estimated"}
          </dd>
        </div>
      </dl>

      {sources.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-3">
          <span className="text-sm text-muted">Local prices from</span>
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title}
              className={`${chipClass("neutral")} relative transition-colors after:absolute after:inset-x-0 after:-inset-y-2 hover:bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info`}
            >
              {hostOf(s.url)}
              <ExternalLinkIcon className="size-3.5 text-muted print:hidden" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
