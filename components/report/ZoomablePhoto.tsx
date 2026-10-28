"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { ZoomInIcon } from "./icons";
import { OutlineOverlay } from "./Outline";
import { PhotoViewer, type Photo } from "./PhotoViewer";

/**
 * An evidence photo with its outline. Tapping it opens the full-screen viewer.
 * The box keeps the photo's aspect ratio (no layout shift); `--ar` is exposed so callers can cap its height.
 * Pass an explicit width/height in `style` for fixed-size thumbnails.
 */
export function ZoomablePhoto({
  photo,
  className = "",
  style,
  hint = true,
}: {
  photo: Photo;
  className?: string;
  style?: CSSProperties;
  /** The small zoom badge in the corner. Off for thumbnails. */
  hint?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className={`relative block shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-ink/5 ring-1 ring-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info ${className}`}
        style={
          {
            aspectRatio: `${photo.width} / ${photo.height}`,
            "--ar": photo.width / photo.height,
            ...style,
          } as CSSProperties
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- evidence photo shown as stored (local file or Blob URL), never re-encoded */}
        <img
          src={photo.src}
          alt={photo.alt}
          width={photo.width}
          height={photo.height}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-contain"
        />
        {photo.outline && <OutlineOverlay outline={photo.outline} tone={photo.tone} />}
        <span className="sr-only"> (open full screen)</span>
        {hint && (
          <span
            aria-hidden
            className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm print:hidden"
          >
            <ZoomInIcon className="size-4" />
          </span>
        )}
      </button>
      {open && <PhotoViewer photo={photo} onClose={close} />}
    </>
  );
}
