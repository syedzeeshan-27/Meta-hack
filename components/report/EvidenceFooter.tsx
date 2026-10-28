import type { ReactNode } from "react";
import { ShieldIcon } from "@/components/ui/icons";
import type { Inspection } from "@/lib/inspect/types";
import { formatDateTime, formatSpan, plural, shortHash } from "./format";
import { frameCount } from "./resolve";

const panel = "rounded-xl border border-line bg-surface p-4 sm:p-5";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function PhotoList({ title, inspection }: { title: string; inspection: Inspection }) {
  const rows = inspection.rooms.flatMap((room) => room.frames.map((frame, i) => ({ room: room.name, n: i + 1, frame })));
  return (
    <div className="mt-4 first:mt-0">
      <h4 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted">· {plural(rows.length, "photo")}</span>
      </h4>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No photos.</p>
      ) : (
        <ol className="mt-1 divide-y divide-line">
          {rows.map(({ room, n, frame }) => (
            <li
              key={frame.id}
              className="grid gap-x-4 gap-y-1 py-2.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)] print:break-inside-avoid"
            >
              <div className="min-w-0">
                <a
                  href={frame.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-info underline decoration-info/30 underline-offset-2 hover:decoration-current"
                >
                  {room} {n}
                </a>
                <span className="block text-xs text-muted tabular-nums">{formatDateTime(frame.t)}</span>
              </div>
              <details className="min-w-0">
                <summary className="cursor-pointer font-mono select-none">
                  <span className="text-muted">SHA-256 </span>
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

/** Everything a sceptical reader needs to check the report: times, fingerprints, how to verify, models. */
export function EvidenceSection({
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
    <section aria-labelledby="evidence-title" className="mt-12 print:break-before-page">
      <h2 id="evidence-title" className="text-xl leading-[26px] font-semibold">
        Evidence
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Every photo was fingerprinted (SHA-256) when it was stored. Changing even one pixel changes the fingerprint.
        Times are Indian Standard Time.
      </p>

      <dl className={`mt-4 divide-y divide-line text-sm ${panel}`}>
        <Row label="Move-in walkthrough">
          {formatSpan(moveIn.createdAt, moveIn.finishedAt)} · {plural(frameCount(moveIn), "photo")}
        </Row>
        <Row label="Move-out walkthrough">
          {formatSpan(moveOut.createdAt, moveOut.finishedAt)} · {plural(frameCount(moveOut), "photo")}
        </Row>
        <Row label="Report generated">{formatDateTime(generatedAt)}</Row>
        <Row label="Report ID">
          <span className="font-mono break-all">{moveOut.id}</span>
        </Row>
        <Row label="Move-in record">
          <span className="font-mono break-all">{moveIn.id}</span>
        </Row>
      </dl>

      <div className={`mt-3 ${panel} print:break-inside-avoid`}>
        <h3 className="text-base font-semibold">How to verify</h3>
        <p className="mt-1 text-sm leading-relaxed">
          Download a photo and compute its SHA-256; it must match the fingerprint listed below.
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>
            Mac or Linux:{" "}
            <code className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs text-ink">shasum -a 256 photo.jpg</code>
          </li>
          <li>
            Windows:{" "}
            <code className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs text-ink">
              certutil -hashfile photo.jpg SHA256
            </code>
          </li>
        </ul>
      </div>

      <div className={`mt-3 ${panel}`}>
        <h3 className="mb-3 text-base font-semibold">Photo fingerprints</h3>
        <PhotoList title="Move-in" inspection={moveIn} />
        <PhotoList title="Move-out" inspection={moveOut} />
      </div>

      <div className={`mt-3 ${panel} print:break-inside-avoid`}>
        <h3 className="text-base font-semibold">Models used</h3>
        {models.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {models.map((m, i) => (
              <li key={`${m}-${i}`}>{m}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">Not recorded.</p>
        )}
      </div>

      <footer className="mt-10 flex items-start gap-2 border-t border-line pt-5 text-xs leading-relaxed text-muted">
        <ShieldIcon className="mt-px size-4 shrink-0" />
        <p>
          Made with Deposit Guard, which compares the move-in and move-out photos of the same flat. Only new damage is
          priced; marks recorded at move-in and normal wear are listed but not charged.
        </p>
      </footer>
    </section>
  );
}
