import type { PhotoOutline } from "@/lib/types";

/** new = something wrong (red), existing = caution (amber), info = "here it is" (teal). */
export type OutlineTone = "existing" | "new" | "info";

const TONE_CLASS: Record<OutlineTone, string> = { existing: "tone-existing", new: "tone-new", info: "" };

/**
 * SAM outlines over a photo, using the shared `part-outline` tones. The SVG uses the frame's pixel space
 * with "meet", the same fit as the image's object-contain, so outlines land on the photo whatever the box shape.
 */
export function OutlineOverlay({ outline, tone }: { outline: PhotoOutline; tone: OutlineTone }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
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
            strokeOpacity={0.9}
            strokeWidth={5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={o.path}
            transform={o.transform}
            className={`part-outline ${TONE_CLASS[tone]}`}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </svg>
  );
}
