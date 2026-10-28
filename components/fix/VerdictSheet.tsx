import type { Money, RepairState } from "@/lib/repair/types";
import { hostname } from "@/components/camera/util";
import { AlertIcon, Button, CheckIcon, ShieldIcon, Sheet, Spinner, chipClass } from "@/components/ui";

const PATH = {
  diy: { label: "Safe to fix yourself", tone: "text-cam-ok bg-cam-ok/15", Icon: CheckIcon },
  careful: { label: "Fix it yourself, carefully", tone: "text-cam-existing bg-cam-existing/15", Icon: ShieldIcon },
  shop: { label: "Take it to a repair shop", tone: "text-cam-new bg-cam-new/15", Icon: AlertIcon },
} as const;

const BASIS = {
  model: "From pages about this exact model",
  similar: "From pages about similar devices",
  general: "Nothing specific found online, so this is general advice",
} as const;

export const rupees = (m: Money) =>
  m.low === m.high ? `₹${m.low.toLocaleString("en-IN")}` : `₹${m.low.toLocaleString("en-IN")}–${m.high.toLocaleString("en-IN")}`;

/** The verdict: cause, the path the safety rules chose, and what the part costs against a new one. */
export function VerdictSheet({
  open,
  onClose,
  repair,
  researching,
  researchError,
  onRetryResearch,
  onFix,
  onShop,
}: {
  open: boolean;
  onClose: () => void;
  repair: RepairState;
  researching: boolean;
  researchError: string;
  onRetryResearch: () => void;
  onFix: () => void;
  onShop: () => void;
}) {
  const v = repair.verdict;
  if (!v) return null;
  const path = PATH[v.path];
  const r = repair.research;
  const part = r?.part?.price;
  const fresh = r?.newPrice;
  const saving = part && fresh ? Math.round((fresh.low + fresh.high) / 2 - (part.low + part.high) / 2) : 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onDark
      title="What's wrong"
      footer={
        v.path === "shop" ? (
          <Button onDark block onClick={onShop}>
            I&rsquo;ll take it to a shop
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" onDark onClick={onClose}>
              Keep checking
            </Button>
            <Button onDark className="flex-1" onClick={onFix}>
              Start the fix
            </Button>
          </div>
        )
      }
    >
      <p className="text-2xl font-semibold leading-tight">{v.cause}</p>
      <p className="mt-1 text-sm text-white/70">{v.confidence}% sure, after {repair.tests.length || "no"} {repair.tests.length === 1 ? "test" : "tests"}</p>

      <div className={`mt-4 flex gap-2.5 rounded-xl p-3 ${path.tone}`}>
        <path.Icon className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">{path.label}</p>
          <p className="mt-0.5 text-sm text-white/85">{v.safety}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-white/10 p-3">
        {researching && !r ? (
          <p className="flex items-center gap-2 text-sm text-white/80">
            <Spinner /> Looking up the part and prices for this model…
          </p>
        ) : r ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {r.part && (
                <>
                  <dt className="text-white/60">Part</dt>
                  <dd>
                    {r.part.name}
                    {part && <span className="font-semibold"> · {rupees(part)}</span>}
                  </dd>
                </>
              )}
              {fresh && (
                <>
                  <dt className="text-white/60">New one</dt>
                  <dd>{rupees(fresh)}</dd>
                </>
              )}
              {saving > 0 && (
                <>
                  <dt className="text-white/60">You save</dt>
                  <dd className="font-semibold text-cam-ok">about ₹{saving.toLocaleString("en-IN")}</dd>
                </>
              )}
            </dl>
            {r.howto && <p className="mt-2 text-sm leading-snug text-white/85">{r.howto}</p>}
            <p className="mt-2 text-xs text-white/55">{BASIS[r.basis]}</p>
            {(v.path === "shop" ? r.shops : r.sources).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(v.path === "shop" && r.shops.length ? r.shops : r.sources).slice(0, 5).map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.title} className={chipClass("neutral", true)}>
                    {hostname(s.url)}
                  </a>
                ))}
              </div>
            )}
          </>
        ) : researchError ? (
          <div className="flex items-center justify-between gap-3 text-sm text-white/80">
            <span>Couldn&rsquo;t look up prices just now.</span>
            <Button variant="secondary" onDark onClick={onRetryResearch}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-sm text-white/70">Prices appear here once the lookup finishes.</p>
        )}
      </div>
    </Sheet>
  );
}
