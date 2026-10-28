import { formatDate } from "./format";
import { PrintButton } from "./PrintButton";

export function ReportHeader({
  property,
  city,
  moveInAt,
  moveOutAt,
  reportId,
}: {
  property: string;
  city: string;
  moveInAt: number;
  moveOutAt: number;
  reportId: string;
}) {
  return (
    <header className="border-b border-(--line) pb-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold tracking-wide text-(color:--muted)">Deposit Guard</p>
        <PrintButton />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl print:mt-2">
        Deposit inspection report
      </h1>
      <p className="mt-3 text-xl leading-snug">{property || "Property"}</p>
      {city && <p className="text-lg text-(color:--muted)">{city}</p>}
      <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-base">
        <div>
          <dt className="text-sm text-(color:--muted)">Tenancy</dt>
          <dd className="tabular-nums">
            {formatDate(moveInAt)} <span aria-label="to">→</span> {formatDate(moveOutAt)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm text-(color:--muted)">Report ID</dt>
          <dd className="font-mono text-sm break-all">{reportId}</dd>
        </div>
      </dl>
    </header>
  );
}
