import type { ReactNode } from "react";
import { formatDateTime, formatRange, hostOf } from "./format";
import { PhotoEvidence, type Tone } from "./PhotoEvidence";
import type { ResolvedFinding, Shot } from "./resolve";
import { SeverityBadge } from "./SeverityBadge";

const aspectOf = (shot?: Shot) => (shot ? `${shot.frame.width} / ${shot.frame.height}` : undefined);

function When({ shot }: { shot?: Shot }) {
  return shot ? <span className="block text-xs tabular-nums">{formatDateTime(shot.frame.t)}</span> : null;
}

/** A NEW issue: before/after photos, what it is, how to fix it and a fair price with sources. */
export function NewFindingCard({ finding }: { finding: ResolvedFinding }) {
  const { beforeShot: before, afterShot: after, cost } = finding;
  const beforeStatus = before?.defect
    ? `At move-in: ${before.defect.description}`
    : before
      ? "Not damaged at move-in"
      : undefined;

  return (
    <article className="rounded-xl border border-l-4 border-(--line) border-l-(--new) bg-(--card) p-4 sm:p-5 print:break-inside-avoid">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-(color:--new)">New since move-in</p>
          <h4 className="mt-0.5 text-lg leading-snug font-semibold sm:text-xl">{finding.summary}</h4>
        </div>
        <SeverityBadge severity={finding.severity} />
      </header>

      <div className="mt-4 grid grid-cols-2 items-start gap-3 sm:gap-4">
        <PhotoEvidence
          label="Before · move-in"
          frame={before?.frame}
          defect={before?.defect}
          tone="existing"
          emptyText="No move-in photo of this spot was matched"
          emptyAspect={aspectOf(after)}
          caption={
            before && (
              <>
                {beforeStatus}
                <When shot={before} />
              </>
            )
          }
        />
        <PhotoEvidence
          label="After · move-out"
          frame={after?.frame}
          defect={after?.defect}
          tone="new"
          emptyText="Photo missing"
          emptyAspect={aspectOf(before)}
          caption={
            after && (
              <>
                {after.defect?.description ?? finding.summary}
                {after.defect && !after.defect.outline && " (marked, not outlined)"}
                <When shot={after} />
              </>
            )
          }
        />
      </div>

      <dl className="mt-4 grid gap-4 border-t border-(--line) pt-4 sm:grid-cols-[1fr_auto] sm:gap-8">
        <div>
          <dt className="text-sm text-(color:--muted)">Repair</dt>
          <dd className="mt-0.5 text-base leading-relaxed">{finding.repair ?? "Not specified"}</dd>
        </div>
        <div className="sm:text-right">
          <dt className="text-sm text-(color:--muted)">Fair cost</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums">{cost ? formatRange(cost) : "Not estimated"}</dd>
        </div>
      </dl>
      {cost && cost.sources.length > 0 && (
        <p className="mt-3 text-sm leading-relaxed text-(color:--muted)">
          Local prices from{" "}
          {cost.sources.map((s, i) => (
            <span key={`${s.url}-${i}`}>
              {i > 0 && ", "}
              <a
                href={s.url}
                title={s.title}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(color:--link) underline decoration-(--line) underline-offset-2 hover:decoration-current"
              >
                {hostOf(s.url)}
              </a>
            </span>
          ))}
        </p>
      )}
    </article>
  );
}

/** A compact row for marks that are not chargeable (already there at move-in, or normal wear). */
export function FindingRow({ finding, tone }: { finding: ResolvedFinding; tone: Tone }) {
  const { beforeShot: before, afterShot: after } = finding;
  return (
    <li className="grid gap-3 py-4 sm:grid-cols-[1fr_14rem] sm:gap-5 print:break-inside-avoid">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="text-base leading-snug font-medium">{finding.summary}</p>
          <SeverityBadge severity={finding.severity} />
        </div>
        {before?.defect && (
          <p className="mt-1 text-sm text-(color:--muted)">Recorded at move-in: {before.defect.description}</p>
        )}
      </div>
      <div className="grid max-w-xs grid-cols-2 items-start gap-2">
        <PhotoEvidence
          frame={before?.frame}
          defect={before?.defect}
          tone={tone}
          emptyText="No move-in photo"
          emptyAspect={aspectOf(after)}
          caption="Move-in"
        />
        <PhotoEvidence
          frame={after?.frame}
          defect={after?.defect}
          tone={tone}
          emptyText="Photo missing"
          emptyAspect={aspectOf(before)}
          caption="Move-out"
        />
      </div>
    </li>
  );
}

/** Collapsed list section. Opened automatically when printing (see PrintButton). */
export function Collapsible({
  title,
  note,
  count,
  children,
}: {
  title: string;
  note?: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="group mt-4 rounded-xl border border-(--line) bg-(--card) print:break-inside-auto">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 select-none focus-visible:outline-2 focus-visible:outline-(--ink) [&::-webkit-details-marker]:hidden">
        <span className="text-base font-medium">
          {title} <span className="text-(color:--muted) tabular-nums">({count})</span>
          {note && <span className="block text-sm font-normal text-(color:--muted)">{note}</span>}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="size-5 shrink-0 fill-none stroke-current text-(color:--muted) transition-transform group-open:rotate-90 print:hidden"
          strokeWidth={1.8}
        >
          <path d="m8 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <ul className="divide-y divide-(--line) border-t border-(--line) px-4">{children}</ul>
    </details>
  );
}
