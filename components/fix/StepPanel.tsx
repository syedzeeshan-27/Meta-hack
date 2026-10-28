import type { Gate, Guide } from "@/lib/types";
import { ChevronLeftIcon, ChevronRightIcon, IconButton, ShieldIcon } from "@/components/ui";

/** The repair step on screen: safety checkpoints look different and can't be skipped (the guide enforces it). */
export function StepPanel({
  guide,
  stepIndex,
  gatesPassed,
  onGo,
}: {
  guide: Guide;
  stepIndex: number;
  gatesPassed: Gate[];
  onGo: (i: number) => void;
}) {
  const step = guide.steps[stepIndex];
  if (!step) return null;
  const gate = step.gate && !gatesPassed.includes(step.gate);
  const total = guide.steps.length;

  return (
    <section
      aria-label="Repair step"
      className={`anim-fade rounded-2xl p-3 backdrop-blur ${gate ? "bg-cam-existing/25 ring-1 ring-cam-existing/60" : "bg-black/70"}`}
    >
      <div className="flex items-center gap-2">
        {gate ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-cam-existing">
            <ShieldIcon className="size-4" /> Safety check
          </span>
        ) : (
          <span className="text-xs font-semibold uppercase tracking-wider text-cam-info">
            Step {stepIndex + 1} of {total}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-white/60">{guide.product}</span>
        <IconButton onDark size={40} label="Previous step" disabled={stepIndex === 0} onClick={() => onGo(stepIndex - 1)}>
          <ChevronLeftIcon />
        </IconButton>
        <IconButton onDark size={40} label="Next step" disabled={stepIndex >= total - 1} onClick={() => onGo(stepIndex + 1)}>
          <ChevronRightIcon />
        </IconButton>
      </div>
      <p className="mt-1 text-lg leading-snug">{step.instruction}</p>
      <div className="mt-2.5 flex gap-1" aria-hidden>
        {guide.steps.map((s, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < stepIndex ? "bg-cam-ok" : i === stepIndex ? (s.gate ? "bg-cam-existing" : "bg-cam-info") : "bg-white/20"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
