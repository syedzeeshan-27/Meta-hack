// Runs the repair brain end to end on one photo, with scripted replies, and prints what the screen would show.
// Use an object the code knows nothing about, to check nothing is hard-coded.
//
//   npx tsx --env-file=.env.local scripts/repair-smoke.mts <photo.jpg> "<complaint>" "<test answer>" [--fix]
//
// Costs a few cents: 2-3 Spark turns, one web-search research call, and with --fix a repair plan + SAM checks.
import { readFile } from "node:fs/promises";
import { applyEvent, newRepair, withResearch } from "../components/fix/state";
import { runFix } from "../lib/repair/brain";
import { research } from "../lib/repair/research";
import type { FixEvent, RepairState } from "../lib/repair/types";
import type { Frame } from "../lib/types";

const [photoPath, complaint, answer] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!photoPath || !complaint) throw new Error('Usage: repair-smoke.mts <photo.jpg> "<complaint>" "<test answer>" [--fix]');

const bytes = await readFile(photoPath);
const { width, height } = jpegSize(bytes);
const frame: Frame = { image: `data:image/jpeg;base64,${bytes.toString("base64")}`, width, height };
let st: RepairState = newRepair("Hyderabad");
const history: { question: string; answer: string }[] = [];

async function turn(question: string) {
  const started = performance.now();
  console.log(`\n>>> ${question}`);
  let text = "";
  let first = 0;
  for await (const ev of runFix({ question, frame, repair: st, history })) {
    if (ev.type === "text") {
      first ||= performance.now() - started;
      text += ev.delta;
    } else if (ev.type === "done") break;
    else {
      log(ev);
      st = applyEvent(st, ev);
    }
  }
  history.push({ question, answer: text });
  console.log(`<<< ${text.trim()}`);
  console.log(`    (first words ${(first / 1000).toFixed(1)} s, whole turn ${((performance.now() - started) / 1000).toFixed(1)} s)`);
}

function log(ev: FixEvent) {
  if (ev.type === "diagnosis") {
    console.log(`  [board] ${[ev.object?.brand, ev.object?.name, ev.object?.model].filter(Boolean).join(" ")} | ${ev.complaint ?? ""}`);
    for (const c of ev.causes) console.log(`          ${String(c.likelihood).padStart(3)}%  ${c.text}  (${c.why})`);
    if (ev.nextTest) console.log(`          next test (${ev.nextTest.kind}): ${ev.nextTest.ask}`);
    for (const t of ev.tests) console.log(`          done: ${t.ask} -> ${t.result}`);
  } else if (ev.type === "verdict") {
    console.log(`  [verdict] ${ev.verdict.cause} ${ev.verdict.confidence}% | path ${ev.verdict.path} | hazards ${ev.verdict.hazards.join(",") || "none"} | gates ${ev.verdict.gates.join(",") || "none"}`);
  } else if (ev.type === "guide") {
    console.log(`  [guide] ${ev.guide.product} (${ev.guide.basis}), tools: ${ev.guide.parts.map((p) => p.name).join(", ")}`);
    ev.guide.steps.forEach((s, i) => console.log(`          ${i + 1}. ${s.gate ? `[${s.gate}] ` : ""}${s.instruction}  {part: ${s.part}${s.partVerified ? " ✓" : ""}}`));
  } else if (ev.type === "outline") console.log(`  [outline] ${ev.phrase}: ${ev.outlines.length} shape(s), ${ev.tone}`);
  else console.log(`  [${ev.type}] ${JSON.stringify(ev).slice(0, 160)}`);
}

await turn(complaint);
if (answer) await turn(answer);
if (!st.verdict) await turn("That's all I can tell you. What do you think it is?");

if (st.verdict && st.object) {
  const started = performance.now();
  const r = await research({ object: st.object, complaint: st.complaint, cause: st.verdict.cause, path: st.verdict.path, city: st.city });
  console.log(`\n  [research ${((performance.now() - started) / 1000).toFixed(1)} s] basis ${r.basis}; part ${r.part?.name ?? "-"} ${JSON.stringify(r.part?.price ?? null)}; new ${JSON.stringify(r.newPrice ?? null)}; ${r.weightKg ?? "?"} kg`);
  console.log(`          ${r.howto ?? ""}`);
  for (const s of [...r.sources, ...r.shops]) console.log(`          ${s.url}`);
  st = withResearch(st, r);
}

if (process.argv.includes("--fix") && st.verdict?.path !== "shop") await turn("Let's fix it.");

/** Width and height from a JPEG's SOF marker. */
function jpegSize(b: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error("Not a JPEG I can read.");
}
