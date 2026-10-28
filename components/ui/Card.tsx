import type { ComponentProps, ReactNode } from "react";

/** The paper surface used for every grouped block on document screens. */
export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className ?? ""}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold leading-snug">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Centred single column for document screens (home, report). */
export function Page({ className, children, wide }: { className?: string; children: ReactNode; wide?: boolean }) {
  return (
    <main
      className={`mx-auto w-full ${wide ? "max-w-3xl" : "max-w-[680px]"} px-4 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 ${
        className ?? ""
      }`}
    >
      {children}
    </main>
  );
}
