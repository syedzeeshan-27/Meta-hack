// Homework for one repair: Muse Spark searches the web for this exact model's fix, the spare part's
// price, a new one's price (and repair shops when it's not a DIY job).
// Sources are decided in code, not by the model: only URLs the search tool actually returned are kept,
// prices are dropped unless something was found, and the "where this came from" label is set here.
import type OpenAI from "openai";
import { meta, MODELS } from "../meta";
import type { Money, Research, ResearchRequest, Source } from "./types";

const MAX_SOURCES = 6;
const MAX_PLAUSIBLE_INR = 2_000_000;

export async function research(q: ResearchRequest): Promise<Research> {
  const started = Date.now();
  const place = q.city.trim() || "India";
  const name = [q.object.brand, q.object.name, q.object.model].filter(Boolean).join(" ");
  const shop = q.path === "shop";

  const res = (await meta().responses.create({
    model: MODELS.spark,
    tools: [{ type: "web_search", search_context_size: "low" }],
    include: ["web_search_call.action.sources"],
    reasoning: { effort: "low" },
    // Reasoning tokens count against this budget, so keep it generous.
    max_output_tokens: 4000,
    input:
      `Device: ${name}\n` +
      (q.complaint ? `Problem: ${q.complaint}\n` : "") +
      `Most likely cause: ${q.cause}\nThe owner is in ${place}.\n\n` +
      "Search the web and find:\n" +
      `1. ${shop ? "Repair shops or service centres for this device in or near " + place + "." : "How people fix this exact problem on this device (a how-to, teardown or forum fix)."}\n` +
      "2. The spare part needed, and what it costs in India now (online stores or local shops), in rupees.\n" +
      "3. What this device costs new in India now, in rupees.\n" +
      "Prefer pages about this exact model. If you only find pages for similar devices, say so.\n\n" +
      'Reply with ONLY a JSON object: {"exact_model": true, "howto": "one or two plain sentences on how the fix is done", ' +
      '"part": "the part\'s name, or empty", "part_low": 0, "part_high": 0, "new_low": 0, "new_high": 0, "weight_kg": 0, ' +
      '"shops": ["URLs of repair shop or service centre pages"], "sources": ["the URLs your answer came from"]}. ' +
      "Prices are whole rupees, 0 when you found nothing. weight_kg is the device's rough weight.",
  })) as OpenAI.Responses.Response;

  const searched = collectSources(res);
  const j = parseJson(res.output_text ?? "");
  const byKey = new Map(searched.map((s) => [normUrl(s.url), s]));
  // Links the model names count only if the search really returned them.
  const real = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .filter((u): u is string => typeof u === "string")
      .map((u) => byKey.get(normUrl(u)))
      .filter((s): s is Source => !!s);

  const named = real(j?.sources);
  const sources = dedupe([...named, ...searched]).slice(0, MAX_SOURCES);
  const shops = dedupe(real(j?.shops)).slice(0, 4);
  const found = sources.length > 0;

  const partName = str(j?.part);
  const partPrice = found ? money(j?.part_low, j?.part_high) : undefined;
  const newPrice = found ? money(j?.new_low, j?.new_high) : undefined;
  const weight = Number(j?.weight_kg);

  return {
    basis: !found ? "general" : j?.exact_model === true && q.object.model ? "model" : "similar",
    ...(partName && { part: { name: partName, ...(partPrice && { price: partPrice }) } }),
    ...(newPrice && { newPrice }),
    ...(str(j?.howto) && { howto: str(j?.howto) }),
    ...(Number.isFinite(weight) && weight > 0 && weight < 200 && { weightKg: Math.round(weight * 10) / 10 }),
    shops,
    sources,
    ms: Date.now() - started,
  };
}

// ---------- helpers ----------

function sourceOf(url: string, title?: string): Source {
  if (title?.trim()) return { title: title.trim(), url };
  try {
    return { title: new URL(url).hostname.replace(/^www\.|^m\./, ""), url };
  } catch {
    return { title: url, url };
  }
}

const normUrl = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
const dedupe = (list: Source[]) => [...new Map(list.map((s) => [normUrl(s.url), s])).values()];
const str = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

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

function money(lowRaw: unknown, highRaw: unknown): Money | undefined {
  let low = rupees(lowRaw);
  let high = rupees(highRaw);
  if (!Number.isFinite(low) || low <= 0) low = high;
  if (!Number.isFinite(high) || high <= 0) high = low;
  if (!(high > 0) || !(low > 0) || high > MAX_PLAUSIBLE_INR) return undefined;
  if (high < low) [low, high] = [high, low];
  return { low, high, currency: "INR" };
}

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
