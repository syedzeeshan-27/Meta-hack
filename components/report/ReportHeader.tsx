import { ShieldIcon } from "@/components/ui/icons";
import { formatDate } from "./format";

/** Brand mark, document title, the flat and the tenancy dates. Every field is optional (loading / not-found states). */
export function ReportHeader({
  property,
  city,
  moveInAt,
  moveOutAt,
}: {
  property?: string;
  city?: string;
  moveInAt?: number;
  moveOutAt?: number;
}) {
  return (
    <header className="pb-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-ink text-paper">
          <ShieldIcon className="size-[18px]" />
        </span>
        <span className="font-semibold tracking-tight">Deposit Guard</span>
      </div>

      <h1 className="mt-6 text-[28px] leading-[34px] font-semibold tracking-tight">Deposit inspection report</h1>
      {property && <p className="mt-1.5 text-lg leading-snug font-medium text-balance">{property}</p>}

      {(city || moveInAt) && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {city}
          {city && moveInAt ? " · " : null}
          {moveInAt ? (
            <span className="whitespace-nowrap">
              Move-in <span className="font-medium text-ink">{formatDate(moveInAt)}</span>
            </span>
          ) : null}
          {moveInAt && moveOutAt ? (
            <>
              {" "}
              <span aria-hidden>→</span>
              <span className="sr-only">to</span>{" "}
              <span className="whitespace-nowrap">
                Move-out <span className="font-medium text-ink">{formatDate(moveOutAt)}</span>
              </span>
            </>
          ) : null}
        </p>
      )}
    </header>
  );
}
