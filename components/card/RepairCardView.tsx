// The repair card: before/after, what was wrong, how it was found (the causes and tests), the safety call,
// the steps, and what it cost against buying new. Paper look, prints to one or two A4 pages.
import Link from "next/link";
import type { Money, RepairCard, StoredPhoto } from "@/lib/repair/types";
import { ReportActions } from "@/components/report/ShareActions";
import { ZoomablePhoto } from "@/components/report/ZoomablePhoto";
import { Card, CardHeader } from "@/components/ui/Card";
import { AlertIcon, CheckIcon, ShieldIcon, WrenchIcon } from "@/components/ui/icons";

const PATH_LABEL = { diy: "Safe to fix yourself", careful: "Fixed carefully, after safety checks", shop: "Needed a repair shop" } as const;
const BASIS = {
  model: "Prices and fix from pages about this exact model.",
  similar: "Prices and fix from pages about similar devices.",
  general: "Nothing specific was found online.",
} as const;

const rupees = (m: Money) =>
  m.low === m.high ? `₹${m.low.toLocaleString("en-IN")}` : `₹${m.low.toLocaleString("en-IN")}–${m.high.toLocaleString("en-IN")}`;
const mid = (m: Money) => (m.low + m.high) / 2;

export function RepairCardView({ card }: { card: RepairCard }) {
  const name = capitalize([card.object.brand, card.object.name].filter(Boolean).join(" "));
  const r = card.research;
  const saved = card.fixed && r?.newPrice ? Math.round(mid(r.newPrice) - (r.part?.price ? mid(r.part.price) : 0)) : 0;
  const ewaste = card.fixed && r?.weightKg ? r.weightKg : 0;
  const date = new Date(card.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const shareText = card.fixed
    ? `I fixed my ${name.toLowerCase()} with FixCam${saved > 0 ? ` and saved about ₹${saved.toLocaleString("en-IN")}` : ""}.`
    : `My ${name.toLowerCase()} repair with FixCam.`;

  return (
    <article className="space-y-5">
      <header className="flex items-center justify-between gap-3 print:pt-0">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-ink text-paper" aria-hidden>
            <WrenchIcon className="size-4" />
          </span>
          <span className="font-semibold">FixCam</span>
        </Link>
        <span className="text-sm text-muted">Repair card · {date}</span>
      </header>

      <Card className="sm:p-6">
        <p className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${card.fixed ? "bg-ok/10 text-ok" : "bg-existing/12 text-existing"}`}>
          {card.fixed ? <CheckIcon className="size-4" /> : <AlertIcon className="size-4" />}
          {card.fixed ? "Fixed" : "Not fixed"}
        </p>
        <h1 className="mt-3 text-[30px] font-semibold leading-[36px] tracking-tight">
          {name}
          {card.object.model && <span className="ml-2 align-middle font-mono text-base font-normal text-muted">{card.object.model}</span>}
        </h1>
        {card.summary && <p className="mt-2 text-lg leading-relaxed">{card.summary}</p>}

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Cause" value={card.verdict?.cause ?? card.causes[0]?.text ?? "Unknown"} sub={card.verdict && `${card.verdict.confidence}% sure`} />
          <Stat label="Time" value={`${card.minutes} min`} sub={`${card.tests.length} ${card.tests.length === 1 ? "test" : "tests"}`} />
          {saved > 0 ? <Stat label="Saved vs new" value={`₹${saved.toLocaleString("en-IN")}`} tone="ok" /> : <Stat label="Steps" value={String(card.steps.length || "—")} />}
          {ewaste > 0 ? <Stat label="E-waste avoided" value={`${ewaste} kg`} tone="ok" /> : <Stat label="Outcome" value={card.fixed ? "Working" : "Not working"} />}
        </dl>

        <div className="mt-5">
          <ReportActions title={`Repair card: ${name}`} text={shareText} />
        </div>
      </Card>

      {(card.before || card.after) && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Photo label="Before" photo={card.before} name={name} />
          <Photo label="After" photo={card.after} name={name} />
        </div>
      )}

      {card.causes.length > 0 && (
        <Card>
          <CardHeader title="How it was diagnosed" subtitle={card.complaint && `The problem: ${card.complaint}`} />
          <ul className="space-y-2.5">
            {card.causes.map((c, i) => (
              <li key={c.text}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={i === 0 ? "font-semibold" : "text-muted"}>{c.text}</span>
                  <span className="tabular-nums text-muted">{c.likelihood}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/10">
                  <div className={`h-full rounded-full ${i === 0 ? "bg-info" : "bg-ink/30"}`} style={{ width: `${Math.max(3, c.likelihood)}%` }} />
                </div>
                {c.why && <p className="mt-1 text-sm text-muted">{c.why}</p>}
              </li>
            ))}
          </ul>
          {card.tests.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold uppercase tracking-wider text-muted">Tests</h3>
              <ol className="mt-2 space-y-2">
                {card.tests.map((t, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{t.ask}</span>
                    {t.result && <span className="text-muted"> → {t.result}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </Card>
      )}

      {card.verdict && (
        <Card>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-info/10 text-info">
              <ShieldIcon className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">{PATH_LABEL[card.verdict.path]}</h2>
              <p className="mt-0.5 text-sm text-muted">{card.verdict.safety}</p>
            </div>
          </div>
        </Card>
      )}

      {card.steps.length > 0 && (
        <Card>
          <CardHeader title="What was done" />
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
            {card.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Card>
      )}

      {r && (r.part || r.newPrice || r.sources.length > 0) && (
        <Card>
          <CardHeader title="Parts and prices" subtitle={BASIS[r.basis]} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {r.part && (
              <>
                <dt className="text-muted">Part</dt>
                <dd>
                  {r.part.name}
                  {r.part.price && <span className="font-semibold"> · {rupees(r.part.price)}</span>}
                </dd>
              </>
            )}
            {r.newPrice && (
              <>
                <dt className="text-muted">A new one</dt>
                <dd>{rupees(r.newPrice)}</dd>
              </>
            )}
          </dl>
          {r.howto && <p className="mt-3 text-sm leading-relaxed">{r.howto}</p>}
          {r.sources.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {r.sources.map((s) => (
                <li key={s.url} className="truncate">
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-info underline underline-offset-2">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="pb-4 text-center text-sm text-muted">
        Diagnosed and guided by FixCam. Safety calls are made by fixed rules, not by the AI.
      </p>
    </article>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string | false; tone?: "ok" }) {
  return (
    <div className="rounded-lg bg-ink/5 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`mt-1 line-clamp-2 font-semibold leading-snug ${tone === "ok" ? "text-ok" : ""}`}>{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function Photo({ label, photo, name }: { label: string; photo?: StoredPhoto; name: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]">{label}</figcaption>
      {photo && photo.width > 0 ? (
        <ZoomablePhoto
          className="mx-auto w-[min(100%,calc(45svh*var(--ar)))] print:w-[min(100%,calc(80mm*var(--ar)))]"
          photo={{ src: photo.url, width: photo.width, height: photo.height, alt: `${name}, ${label.toLowerCase()} the repair`, tone: "info", title: `${label} · ${name}` }}
        />
      ) : (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-line px-4 text-sm text-muted">No photo</div>
      )}
    </figure>
  );
}
