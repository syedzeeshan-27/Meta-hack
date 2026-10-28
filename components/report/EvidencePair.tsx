import type { ReactNode } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { clause, formatShortDateTime } from "./format";
import { photoAlt, type Shot } from "./resolve";
import { ZoomablePhoto } from "./ZoomablePhoto";

// Full column width, but never taller than ~60% of the screen (or 80 mm on paper).
const PHOTO_SIZE = "mx-auto w-[min(100%,calc(60svh*var(--ar)))] print:w-[min(100%,calc(80mm*var(--ar)))]";

/** Before (move-in) and after (move-out) of the same spot: stacked on phones, side by side from 640px and on paper. */
export function EvidencePair({
  room,
  before,
  after,
  className = "",
}: {
  room: string;
  before?: Shot;
  after?: Shot;
  className?: string;
}) {
  return (
    <div className={`grid gap-5 sm:grid-cols-2 sm:gap-4 print:grid-cols-2 print:gap-4 ${className}`}>
      <Side side="before" room={room} shot={before} />
      <Side side="after" room={room} shot={after} />
    </div>
  );
}

function Side({ side, room, shot }: { side: "before" | "after"; room: string; shot?: Shot }) {
  const isBefore = side === "before";
  const when = isBefore ? "move-in" : "move-out";
  const label = isBefore ? "Before" : "After";
  const defect = shot?.defect;
  const time = shot ? formatShortDateTime(shot.frame.t) : undefined;
  // The dot matches the outline drawn on that photo: amber at move-in, red at move-out, none if nothing's marked.
  const dot = defect?.outline ? (isBefore ? "bg-existing" : "bg-new") : "bg-line";

  let caption: ReactNode = null;
  if (isBefore && shot && defect) {
    caption = <>Recorded at move-in: {clause(defect.description)}.</>;
  } else if (isBefore && shot) {
    caption = (
      <span className="inline-flex items-start gap-1.5">
        <CheckIcon className="mt-0.5 size-4 shrink-0 text-ok" />
        Clean at move-in: nothing was marked here.
      </span>
    );
  } else if (!isBefore && defect && !defect.outline) {
    caption = "Marked at move-out; no outline could be drawn.";
  }

  return (
    <figure className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="text-xs font-semibold tracking-[0.08em] uppercase">{label}</span>
        <span className="truncate text-muted">
          {isBefore ? "Move-in" : "Move-out"}
          {time && `, ${time}`}
        </span>
      </div>

      {shot ? (
        <ZoomablePhoto
          className={PHOTO_SIZE}
          photo={{
            src: shot.frame.imageUrl,
            width: shot.frame.width,
            height: shot.frame.height,
            alt: photoAlt(room, when, defect, isBefore && !defect),
            outline: defect?.outline,
            tone: isBefore ? "existing" : "new",
            title: `${label} · ${room} · ${when}${time ? `, ${time}` : ""}`,
            note: defect?.description,
          }}
        />
      ) : (
        <div className="flex min-h-28 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-line px-4 py-6 text-center">
          <p className="font-medium">{isBefore ? "Not captured at move-in" : "Photo missing"}</p>
          <p className="mt-1 text-sm text-muted">
            {isBefore ? "No move-in photo of this spot was found." : "The move-out photo couldn't be found."}
          </p>
        </div>
      )}

      {caption && <figcaption className="mt-2 text-sm leading-snug text-muted">{caption}</figcaption>}
    </figure>
  );
}
