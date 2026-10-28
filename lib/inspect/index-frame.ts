// Per-frame indexer for Deposit Guard: Meta's open-weight model (muse-spark-open on Fireworks) lists the
// fittings in view and any visible damage, then SAM 3.1 outlines each defect by its plain visual phrase.
// High volume (every keyframe of every walkthrough), so it runs on open weights via a partner host.
import { randomBytes } from "node:crypto";
import { fireworks, lowReasoningParams, WATCHER_LABEL, WATCHER_MODEL } from "../fireworks";
import { locatePart } from "../locate";
import type { Outline } from "../types";
import type { Defect, DefectOutline, Severity } from "./types";

// Reasoning tokens count against this budget (keep it well above 600).
const MAX_TOKENS = Number(process.env.INDEXER_MAX_TOKENS) || 1400;
const TEMPERATURE = 0.3;
const MAX_ITEMS = 12;
const MAX_DEFECTS = 6;
/** An "outline" covering most of the frame is the wall or floor itself, not a defect on it. */
const MAX_DEFECT_SHARE = 0.6;
const MAX_OUTLINES_PER_DEFECT = 4;

const SYSTEM = `You index one photo from a tenant's video walkthrough of a rented flat in India. The record protects
their security deposit: at move-out it is compared with move-in, so it must be accurate and conservative.
Reply with ONLY a JSON object, no other text:
{"items": ["..."], "defects": [{"phrase": "...", "description": "...", "severity": "minor"}]}

items: up to 12 fittings and furniture of the flat in view, plain everyday words, 1-3 words each
  ("ceiling fan", "switchboard", "window", "door", "wardrobe", "geyser", "tube light", "kitchen sink", "floor tiles",
  "bed", "curtains"). Skip people and personal belongings (bags, clothes, gadgets, food, papers, boxes).

defects: visible damage a landlord could charge for: cracks, holes, stains, damp or water damage, peeling or flaking
  paint, pen or crayon marks on walls, burn marks, broken or missing fittings (switch, socket, tap, handle, tile, glass),
  chipped or cracked tiles, deep scratches or dents on floors, doors or furniture, torn upholstery or curtains, rust,
  broken glass.
  Be conservative. Only damage you can clearly see. A normal clean wall, floor or fitting has NO defects, and an empty
  list is the usual answer. NOT damage: natural patterns (marble or granite veins, wood grain), tile joints and grout
  lines, shadows, reflections, glare, dust, motion blur, clutter, and anything on people or their belongings.
  phrase: 1-4 plain VISUAL words an image-segmentation model can find, naming the damage as it looks:
    "crack", "brown stain", "peeling paint", "hole in wall", "broken switch", "chipped tile", "scratch on floor",
    "pen marks". Never technical or cause words ("efflorescence", "seepage", "settlement crack", "MCB").
  description: one short sentence for an inspection report: what it is and where in the photo
    ("Brown water stain about 30 cm wide on the ceiling above the window.").
  severity: "minor" (small, cosmetic), "moderate" (clearly visible, needs a repair visit),
    "major" (broken, unsafe, or a large area).
  At most ${MAX_DEFECTS} defects; list the clearest ones.`;

export type IndexedDefect = Omit<Defect, "id" | "outline">;
export type IndexResult = {
  items: string[];
  defects: Defect[];
  indexedBy: string;
  /** total, the indexer model call(s), and the SAM outlining that follows */
  ms: number;
  modelMs: number;
  outlineMs: number;
};

export function shortId(len = 8): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789"; // no 0/o/1/l lookalikes
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function clampWords(s: string, n: number): string {
  const parts = s.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return parts.slice(0, n).join(" ");
}

const plainWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9 \-]/g, " ").replace(/\s+/g, " ").trim();

function severityOf(v: unknown): Severity {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("maj") || s === "high" || s === "severe") return "major";
  if (s.startsWith("mod") || s === "medium") return "moderate";
  return "minor";
}

/** The indexer's text → {items, defects}. Tolerates think tags, code fences and stray prose. Throws if no JSON. */
export function parseIndexReply(raw: string): { items: string[]; defects: IndexedDefect[] } {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`Indexer reply had no JSON: ${text.slice(0, 120) || "(empty)"}`);
  const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const items = [
    ...new Set(
      (Array.isArray(j.items) ? j.items : [])
        .filter((o): o is string => typeof o === "string")
        .map((o) => clampWords(plainWords(o), 4))
        .filter(Boolean),
    ),
  ].slice(0, MAX_ITEMS);

  const defects: IndexedDefect[] = [];
  for (const d of Array.isArray(j.defects) ? j.defects : []) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    const phrase = clampWords(plainWords(String(r.phrase ?? "")), 5);
    if (!phrase) continue;
    const description = clampWords(String(r.description ?? "").replace(/\s+/g, " "), 40) || `${phrase}.`;
    defects.push({ phrase, description, severity: severityOf(r.severity) });
    if (defects.length >= MAX_DEFECTS) break;
  }
  return { items, defects };
}

let jsonModeOk = process.env.WATCHER_JSON_MODE !== "0";

async function askIndexer(image: string, room?: string): Promise<string> {
  const body = {
    model: WATCHER_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [
      { role: "system" as const, content: SYSTEM },
      {
        role: "user" as const,
        content: [
          { type: "image_url" as const, image_url: { url: image } },
          { type: "text" as const, text: `${room ? `Room: ${room}. ` : ""}Index this photo. JSON only.` },
        ],
      },
    ],
    ...lowReasoningParams(),
  };
  type Body = Parameters<ReturnType<typeof fireworks>["chat"]["completions"]["create"]>[0] & { stream?: false };
  const call = (json: boolean) =>
    fireworks().chat.completions.create(
      { ...body, ...(json ? { response_format: { type: "json_object" as const } } : {}) } as Body,
      { timeout: 45_000 },
    );

  let completion;
  try {
    completion = await call(jsonModeOk);
  } catch (err) {
    // Some deployments reject JSON mode for vision or reasoning models; drop it once and remember.
    if (!jsonModeOk || !/response_format|json|grammar|structured/i.test(String(err))) throw err;
    jsonModeOk = false;
    completion = await call(false);
  }
  return completion.choices[0]?.message?.content ?? "";
}

const boxArea = (b: Outline["box"]) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

/** SAM outline for one defect phrase, or undefined when it can't be localised. Never throws. */
export async function outlineDefect(
  image: string,
  phrase: string,
  size: { width: number; height: number },
): Promise<DefectOutline | undefined> {
  try {
    const found = await locatePart(image, phrase, size);
    if (found.via === "none" || !found.outlines.length) return undefined;
    const width = found.width || size.width;
    const height = found.height || size.height;
    const outlines = found.outlines
      .filter((o) => boxArea(o.box) / (width * height) <= MAX_DEFECT_SHARE)
      .sort((a, b) => boxArea(b.box) - boxArea(a.box))
      .slice(0, MAX_OUTLINES_PER_DEFECT);
    return outlines.length ? { width, height, outlines, via: found.via } : undefined;
  } catch (err) {
    console.warn(`[inspect] outline "${phrase}" failed: ${String(err).slice(0, 200)}`);
    return undefined;
  }
}

/**
 * Index one walkthrough frame: items + defects from the open-weights model, then SAM outlines (≤3 at once).
 * `maxOutlined` caps how many defects get an outline (the rest keep outline undefined); used by the smoke test.
 */
export async function indexFrame(
  image: string,
  size: { width: number; height: number },
  opts: { room?: string; maxOutlined?: number } = {},
): Promise<IndexResult> {
  const started = Date.now();
  let parsed: { items: string[]; defects: IndexedDefect[] };
  try {
    parsed = parseIndexReply(await askIndexer(image, opts.room));
  } catch (err) {
    // One retry: timeouts, 5xx and an empty reply (reasoning ate the budget) are usually transient.
    console.warn(`[inspect] indexer retry after: ${String(err).slice(0, 200)}`);
    parsed = parseIndexReply(await askIndexer(image, opts.room));
  }

  const modelMs = Date.now() - started;

  const limit = opts.maxOutlined ?? Infinity;
  const defects = await mapLimit(parsed.defects, 3, async (d, i): Promise<Defect> => {
    const outline = i < limit ? await outlineDefect(image, d.phrase, size) : undefined;
    return { id: `d${shortId(6)}`, ...d, ...(outline && { outline }) };
  });

  const ms = Date.now() - started;
  return { items: parsed.items, defects, indexedBy: WATCHER_LABEL, ms, modelMs, outlineMs: ms - modelMs };
}
