import type { Severity } from "@/lib/inspect/types";

const LABEL: Record<Severity, string> = { minor: "Minor", moderate: "Moderate", major: "Major" };
const DOTS: Record<Severity, number> = { minor: 1, moderate: 2, major: 3 };

/** Severity as words plus 1–3 filled dots, so it reads without colour (and in black-and-white print). */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-(--line) px-2.5 py-0.5 text-sm font-medium whitespace-nowrap">
      <span aria-hidden className="flex gap-0.5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`size-1.5 rounded-full ${n <= DOTS[severity] ? "bg-(--ink)" : "bg-(--line)"} print:[print-color-adjust:exact]`}
          />
        ))}
      </span>
      {LABEL[severity]}
    </span>
  );
}
