import { Chip } from "@/components/ui/Chip";
import type { Severity } from "@/lib/inspect/types";

const LABEL: Record<Severity, string> = { minor: "Minor", moderate: "Moderate", major: "Major" };
const DOTS: Record<Severity, number> = { minor: 1, moderate: 2, major: 3 };

/** Severity as a word plus 1–3 filled dots, so it reads without colour (and in black-and-white print). */
export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <Chip
      icon={
        <span aria-hidden className="flex gap-0.5">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`size-1.5 rounded-full ${n <= DOTS[severity] ? "bg-ink" : "bg-ink/20"}`} />
          ))}
        </span>
      }
    >
      {LABEL[severity]}
      <span className="sr-only"> severity</span>
    </Chip>
  );
}
