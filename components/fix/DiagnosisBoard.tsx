import type { RepairState, TestKind } from "@/lib/repair/types";
import { ChatBubbleIcon, EyeIcon, HandIcon, WaveIcon } from "@/components/ui";

const TEST_ICON: Record<TestKind, typeof EyeIcon> = { look: EyeIcon, do: HandIcon, say: ChatBubbleIcon, listen: WaveIcon };
const TEST_LABEL: Record<TestKind, string> = { look: "Show me", do: "Try this", say: "Tell me", listen: "Sound test" };

/**
 * The live diagnosis: what it is, the likely causes with confidence bars that move as tests come in,
 * and the one test it's waiting on. Bars keep their key per cause so a changing likelihood animates.
 */
export function DiagnosisBoard({ repair }: { repair: RepairState }) {
  const { object, causes, nextTest, tests, verdict } = repair;
  if (!object && !causes.length) return null;
  const title = [object?.brand, object?.name].filter(Boolean).join(" ");
  const Icon = nextTest ? TEST_ICON[nextTest.kind] : null;

  return (
    <section aria-label="Diagnosis" className="anim-fade rounded-2xl bg-black/65 p-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-cam-info">
          {verdict ? "Diagnosed" : "Diagnosing"}
        </span>
        {title && <span className="min-w-0 truncate text-sm font-medium">{title}</span>}
        {object?.model && (
          <span className="shrink-0 rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-xs text-white/85">{object.model}</span>
        )}
        {tests.length > 0 && <span className="ml-auto shrink-0 text-xs text-white/60">{tests.length} {tests.length === 1 ? "test" : "tests"}</span>}
      </div>

      {causes.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {causes.slice(0, 3).map((c, i) => (
            <li key={c.text.toLowerCase()}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className={`min-w-0 truncate ${i === 0 ? "font-medium text-white" : "text-white/75"}`} title={c.why}>
                  {c.text}
                </span>
                <span className="shrink-0 tabular-nums text-white/70">{c.likelihood}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ease-out ${i === 0 ? "bg-cam-info" : "bg-white/45"}`}
                  style={{ width: `${Math.max(3, c.likelihood)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextTest && Icon && (
        <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-white/10 px-2.5 py-2 text-sm leading-snug">
          <Icon className="mt-0.5 size-4 shrink-0 text-cam-info" />
          <span>
            <span className="font-semibold text-cam-info">{TEST_LABEL[nextTest.kind]}: </span>
            {nextTest.ask}
          </span>
        </p>
      )}
    </section>
  );
}
