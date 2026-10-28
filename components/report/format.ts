// Formatting for the report. Renters are in India: Indian digit grouping and IST times.
import type { Money } from "@/lib/inspect/types";

const IST = "Asia/Kolkata";

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-IN")}`;
  }
}

export function formatRange(m: Pick<Money, "low" | "high" | "currency">): string {
  if (m.low === m.high) return formatMoney(m.low, m.currency);
  return `${formatMoney(m.low, m.currency)} – ${formatMoney(m.high, m.currency)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: IST,
});

export const formatDate = (ms: number) => dateFmt.format(ms);
export const formatDateTime = (ms: number) => `${dateTimeFmt.format(ms)} IST`;

/** "www.urbancompany.com/..." -> "urbancompany.com" */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const shortHash = (hex: string) => (hex.length > 16 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
