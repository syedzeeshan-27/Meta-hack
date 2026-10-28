// Formatting for the report. Renters are in India: Indian digit grouping (₹1,50,000) and IST times.
import type { Money } from "@/lib/inspect/types";

const IST = "Asia/Kolkata";

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-IN")}`;
  }
}

/** "₹1,500–₹4,000" (no spaces, so it never breaks across lines in the middle). */
export function formatRange(m: Pick<Money, "low" | "high" | "currency">): string {
  if (m.low === m.high) return formatMoney(m.low, m.currency);
  return `${formatMoney(m.low, m.currency)}–${formatMoney(m.high, m.currency)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
const shortFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: IST,
});
const fullFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: IST,
});
const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: IST });

/** "12 Oct 2025" */
export const formatDate = (ms: number) => dateFmt.format(ms);
/** "12 Oct 2025, 10:31 am" */
export const formatShortDateTime = (ms: number) => shortFmt.format(ms);
/** "12 Oct 2025, 10:31:04 am IST", for the evidence list. */
export const formatDateTime = (ms: number) => `${fullFmt.format(ms)} IST`;

/** A walkthrough's time span: "12 Oct 2025, 10:30 am – 10:44 am IST". */
export function formatSpan(start: number, end?: number): string {
  if (!end) return `${shortFmt.format(start)} IST`;
  if (dayKey.format(start) === dayKey.format(end)) {
    return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)} IST`;
  }
  return `${shortFmt.format(start)} – ${shortFmt.format(end)} IST`;
}

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

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A sentence turned into a clause to follow a colon: "Small crack." -> "small crack" (acronyms left alone). */
export function clause(sentence: string): string {
  const t = sentence.trim().replace(/[.!]+$/, "");
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}
