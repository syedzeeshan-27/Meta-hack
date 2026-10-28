import { Chip, type Tone } from "@/components/ui/Chip";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { Comparison } from "@/lib/inspect/types";
import { capitalize, clause, plural } from "./format";
import type { OutlineTone } from "./Outline";
import { photoAlt, type ResolvedFinding, type Shot } from "./resolve";
import { ZoomablePhoto } from "./ZoomablePhoto";

type Kind = "pre_existing" | "wear";

const KIND: Record<Kind, { title: string; note: string; tag: string; tone: Tone; outline: OutlineTone }> = {
  pre_existing: {
    title: "Already there at move-in",
    note: "Recorded in the move-in photos, so they can't be charged to the tenant.",
    tag: "ALREADY THERE",
    tone: "existing",
    outline: "existing",
  },
  wear: {
    title: "Normal wear",
    note: "Expected from everyday living, like light scuffs or faded paint. Normal wear and tear isn't deductible.",
    tag: "WEAR",
    tone: "neutral",
    outline: "info",
  },
};

/** Not-chargeable marks, collapsed. The summary keeps the count visible: this list is the tenant's protection. */
export function MarkList({ kind, findings }: { kind: Kind; findings: ResolvedFinding[] }) {
  const k = KIND[kind];
  return (
    <details className="group rounded-xl border border-line bg-surface print:break-inside-auto">
      <summary className="grid min-h-16 cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl px-4 py-3.5 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info sm:px-5 [&::-webkit-details-marker]:hidden">
        <h2 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base font-semibold">
          {k.title}
          <Chip tone={k.tone}>{plural(findings.length, "mark")}</Chip>
        </h2>
        <ChevronDownIcon className="row-span-2 size-5 text-muted transition-transform duration-200 group-open:rotate-180 print:hidden" />
        <span className="mt-1 text-sm leading-snug text-muted">{k.note}</span>
      </summary>
      <ul className="divide-y divide-line border-t border-line px-4 sm:px-5">
        {findings.map((f, i) => (
          <MarkRow key={`${f.after.frameId}-${f.after.defectId}-${i}`} finding={f} kind={kind} />
        ))}
      </ul>
    </details>
  );
}

function MarkRow({ finding, kind }: { finding: ResolvedFinding; kind: Kind }) {
  const k = KIND[kind];
  const { beforeShot: before, afterShot: after } = finding;
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row-reverse sm:items-start sm:gap-4 print:break-inside-avoid">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={k.tone}>{k.tag}</Chip>
          <span className="text-sm text-muted">{finding.room}</span>
        </div>
        <p className="mt-2 leading-snug font-medium">{finding.summary}</p>
        {before?.defect && (
          <p className="mt-1 text-sm leading-snug text-muted">At move-in: {clause(before.defect.description)}.</p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Thumb shot={before} room={finding.room} when="move-in" tone={k.outline} />
        <Thumb shot={after} room={finding.room} when="move-out" tone={k.outline} />
      </div>
    </li>
  );
}

const THUMB_H = 88;

function Thumb({ shot, room, when, tone }: { shot?: Shot; room: string; when: "move-in" | "move-out"; tone: OutlineTone }) {
  const label = when === "move-in" ? "Move-in" : "Move-out";
  if (!shot) {
    return (
      <div>
        <div
          className="grid place-items-center rounded-lg border border-dashed border-line px-1 text-center text-xs text-muted"
          style={{ width: 66, height: THUMB_H }}
        >
          No photo
        </div>
        <p className="mt-1 text-xs text-muted">{label}</p>
      </div>
    );
  }
  const { frame, defect } = shot;
  const width = Math.round(Math.min(120, Math.max(56, (THUMB_H * frame.width) / frame.height)));
  return (
    <div>
      <ZoomablePhoto
        hint={false}
        style={{ width, height: THUMB_H }}
        photo={{
          src: frame.imageUrl,
          width: frame.width,
          height: frame.height,
          alt: photoAlt(room, when, defect),
          outline: defect?.outline,
          tone,
          title: `${label} · ${room}`,
          note: defect?.description,
        }}
      />
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

/** Items listed at move-in that weren't seen at move-out. */
export function MissingItems({ items }: { items: Comparison["missingItems"] }) {
  return (
    <section
      aria-labelledby="missing-title"
      className="rounded-xl border border-line bg-surface px-4 py-4 sm:px-5 print:break-inside-avoid"
    >
      <h2 id="missing-title" className="text-base font-semibold">
        Missing items <span className="font-normal text-muted">· {items.length}</span>
      </h2>
      <p className="mt-1 text-sm leading-snug text-muted">
        Listed at move-in but not seen in the move-out photos. They may just have been out of frame, so check before
        charging for them.
      </p>
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {items.map((m, i) => (
          <li key={`${m.room}-${m.item}-${i}`} className="flex items-baseline justify-between gap-4 py-2.5">
            <span className="font-medium">{capitalize(m.item)}</span>
            <span className="text-sm text-muted">{m.room}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
