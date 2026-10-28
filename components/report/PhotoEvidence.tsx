import type { ReactNode } from "react";
import type { Defect, DefectOutline, Frame } from "@/lib/inspect/types";

/** new = damage to charge for (red), existing = already there at move-in (amber), wear = normal wear (blue). */
export type Tone = "new" | "existing" | "wear";

const TONE: Record<Tone, string> = {
  new: "fill-red-500/15 stroke-red-600",
  existing: "fill-amber-400/20 stroke-amber-500",
  wear: "fill-sky-400/15 stroke-sky-600",
};

/**
 * SAM outlines over a photo. The SVG uses the outline's pixel space with "meet", the same fit as the
 * image's object-contain, so outlines land on the photo whatever the box shape.
 */
export function OutlineOverlay({ outline, tone }: { outline: DefectOutline; tone: Tone }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full print:[print-color-adjust:exact]"
      viewBox={`0 0 ${outline.width} ${outline.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {outline.outlines.map((o, i) => (
        <g key={`${o.id}-${i}`}>
          {/* White halo first so the outline reads on dark and busy surfaces. */}
          <path
            d={o.path}
            transform={o.transform}
            fill="none"
            stroke="white"
            strokeOpacity={0.85}
            strokeWidth={5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={o.path}
            transform={o.transform}
            className={TONE[tone]}
            strokeWidth={2.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </svg>
  );
}

/** One photo with an optional outlined defect, a label above and a caption below. */
export function PhotoEvidence({
  frame,
  defect,
  tone,
  label,
  caption,
  emptyText = "No photo",
  emptyAspect = "3 / 4",
}: {
  frame?: Frame;
  defect?: Defect;
  tone: Tone;
  label?: string;
  caption?: ReactNode;
  emptyText?: string;
  /** Aspect ratio of the placeholder when there's no photo, usually the paired photo's. */
  emptyAspect?: string;
}) {
  return (
    <figure className="min-w-0">
      {label && <p className="mb-1.5 text-sm font-semibold tracking-wide text-(color:--muted) uppercase">{label}</p>}
      {frame ? (
        <a
          href={frame.imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open full photo"
          className="relative block max-h-[75vh] overflow-hidden rounded-lg border border-(--line) bg-(--paper) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ink)"
          style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- evidence photo shown as stored (local file or Blob URL), never re-encoded */}
          <img
            src={frame.imageUrl}
            alt={defect ? defect.description : (label ?? "Inspection photo")}
            width={frame.width}
            height={frame.height}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain"
          />
          {defect?.outline && <OutlineOverlay outline={defect.outline} tone={tone} />}
        </a>
      ) : (
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-(--line) p-4 text-center text-sm text-(color:--muted)"
          style={{ aspectRatio: emptyAspect }}
        >
          {emptyText}
        </div>
      )}
      {caption && <figcaption className="mt-1.5 text-sm leading-snug text-(color:--muted)">{caption}</figcaption>}
    </figure>
  );
}
