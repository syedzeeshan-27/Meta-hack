// Fair repair cost for one piece of new damage: Muse Spark searches the web for local prices in the tenant's city.
// Sources are decided in code, not by the model: only URLs the search tool actually returned (web_search_call
// sources or url_citation annotations) are kept, so a made-up link never reaches the report.
import type OpenAI from "openai";
import { meta, MODELS } from "../meta";
import type { Money, Severity } from "./types";

export type Source = { title: string; url: string };
export type RepairEstimate = {
  repair?: string;
  cost?: Money & { sources: Source[] };
  ms: number;
};
export type RepairQuery = { room: string; phrase: string; summary: string; severity: Severity };

const MAX_SOURCES = 5;
const MAX_PLAUSIBLE_INR = 1_000_000;

function sourceOf(url: string, title?: string): Source {
  if (title?.trim()) return { title: title.trim(), url };
  try {
    return { title: new URL(url).hostname.replace(/^www\.|^m\./, ""), url };
  } catch {
    return { title: url, url };
  }
}

const normUrl = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

function parseJson(text: string): Record<string, unknown> | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const rupees = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

/** Every URL the search actually returned, in order, with titles where an annotation gave one. */
export function collectSources(res: OpenAI.Responses.Response): Source[] {
  const found = new Map<string, Source>();
  for (const item of res.output ?? []) {
    if (item.type === "web_search_call") {
      const action = (item as OpenAI.Responses.ResponseFunctionWebSearch).action;
      if (action?.type === "search")
        for (const s of action.sources ?? []) if (s.url && !found.has(normUrl(s.url))) found.set(normUrl(s.url), sourceOf(s.url));
    }
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations ?? []) {
          if (a.type !== "url_citation") continue;
          const key = normUrl(a.url);
          // An annotation title beats a bare host name.
          if (!found.has(key) || (a.title && found.get(key)!.title === sourceOf(a.url).title)) found.set(key, sourceOf(a.url, a.title));
        }
      }
    }
  }
  return [...found.values()];
}

export async function estimateRepair(q: RepairQuery, city: string): Promise<RepairEstimate> {
  const started = Date.now();
  const place = city.trim() || "India";
  const res = (await meta().responses.create({
    model: MODELS.spark,
    tools: [{ type: "web_search", search_context_size: "low" }],
    include: ["web_search_call.action.sources"],
    reasoning: { effort: "low" },
    // Reasoning tokens count against this budget, so keep it generous.
    max_output_tokens: 3000,
    input:
      `A tenant is moving out of a rented flat in ${place}, India. This damage was found at move-out and wasn't there at move-in.\n` +
      `Room: ${q.room}\nDamage: ${q.summary} (${q.phrase}; severity ${q.severity})\n\n` +
      `Search the web for what a local handyman, painter, carpenter, plumber or electrician in ${place} charges now to repair ` +
      "exactly this, labour plus materials, in Indian rupees (home-service price lists such as Urban Company, local rate " +
      "cards, recent articles). Price this one repair at this size: a small patch is not a full-room repaint, one " +
      "broken switch is not rewiring.\n" +
      'Reply with ONLY a JSON object: {"repair": "one short sentence: what the repair person would do", ' +
      '"low": 0, "high": 0, "sources": ["the URLs your prices came from"]}. low and high are whole rupees.',
  })) as OpenAI.Responses.Response;

  const searched = collectSources(res);
  const j = parseJson(res.output_text ?? "");
  const repair = typeof j?.repair === "string" && j.repair.trim() ? j.repair.trim().replace(/\s+/g, " ") : undefined;
  let low = rupees(j?.low);
  let high = rupees(j?.high);
  if (Number.isFinite(low) && Number.isFinite(high) && high < low) [low, high] = [high, low];
  const plausible = Number.isFinite(low) && Number.isFinite(high) && high > 0 && low >= 0 && high <= MAX_PLAUSIBLE_INR;

  // Sources the model says it used come first, but only if the search really returned them.
  const searchedByKey = new Map(searched.map((s) => [normUrl(s.url), s]));
  const named = (Array.isArray(j?.sources) ? j!.sources : [])
    .filter((u): u is string => typeof u === "string")
    .map((u) => searchedByKey.get(normUrl(u)))
    .filter((s): s is Source => !!s);
  const sources = [...new Map([...named, ...searched].map((s) => [normUrl(s.url), s])).values()].slice(0, MAX_SOURCES);

  return {
    repair,
    ...(plausible && { cost: { low, high, currency: "INR", sources } }),
    ms: Date.now() - started,
  };
}
