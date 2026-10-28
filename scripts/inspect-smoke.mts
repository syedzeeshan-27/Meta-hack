// Smoke test for the Deposit Guard pipeline. Offline checks first (free), then at most ~5 real model calls:
// index one frame (1 indexer call + up to 3 for one outline: SAM, Spark pointing, SAM) and one cost lookup.
//
//   npx tsx --env-file=.env.local scripts/inspect-smoke.mts [photo.jpg] [--offline] [--no-cost] [--dump out.json]
import { readFile, writeFile } from "node:fs/promises";
import { WATCHER_LABEL, watcherConfigured } from "../lib/fireworks";
import { buildComparison, similarPhrase, type JudgeFn } from "../lib/inspect/compare";
import { estimateRepair } from "../lib/inspect/costs";
import { indexFrame, parseIndexReply } from "../lib/inspect/index-frame";
import { withLock } from "../lib/inspect/jobs";
import type { Defect, Frame, Inspection } from "../lib/inspect/types";

const DEFAULT_PHOTO =
  "C:\\Users\\SYEDZE~1\\AppData\\Local\\Temp\\claude\\C--Metahack\\70cee906-017b-4e46-a267-3711159f96f9\\scratchpad\\real_front.jpg";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? `  ${extra}` : ""}`);
};

// ---------- offline: parser ----------
const p1 = parseIndexReply(
  '<think>x</think>```json\n{"items":["Ceiling Fan","window","window","Switch-board!"],"defects":[{"phrase":"Crack on wall.","description":"Thin crack left of the window.","severity":"Moderate"},{"phrase":"","description":"x"}]}\n```',
);
check("parse: items cleaned + deduped", JSON.stringify(p1.items) === '["ceiling fan","window","switch-board"]', JSON.stringify(p1.items));
check("parse: empty phrase dropped, severity normalised", p1.defects.length === 1 && p1.defects[0].severity === "moderate" && p1.defects[0].phrase === "crack on wall");
let threw = false;
try {
  parseIndexReply("");
} catch {
  threw = true;
}
check("parse: empty reply throws (so the caller retries)", threw);

// ---------- offline: phrase matching ----------
const pairs: [string, string, boolean][] = [
  ["crack", "crack on wall", true],
  ["cracked wall", "crack on wall", true],
  ["crack on ceiling", "crack on wall", false],
  ["brown stain on wall", "stain on wall", true],
  ["peeling paint", "paint peeling off wall", true],
  ["broken switch", "broken socket", false],
  ["chipped tile", "chip in tile", true],
  ["hole in wall", "scratch on floor", false],
];
for (const [a, b, want] of pairs) check(`similar("${a}", "${b}") = ${want}`, similarPhrase(a, b) === want);

// ---------- offline: per-inspection lock (no lost updates) ----------
const shared = { n: 0 };
await Promise.all(
  Array.from({ length: 25 }, () =>
    withLock("lock-test", async () => {
      const seen = shared.n;
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      shared.n = seen + 1;
    }),
  ),
);
check("lock: 25 concurrent read-modify-writes all kept", shared.n === 25, `n=${shared.n}`);

// ---------- offline: comparison logic with a fake judge ----------
const box = (l: number, t: number, r: number, b: number) => ({
  width: 1000,
  height: 1000,
  via: "name" as const,
  outlines: [{ id: "1", box: { left: l, top: t, right: r, bottom: b }, path: "", transform: "" }],
});
const defect = (id: string, phrase: string, outline?: Defect["outline"]): Defect => ({
  id,
  phrase,
  description: `${phrase}.`,
  severity: "moderate",
  ...(outline && { outline }),
});
const frame = (id: string, t: number, items: string[], defects: Defect[] = []): Frame => ({
  id,
  t,
  imageUrl: `/api/files/photos/x/${id}.jpg`,
  sha256: "",
  width: 1000,
  height: 1000,
  items,
  defects,
  status: "indexed",
});
const moveIn: Inspection = {
  id: "in1",
  kind: "move_in",
  property: "Flat 302",
  city: "Bengaluru",
  createdAt: 1,
  rooms: [
    {
      name: "Bedroom",
      notes: [{ t: 1, text: "Crack near the window was already there." }],
      frames: [
        frame("i1", 1, ["window", "ceiling fan", "switchboard"], [defect("di1", "crack on wall")]),
        frame("i2", 2, ["window", "curtains", "switchboard"]),
        frame("i3", 3, ["wardrobe", "mirror"]),
        frame("i4", 4, ["wardrobe", "door"]),
        frame("i5", 5, ["bed", "door"]),
        frame("i6", 6, ["ceiling fan", "tube light", "switchboard"]),
      ],
    },
    { name: "Kitchen", notes: [], frames: [frame("k1", 7, ["kitchen sink", "tap"]), frame("k2", 8, ["kitchen sink", "tap", "chimney"])] },
  ],
};
const moveOut: Inspection = {
  id: "out1",
  kind: "move_out",
  baselineId: "in1",
  property: "Flat 302",
  city: "Bengaluru",
  createdAt: 2,
  rooms: [
    {
      name: "bedroom ", // case/space differences still match
      notes: [],
      frames: [
        frame("o1", 10, ["window", "ceiling fan", "switchboard"], [defect("do1", "crack on wall", box(100, 100, 200, 400)), defect("do2", "hole in wall")]),
        // the same view a second later, bigger outline: judged once, kept as the clearer view
        frame("o2", 11, ["window", "switchboard", "ceiling fan"], [defect("do3", "crack", box(100, 100, 300, 500)), defect("do4", "hole in wall")]),
        frame("o3", 12, ["wardrobe", "mirror"], [defect("do5", "shadow on wall")]),
        frame("o4", 13, ["bed", "door"], [defect("do6", "scratch on floor", box(0, 0, 50, 50))]),
        frame("o5", 14, ["bed", "door", "lamp"], [defect("do7", "scratch on floor", box(0, 0, 200, 200))]),
      ],
    },
    { name: "Kitchen", notes: [], frames: [frame("ko1", 15, ["kitchen sink"])] }, // the tap is gone
    { name: "Balcony", notes: [], frames: [frame("b1", 16, ["railing"], [defect("db1", "rust on railing")])] },
  ],
};
const judged: string[] = [];
const fakeJudge: JudgeFn = async ({ after, candidates, room }) => {
  judged.push(`${after.frame.id}<-[${candidates.map((c) => c.frame.id).join(",")}]@${room}`);
  return after.frame.defects.map((d) => ({
    defectId: d.id,
    status: d.phrase.includes("crack") ? "pre_existing" : d.phrase.includes("shadow") ? "not_damage" : "new",
    before: d.phrase.includes("crack") ? 1 : 0,
    beforeDefectId: d.phrase.includes("crack") ? "di1" : "",
    severity: "moderate",
    summary: `${d.phrase} (fake)`,
  }));
};
const comparison = await buildComparison(moveOut, moveIn, {
  judge: fakeJudge,
  estimate: async (q) => ({ repair: `fix ${q.phrase}`, cost: { low: 500, high: 1500, currency: "INR", sources: [] }, ms: 0 }),
  loadImage: async () => "",
});
console.log("  judged:", judged.join("  "));
const by = (phrase: string) => comparison.findings.filter((f) => f.summary.startsWith(phrase));
check("compare: same view judged once (o1/o2 → 1 call)", judged.filter((j) => /^o[12]</.test(j)).length === 1);
check("compare: o1 view picks i1 (item + defect overlap) first", /^o[12]<-\[i1,/.test(judged.find((j) => /^o[12]</.test(j)) ?? ""));
check("compare: unmatched room (Balcony) compares against all move-in frames", judged.some((j) => j.startsWith("b1<-") && j.split(",").length === 4));
check("compare: crack is pre_existing with before i1/di1", by("crack")[0]?.status === "pre_existing" && by("crack")[0]?.before?.frameId === "i1" && by("crack")[0]?.before?.defectId === "di1");
check("compare: not_damage dropped", by("shadow").length === 0);
check("compare: scratch seen in 2 frames → 1 finding, larger outline kept", by("scratch").length === 1 && by("scratch")[0].after.frameId === "o5");
check("compare: missing items = the kitchen tap only", JSON.stringify(comparison.missingItems) === JSON.stringify([{ room: "Kitchen", item: "tap" }]), JSON.stringify(comparison.missingItems));
const newCount = comparison.findings.filter((f) => f.status === "new").length;
check("compare: total = sum of new findings", comparison.total.low === 500 * newCount && comparison.total.high === 1500 * newCount, `${newCount} new, ${JSON.stringify(comparison.total)}`);
console.log("  models:", comparison.models.join(" | "));

if (process.argv.includes("--offline")) process.exit(failures ? 1 : 0);
if (!watcherConfigured() || !process.env.MODEL_API_KEY) {
  console.log("\nNo model keys set: skipping live calls.");
  process.exit(failures ? 1 : 0);
}

// ---------- live: index one frame ----------
function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error("No JPEG size found");
}
const photoPath = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--dump") || DEFAULT_PHOTO;
const bytes = await readFile(photoPath);
const size = jpegSize(bytes);
const image = `data:image/jpeg;base64,${bytes.toString("base64")}`;
console.log(`\nLIVE  indexer=${WATCHER_LABEL}  photo=${size.width}x${size.height}`);

const t0 = performance.now();
const indexed = await indexFrame(image, size, { room: "Study", maxOutlined: 1 });
console.log(
  `index: ${((performance.now() - t0) / 1000).toFixed(2)}s (model ${(indexed.modelMs / 1000).toFixed(1)}s + outlines ` +
    `${(indexed.outlineMs / 1000).toFixed(1)}s)  by ${indexed.indexedBy}`,
);
const dumpAt = process.argv.indexOf("--dump");
if (dumpAt > 0 && process.argv[dumpAt + 1]) await writeFile(process.argv[dumpAt + 1], JSON.stringify(indexed, null, 2));
console.log(`  items (${indexed.items.length}): ${indexed.items.join(", ")}`);
for (const d of indexed.defects) {
  console.log(
    `  defect [${d.severity}] "${d.phrase}": ${d.description}  outline=${d.outline ? `${d.outline.outlines.length} via ${d.outline.via} (${d.outline.width}x${d.outline.height})` : "none"}`,
  );
}
if (!indexed.defects.length) console.log("  no defects");

if (process.argv.includes("--no-cost")) process.exit(failures ? 1 : 0);

// ---------- live: one cost lookup ----------
const first = indexed.defects[0];
const q = first
  ? { room: "Study", phrase: first.phrase, summary: first.description, severity: first.severity }
  : { room: "Study", phrase: "pen marks", summary: "Blue pen scribbles about 30 cm wide on a painted wall.", severity: "minor" as const };
const t1 = performance.now();
try {
  const est = await estimateRepair(q, "Bengaluru");
  console.log(`\ncost lookup "${q.phrase}": ${((performance.now() - t1) / 1000).toFixed(2)}s`);
  console.log(`  repair: ${est.repair ?? "(none)"}`);
  console.log(`  cost: ${est.cost ? `INR ${est.cost.low}-${est.cost.high}` : "(none)"}`);
  for (const s of est.cost?.sources ?? []) console.log(`  source: ${s.title}  ${s.url}`);
} catch (err) {
  failures++;
  console.log(`\ncost lookup FAILED after ${((performance.now() - t1) / 1000).toFixed(2)}s: ${String(err)}`);
}
process.exit(failures ? 1 : 0);
