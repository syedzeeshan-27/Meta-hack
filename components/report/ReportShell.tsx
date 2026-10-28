import type { ReactNode } from "react";

// Colour tokens for the report, set once here: light, dark and print. Components use
// bg-(--card), text-(color:--muted), border-(--line) etc., so a later redesign changes one place.
// Print forces black-on-white whatever the screen theme is.
const THEME = [
  "[--paper:var(--color-stone-50)] [--card:var(--color-white)] [--ink:var(--color-stone-900)]",
  "[--muted:var(--color-stone-600)] [--line:var(--color-stone-200)] [--link:var(--color-blue-700)]",
  "[--new:var(--color-red-700)] [--new-soft:var(--color-red-50)]",
  "[--old:var(--color-amber-700)] [--old-soft:var(--color-amber-50)]",
  "[--ok:var(--color-emerald-700)] [--ok-soft:var(--color-emerald-50)]",
  "dark:[--paper:var(--color-stone-950)] dark:[--card:var(--color-stone-900)] dark:[--ink:var(--color-stone-100)]",
  "dark:[--muted:var(--color-stone-400)] dark:[--line:var(--color-stone-800)] dark:[--link:var(--color-blue-300)]",
  "dark:[--new:var(--color-red-400)] dark:[--new-soft:var(--color-red-950)]",
  "dark:[--old:var(--color-amber-400)] dark:[--old-soft:var(--color-amber-950)]",
  "dark:[--ok:var(--color-emerald-400)] dark:[--ok-soft:var(--color-emerald-950)]",
  "print:[--paper:#fff] print:[--card:#fff] print:[--ink:#000] print:[--muted:var(--color-stone-700)]",
  "print:[--line:var(--color-stone-300)] print:[--link:#000] print:[--new:var(--color-red-800)]",
  "print:[--new-soft:#fff] print:[--old:var(--color-amber-800)] print:[--old-soft:#fff]",
  "print:[--ok:var(--color-emerald-800)] print:[--ok-soft:#fff]",
  // The root layout paints the body black for the camera app; the report is a light document.
  "[body:has(&)]:bg-stone-50 dark:[body:has(&)]:bg-stone-950 print:[body:has(&)]:bg-white",
  "[:root:has(&)]:[color-scheme:light_dark] print:[:root:has(&)]:[color-scheme:light]",
].join(" ");

export function ReportShell({ children }: { children: ReactNode }) {
  return (
    <div data-report className={`${THEME} min-h-dvh bg-(--paper) text-(color:--ink) print:min-h-0`}>
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10 print:max-w-none print:px-0 print:pt-0 print:pb-0">
        {children}
      </div>
    </div>
  );
}

/** Full-width message for the not-found / waiting states. */
export function StatusPanel({
  title,
  children,
  busy = false,
}: {
  title: string;
  children?: ReactNode;
  busy?: boolean;
}) {
  return (
    <section className="mt-10 rounded-2xl border border-(--line) bg-(--card) p-6 sm:p-8" aria-live="polite">
      <div className="flex items-center gap-3">
        {busy && (
          <span
            aria-hidden
            className="size-5 shrink-0 animate-spin rounded-full border-2 border-(--line) border-t-(--ink) motion-reduce:animate-none"
          />
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children && <div className="mt-3 space-y-2 text-lg leading-relaxed text-(color:--muted)">{children}</div>}
    </section>
  );
}
