import type { Money } from "@/lib/inspect/types";

/** "12 Oct", or "12 Oct 2025" when it isn't this year. */
export function formatDay(t: number): string {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "₹1,500" (Indian digit grouping, no paise). */
export function formatMoney(n: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${formatNumber(n)}`;
  }
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

/** "₹1,500–4,000", or "₹1,500" when both ends match. */
export function formatRange({ low, high, currency }: Money): string {
  const lo = Math.round(low);
  const hi = Math.round(high);
  if (hi <= lo) return formatMoney(lo, currency);
  return `${formatMoney(lo, currency)}–${formatNumber(hi)}`;
}

/** plural(5, "room") → "5 rooms" */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
