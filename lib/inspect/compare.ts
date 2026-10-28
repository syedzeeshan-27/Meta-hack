// Move-out vs move-in: for each defect flagged at move-out, Muse Spark looks at that photo next to the most
// likely move-in photos of the same spot and decides new / pre_existing / wear. New damage then gets a local
// repair cost from the web (costs.ts). Room matching, candidate choice, dedupe and missing items are plain code.
import { WATCHER_LABEL } from "../fireworks";
import { MODELS, spark, type SparkContent } from "../meta";
import { photoDataUrl } from "../store";
import { estimateRepair, type RepairEstimate, type RepairQuery } from "./costs";
import { mapLimit } from "./index-frame";
import type { Comparison, Defect, Finding, Frame, Inspection, Money, Room, Severity } from "./types";

const MAX_CANDIDATES = 4;
const JUDGE_CONCURRENCY = 3;
type Effort = "minimal" | "low" | "medium" | "high";
const COMPARE_EFFORT: Effort = (["minimal", "low", "medium", "high"] as const).includes(process.env.COMPARE_EFFORT as Effort)
  ? (process.env.COMPARE_EFFORT as Effort)
  : "low";

// ---------- words ----------

const STOP = new Set(
  "a an the on in of at near by with to from and or into onto some small large big tiny minor visible area side spot part piece"
    .split(" "),
);
const COLOURS = new Set("black white brown yellow grey gray red green blue dark light orange pink beige".split(" "));

/** Crude stemmer: enough to match "cracked"/"crack", "peeling"/"peel", "chipped"/"chip", "holes"/"hole". */
export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (/(ch|sh|x|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 3 && /([b-df-hj-km-np-rtv-xy])\1$/.test(s)) s = s.slice(0, -1); // chipp → chip (keeps ll, ss, ff, zz)
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

const DAMAGE = new Set(
  (
    "crack stain hole peel flake scratch chip dent burn burnt scorch mark broken break miss missing damp water seepage leak " +
    "rust tear torn rip mould mold mildew scuff scribble crayon pen loose bent shatter smash graffiti discolour discolor dirt " +
    "dirty damage fade warp swollen gouge split crumble bulge cut"
  )
    .split(" ")
    .map(stem),
);

export function tokens(s: string): string[] {
  return [
    ...new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1 && !STOP.has(w))
        .map(stem),
    ),
  ];
}

function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

/** Same kind of damage on the same kind of thing: "crack" ~ "crack on wall", but not "crack on ceiling" ~ "crack on wall". */
export function similarPhrase(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (jaccard(ta, tb) >= 0.5) return true;
  const da = ta.filter((w) => DAMAGE.has(w));
  const db = new Set(tb.filter((w) => DAMAGE.has(w)));
  if (!da.some((w) => db.has(w))) return false;
  const oa = ta.filter((w) => !DAMAGE.has(w) && !COLOURS.has(w));
  const ob = new Set(tb.filter((w) => !DAMAGE.has(w) && !COLOURS.has(w)));
  return !oa.length || !ob.size || oa.some((w) => ob.has(w));
}

const itemTokens = (f: Frame) => f.items.flatMap(tokens);
const roomKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const SEV_RANK: Record<Severity, number> = { minor: 0, moderate: 1, major: 2 };

/** Share of the frame covered by the defect's outlines (union box). 0 when it has no outline. */
function outlineShare(d: Defect | undefined): number {
  const o = d?.outline;
  if (!o?.outlines.length || !o.width || !o.height) return 0;
  const l = Math.min(...o.outlines.map((x) => x.box.left));
  const t = Math.min(...o.outlines.map((x) => x.box.top));
  const r = Math.max(...o.outlines.map((x) => x.box.right));
  const b = Math.max(...o.outlines.map((x) => x.box.bottom));
  return (Math.max(0, r - l) * Math.max(0, b - t)) / (o.width * o.height);
}

/** "around the left-middle of the photo (x 10–30%, y 40–60%)" from the SAM outline, for the judge. */
function whereIn(d: Defect): string {
  const o = d.outline;
  if (!o?.outlines.length || !o.width || !o.height) return "";
  const pct = (v: number, of: number) => Math.round((100 * v) / of);
  const l = pct(Math.min(...o.outlines.map((x) => x.box.left)), o.width);
  const r = pct(Math.max(...o.outlines.map((x) => x.box.right)), o.width);
  const t = pct(Math.min(...o.outlines.map((x) => x.box.top)), o.height);
  const b = pct(Math.max(...o.outlines.map((x) => x.box.bottom)), o.height);
  const cx = (l + r) / 2;
  const cy = (t + b) / 2;
  const h = cx < 33 ? "left" : cx > 67 ? "right" : "centre";
  const v = cy < 33 ? "top" : cy > 67 ? "bottom" : "middle";
  return `; outlined around the ${v}-${h} of the photo (x ${l}-${r}%, y ${t}-${b}%)`;
}

// ---------- the judge (Muse Spark, images) ----------

export type Verdict = {
  defectId: string;
  status: "new" | "pre_existing" | "wear" | "not_damage";
  /** 1-based index into the candidates, 0 = no BEFORE photo shows the spot. */
  before: number;
  beforeDefectId: string;
  severity: Severity;
  summary: string;
};
export type Candidate = { frame: Frame; room: string; image: string };
export type JudgeInput = {
  room: string;
  after: { frame: Frame; image: string };
  candidates: Candidate[];
  notes: { moveIn: string[]; moveOut: string[] };
};
export type JudgeFn = (input: JudgeInput) => Promise<Verdict[]>;
export type EstimateFn = (q: RepairQuery, city: string) => Promise<RepairEstimate>;

const JUDGE_SYSTEM = `You check a rented flat at move-out against the same flat at move-in, so that a tenant in India is
charged only for damage they caused. Be fair to both sides.
You get one AFTER photo (move-out) with damage flagged on it, up to ${MAX_CANDIDATES} BEFORE photos (move-in) picked as the
likeliest views of the same spots, what was recorded on those BEFORE photos, and any notes spoken during the walkthroughs.

For EVERY flagged defect id decide a status:
- "pre_existing": the same damage at the same spot is visible in a BEFORE photo (angle and lighting may differ).
  before = that photo's number; before_defect_id = the matching recorded id if one fits, else "".
- "wear": normal wear and tear from ordinary living, which a landlord should not charge for: light scuffs, slightly
  faded or marked paint, small nail or pin holes from hanging pictures, light floor wear, fittings slightly loose with age.
  If it was already visible at move-in, use "pre_existing" instead.
- "new": damage beyond normal wear that is not at that spot in the BEFORE photos. If a BEFORE photo shows the same spot
  undamaged, before = its number. If no BEFORE photo shows that spot at all, before = 0 and say in the summary that
  the spot wasn't captured at move-in.
- "not_damage": the flag is wrong (a shadow, reflection, marble or stone veins, tile joints, an object, dust).
Match spots by their surroundings (the same wall, window, switchboard, tile pattern, furniture), not by framing.
Don't call something new just because it is sharper or better lit now. Spoken notes are claims, not proof: the photos decide.
severity: "minor" (small, cosmetic), "moderate" (clearly visible, needs a repair visit), "major" (broken, unsafe, large).
summary: one or two plain sentences for a report both landlord and tenant will read: what it is, where, and how it
compares with move-in. No photo numbers or ids in the summary.`;

const VERDICT_SCHEMA = {
  name: "verdicts",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["defect_id", "status", "before", "before_defect_id", "severity", "summary"],
          properties: {
            defect_id: { type: "string" },
            status: { type: "string", enum: ["new", "pre_existing", "wear", "not_damage"] },
            before: { type: "integer" },
            before_defect_id: { type: "string" },
            severity: { type: "string", enum: ["minor", "moderate", "major"] },
            summary: { type: "string" },
          },
        },
      },
    },
  },
};

type RawVerdict = {
  defect_id: string;
  status: Verdict["status"];
  before: number;
  before_defect_id: string;
  severity: Severity;
  summary: string;
};

const recorded = (f: Frame) =>
  f.defects.length
    ? f.defects.map((d) => `[${d.id}] "${d.phrase}": ${d.description}`).join("; ")
    : "no damage recorded";

export const judgeWithSpark: JudgeFn = async ({ room, after, candidates, notes }) => {
  const content: SparkContent[] = [
    { type: "text", text: `AFTER photo (move-out), room "${room}":` },
    { type: "image_url", image_url: { url: after.image } },
    {
      type: "text",
      text:
        "Flagged on the AFTER photo:\n" +
        after.frame.defects
          .map((d) => `- id ${d.id}: "${d.phrase}": ${d.description} (${d.severity})${whereIn(d)}`)
          .join("\n"),
    },
  ];
  candidates.forEach((c, i) => {
    content.push(
      { type: "text", text: `BEFORE photo ${i + 1} (move-in, room "${c.room}"). Recorded on it at move-in: ${recorded(c.frame)}.` },
      { type: "image_url", image_url: { url: c.image } },
    );
  });
  if (!candidates.length) content.push({ type: "text", text: "There are NO move-in photos to compare with." });
  const noteLines = [
    ...notes.moveIn.map((n) => `- at move-in: "${n}"`),
    ...notes.moveOut.map((n) => `- at move-out: "${n}"`),
  ];
  content.push({
    type: "text",
    text:
      (noteLines.length ? `Notes spoken in this room:\n${noteLines.join("\n")}\n` : "") +
      `Give a verdict for every flagged id (${after.frame.defects.map((d) => d.id).join(", ")}).`,
  });

  const out = await spark<{ verdicts: RawVerdict[] }>(
    [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content },
    ],
    { schema: VERDICT_SCHEMA, effort: COMPARE_EFFORT, maxTokens: 4000 },
  );
  return (out.verdicts ?? []).map((v) => ({
    defectId: v.defect_id,
    status: v.status,
    before: Number.isInteger(v.before) ? v.before : 0,
    beforeDefectId: v.before_defect_id ?? "",
    severity: v.severity,
    summary: (v.summary ?? "").trim(),
  }));
};

// ---------- candidate choice ----------

/** Likeliest move-in views of the same spot: item overlap, plus a bonus for a similar defect recorded there. */
export function pickCandidates(after: Frame, pool: Frame[], max = MAX_CANDIDATES): Frame[] {
  if (pool.length <= max) return pool;
  const mine = itemTokens(after);
  const scored = pool.map((f, i) => {
    const similar = f.defects.filter((d) => after.defects.some((a) => similarPhrase(a.phrase, d.phrase))).length;
    return { f, i, score: jaccard(mine, itemTokens(f)) + 0.25 * Math.min(2, similar) };
  });
  const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, max);
  if (ranked.length < max) {
    // Not enough overlap to go on: fill with frames spread evenly through the room's walkthrough.
    const rest = scored.filter((s) => !ranked.includes(s));
    const need = max - ranked.length;
    for (let k = 0; k < need && rest.length; k++) ranked.push(rest[Math.floor(((k + 0.5) * rest.length) / need)]);
  }
  return [...new Set(ranked.map((s) => s.f))];
}

const sameDefects = (a: Frame, b: Frame) =>
  a.defects.every((d) => b.defects.some((e) => similarPhrase(d.phrase, e.phrase))) &&
  b.defects.every((d) => a.defects.some((e) => similarPhrase(d.phrase, e.phrase)));
const clarity = (f: Frame) => f.defects.reduce((s, d) => s + outlineShare(d) + (d.outline ? 1 : 0), 0);

/** Near-identical views (same items, same defects) are judged once, using the clearest one. */
export function distinctViews(frames: Frame[]): Frame[] {
  const views: Frame[] = [];
  for (const f of [...frames].sort((a, b) => a.t - b.t)) {
    const i = views.findIndex((v) => jaccard(itemTokens(v), itemTokens(f)) >= 0.5 && sameDefects(v, f));
    if (i < 0) views.push(f);
    else if (clarity(f) > clarity(views[i])) views[i] = f;
  }
  return views;
}

// ---------- missing items ----------

function itemPresent(item: string, seen: string[][]): boolean {
  const t = tokens(item);
  if (!t.length) return true;
  return seen.some((s) => s.length && (t.every((w) => s.includes(w)) || s.every((w) => t.includes(w))));
}

/** Items in ≥2 move-in frames of a room that no move-out frame of that room shows. Rooms not walked at move-out are skipped. */
export function findMissingItems(moveOut: Inspection, moveIn: Inspection): { room: string; item: string }[] {
  const out: { room: string; item: string }[] = [];
  for (const before of moveIn.rooms) {
    const after = moveOut.rooms.find((r) => roomKey(r.name) === roomKey(before.name));
    const afterFrames = after?.frames.filter((f) => f.status === "indexed") ?? [];
    if (!afterFrames.length) continue;
    const seen = afterFrames.flatMap((f) => f.items.map(tokens));
    const counts = new Map<string, { item: string; n: number }>();
    for (const f of before.frames) {
      if (f.status !== "indexed") continue;
      for (const item of new Set(f.items.map((i) => i.trim().toLowerCase()))) {
        const key = tokens(item).sort().join(" ");
        if (!key) continue;
        const c = counts.get(key) ?? { item, n: 0 };
        c.n++;
        counts.set(key, c);
      }
    }
    for (const { item, n } of counts.values()) if (n >= 2 && !itemPresent(item, seen)) out.push({ room: after!.name, item });
  }
  return out;
}

// ---------- the whole comparison ----------

type Draft = Finding & { phrase: string; share: number };

const notesOf = (r: Room | undefined) => (r?.notes ?? []).slice(-6).map((n) => n.text.replace(/\s+/g, " ").slice(0, 240));

export async function buildComparison(
  moveOut: Inspection,
  moveIn: Inspection,
  opts: { judge?: JudgeFn; estimate?: EstimateFn; loadImage?: (url: string) => Promise<string> } = {},
): Promise<Comparison> {
  const started = Date.now();
  const judge = opts.judge ?? judgeWithSpark;
  const estimate = opts.estimate ?? estimateRepair;
  const imageCache = new Map<string, Promise<string>>();
  const load = (url: string) => {
    if (!imageCache.has(url)) imageCache.set(url, (opts.loadImage ?? photoDataUrl)(url));
    return imageCache.get(url)!;
  };

  const moveInRooms = new Map(moveIn.rooms.map((r) => [roomKey(r.name), r]));
  const allMoveIn = moveIn.rooms.flatMap((r) => r.frames.map((frame) => ({ frame, room: r.name })));
  const roomOfMoveIn = new Map(allMoveIn.map((c) => [c.frame.id, c.room]));

  // One judging unit per distinct move-out view that has defects.
  const units = moveOut.rooms.flatMap((room) => {
    const match = moveInRooms.get(roomKey(room.name));
    const pool = match?.frames.length ? match.frames : allMoveIn.map((c) => c.frame);
    const withDefects = room.frames.filter((f) => f.status === "indexed" && f.defects.length);
    return distinctViews(withDefects).map((frame) => ({ room, match, frame, pool }));
  });

  const drafts = (
    await mapLimit(units, JUDGE_CONCURRENCY, async ({ room, match, frame, pool }): Promise<Draft[]> => {
      const picked = pickCandidates(frame, pool);
      let verdicts: Verdict[] | undefined;
      for (let attempt = 0; attempt < 2 && !verdicts; attempt++) {
        try {
          const [afterImage, ...images] = await Promise.all([frame.imageUrl, ...picked.map((f) => f.imageUrl)].map(load));
          verdicts = await judge({
            room: room.name,
            after: { frame, image: afterImage },
            candidates: picked.map((f, i) => ({ frame: f, room: roomOfMoveIn.get(f.id) ?? room.name, image: images[i] })),
            notes: { moveIn: notesOf(match), moveOut: notesOf(room) },
          });
        } catch (err) {
          console.warn(`[inspect] judge ${frame.id} attempt ${attempt + 1} failed: ${String(err).slice(0, 200)}`);
        }
      }
      return frame.defects.flatMap((d): Draft[] => {
        const v = verdicts?.find((x) => x.defectId === d.id);
        if (v?.status === "not_damage") return [];
        const beforeFrame = v && v.before >= 1 ? picked[v.before - 1] : undefined;
        const beforeDefect = beforeFrame?.defects.find((x) => x.id === v?.beforeDefectId);
        return [
          {
            room: room.name,
            status: v?.status ?? "new",
            summary:
              v?.summary ||
              `${d.description} (Couldn't be checked against the move-in photos automatically; compare them by eye.)`,
            severity: v?.severity ?? d.severity,
            ...(beforeFrame && { before: { frameId: beforeFrame.id, ...(beforeDefect && { defectId: beforeDefect.id }) } }),
            after: { frameId: frame.id, defectId: d.id },
            phrase: d.phrase,
            share: outlineShare(d),
          },
        ];
      });
    })
  ).flat();

  // The same defect seen from several move-out frames → one finding, keeping the clearest (largest) outline.
  const groups: Draft[][] = [];
  for (const d of drafts) {
    const g = groups.find(
      (x) => roomKey(x[0].room) === roomKey(d.room) && x[0].status === d.status && similarPhrase(x[0].phrase, d.phrase),
    );
    if (g) g.push(d);
    else groups.push([d]);
  }
  const findings: (Finding & { phrase: string })[] = groups.map((g) => {
    const best = [...g].sort((a, b) => b.share - a.share || SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
    const before = best.before ?? g.find((x) => x.before)?.before;
    const { share: _share, ...rest } = best;
    void _share;
    return { ...rest, ...(before && { before }) };
  });

  // Repair cost for each new finding; findings that look alike share one web lookup.
  const fresh = findings.filter((f) => f.status === "new");
  const lookups = new Map<string, { q: RepairQuery; findings: typeof fresh }>();
  for (const f of fresh) {
    const key = `${tokens(f.phrase).sort().join(" ")}|${f.severity}`;
    const entry = lookups.get(key) ?? { q: { room: f.room, phrase: f.phrase, summary: f.summary, severity: f.severity }, findings: [] };
    entry.findings.push(f);
    lookups.set(key, entry);
  }
  await mapLimit([...lookups.values()], 3, async ({ q, findings: same }) => {
    try {
      const est = await estimate(q, moveOut.city);
      for (const f of same) {
        if (est.repair) f.repair = est.repair;
        if (est.cost) f.cost = est.cost;
      }
    } catch (err) {
      console.warn(`[inspect] cost lookup "${q.phrase}" failed: ${String(err).slice(0, 200)}`);
    }
  });

  const total: Money = { low: 0, high: 0, currency: "INR" };
  for (const f of fresh) {
    if (!f.cost) continue;
    total.low += f.cost.low;
    total.high += f.cost.high;
  }

  const order = { new: 0, wear: 1, pre_existing: 2 } as const;
  const sorted: Finding[] = findings
    .sort((a, b) => order[a.status] - order[b.status] || SEV_RANK[b.severity] - SEV_RANK[a.severity])
    .map(({ phrase: _phrase, ...f }) => {
      void _phrase;
      return f;
    });

  const indexers = [
    ...new Set([...moveIn.rooms, ...moveOut.rooms].flatMap((r) => r.frames.map((f) => f.indexedBy)).filter(Boolean)),
  ] as string[];
  const models = [
    ...(indexers.length ? indexers : [WATCHER_LABEL]).map((l) => `${l} (indexing)`),
    "sam-3.1 (defect outlines)",
    `${MODELS.spark} (comparison${lookups.size ? ", web search for repair costs" : ""})`,
  ];

  console.log(
    `[inspect] comparison ${moveOut.id}: ${units.length} views judged, ${sorted.length} findings ` +
      `(${fresh.length} new), ${lookups.size} cost lookups, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  return {
    inspectionId: moveOut.id,
    baselineId: moveIn.id,
    createdAt: Date.now(),
    findings: sorted,
    missingItems: findMissingItems(moveOut, moveIn),
    total,
    models,
  };
}
