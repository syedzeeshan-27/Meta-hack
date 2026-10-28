// What the watcher has seen, per session, kept in server memory for the last ~10 minutes.
// Fine for a single dev server or demo; it resets when the server restarts.
import type { MemoryEntry } from "./live-types";

const KEEP_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 300;
const timelines = new Map<string, MemoryEntry[]>();

export function remember(sessionId: string, entry: MemoryEntry): void {
  const list = timelines.get(sessionId) ?? [];
  list.push(entry);
  const cutoff = Date.now() - KEEP_MS;
  const kept = list.filter((e) => e.t >= cutoff).slice(-MAX_ENTRIES);
  timelines.set(sessionId, kept);
}

export function recent(sessionId: string, n = 5): MemoryEntry[] {
  return (timelines.get(sessionId) ?? []).slice(-n);
}

/** Entries whose caption or objects share words with the query, best first, then most recent. */
export function recall(sessionId: string, query: string, n = 6): MemoryEntry[] {
  const words = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
  const scored = (timelines.get(sessionId) ?? []).map((e) => {
    const text = `${e.caption} ${e.objects.join(" ")}`.toLowerCase();
    let score = 0;
    for (const w of words) if (text.includes(w)) score++;
    return { e, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.e.t - a.e.t);
  return (hits.length ? hits : scored.slice(-n)).slice(0, n).map((s) => s.e);
}
