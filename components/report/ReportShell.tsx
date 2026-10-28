import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/Button";
import { Card, Page } from "@/components/ui/Card";
import { AlertIcon, ShieldIcon } from "@/components/ui/icons";

// Paper is always light: A4 with the light-theme tokens, whatever the screen theme is. `html:root` outranks the
// dark-mode `:root` rule in globals.css. Colours are printed as shown (tags, outlines, the verdict panel).
const PRINT_CSS = `@page{size:A4;margin:14mm 14mm 16mm}
@media print{
html:root{color-scheme:light;--paper:#fff;--surface:#fff;--ink:#16171a;--muted:#4b5057;--line:#d6d3cd;--info:#0f766e;--existing:#b45309;--new:#c62828;--ok:#15803d}
[data-report]{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

/** The report's document column: 768px, centred; full width on paper. */
export function ReportShell({ children }: { children: ReactNode }) {
  return (
    <Page wide className="print:max-w-none print:px-0 print:pt-0 print:pb-0">
      <style href="deposit-report-print" precedence="default">
        {PRINT_CSS}
      </style>
      <div data-report>{children}</div>
    </Page>
  );
}

type PanelIcon = "busy" | "alert" | "info";

/** Not found / waiting / info states. Neutral on purpose: red and amber only ever mean damage. */
export function StatusPanel({
  title,
  icon = "info",
  action,
  children,
}: {
  title: string;
  icon?: PanelIcon;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink/5">
          {icon === "busy" ? <Spinner className="size-5" /> : icon === "alert" ? <AlertIcon /> : <ShieldIcon />}
        </span>
        <div className="min-w-0 flex-1 pt-1.5">
          <h2 className="text-xl leading-[26px] font-semibold">{title}</h2>
          {children && <div className="mt-1.5 space-y-2 leading-relaxed text-muted">{children}</div>}
          {action && <div className="mt-5">{action}</div>}
        </div>
      </div>
    </Card>
  );
}
