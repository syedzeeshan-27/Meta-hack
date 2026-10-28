import type { Comparison, CreateInspectionRequest, Inspection, Money } from "@/lib/inspect/types";

export async function listInspections(): Promise<Inspection[]> {
  const res = await fetch("/api/inspections", { cache: "no-store" });
  const data = (await res.json().catch(() => null)) as Inspection[] | { error?: string } | null;
  if (!res.ok || !Array.isArray(data)) {
    throw new Error((data && !Array.isArray(data) && data.error) || `the server answered ${res.status}`);
  }
  return data;
}

export async function createInspection(body: CreateInspectionRequest): Promise<Inspection> {
  const res = await fetch("/api/inspections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<Inspection> & { error?: string };
  if (!res.ok || data.error || !data.id) throw new Error(data.error ?? `the server answered ${res.status}`);
  return data as Inspection;
}

export type ComparisonResult =
  | { state: "ready"; newCount: number; total: Money }
  | { state: "running" }
  | { state: "not_started" }
  | { state: "failed" }
  /** Couldn't reach the server or it answered something unexpected. */
  | { state: "error" };

export async function fetchComparison(id: string): Promise<ComparisonResult> {
  try {
    const res = await fetch(`/api/inspections/${encodeURIComponent(id)}/comparison`, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as (Comparison & { status?: string }) | null;
    if (res.ok && data && Array.isArray(data.findings)) {
      return {
        state: "ready",
        newCount: data.findings.filter((f) => f.status === "new").length,
        total: data.total ?? { low: 0, high: 0, currency: "INR" },
      };
    }
    if (data?.status === "running") return { state: "running" };
    if (data?.status === "not_started") return { state: "not_started" };
    if (data?.status === "failed") return { state: "failed" };
    return { state: "error" };
  } catch {
    return { state: "error" };
  }
}

export function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}
