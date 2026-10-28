import type { Inspection } from "@/lib/inspect/types";
import { formatDateTime, plural, shortHash } from "./format";

function PhotoList({ title, inspection }: { title: string; inspection: Inspection }) {
  const rows = inspection.rooms.flatMap((room) => room.frames.map((frame, i) => ({ room: room.name, n: i + 1, frame })));
  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold">
        {title} <span className="font-normal text-(color:--muted)">({plural(rows.length, "photo")})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-(color:--muted)">No photos.</p>
      ) : (
        <ol className="mt-2 divide-y divide-(--line) border-y border-(--line)">
          {rows.map(({ room, n, frame }) => (
            <li key={frame.id} className="grid gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[12rem_1fr] print:break-inside-avoid">
              <div className="min-w-0">
                <a
                  href={frame.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-(color:--link) underline decoration-(--line) underline-offset-2 hover:decoration-current"
                >
                  {room} {n}
                </a>
                <span className="block text-xs text-(color:--muted) tabular-nums">{formatDateTime(frame.t)}</span>
              </div>
              <details className="min-w-0">
                <summary className="cursor-pointer font-mono text-sm select-none">
                  <span className="text-(color:--muted)">SHA-256 </span>
                  {shortHash(frame.sha256)}
                </summary>
                <code className="mt-1 block font-mono text-xs break-all">{frame.sha256}</code>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Everything a sceptical reader needs to check the report: capture times, fingerprints, models. */
export function EvidenceFooter({
  moveIn,
  moveOut,
  models,
  generatedAt,
}: {
  moveIn: Inspection;
  moveOut: Inspection;
  models: string[];
  generatedAt: number;
}) {
  return (
    <footer className="mt-16 border-t-2 border-(--ink) pt-6 text-base">
      <h2 className="text-2xl font-semibold tracking-tight">Evidence</h2>
      <p className="mt-3 max-w-prose leading-relaxed">
        Normal wear and tear is not deductible. Photos are fingerprinted; any edit changes the fingerprint.
      </p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-(color:--muted)">
        Each photo&rsquo;s SHA-256 fingerprint was recorded when it was stored. To check one, open the photo, save it,
        and compare its SHA-256 with the value below (for example <code className="font-mono">shasum -a 256</code> on
        Mac or Linux, <code className="font-mono">certutil -hashfile photo.jpg SHA256</code> on Windows). Times are
        Indian Standard Time.
      </p>

      <PhotoList title="Move-in photos" inspection={moveIn} />
      <PhotoList title="Move-out photos" inspection={moveOut} />

      <div className="mt-8">
        <h3 className="text-base font-semibold">How this report was made</h3>
        {models.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {models.map((m, i) => (
              <li key={`${m}-${i}`}>{m}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-(color:--muted)">Models not recorded.</p>
        )}
        <p className="mt-4 text-sm text-(color:--muted)">
          Report <span className="font-mono">{moveOut.id}</span> · move-in record{" "}
          <span className="font-mono">{moveIn.id}</span> · generated {formatDateTime(generatedAt)}
        </p>
      </div>
    </footer>
  );
}
