// Smoke test for the watcher (Muse Glimmer). At most 3 real model calls on one photo.
//
//   npx tsx --env-file=.env.local scripts/watch-smoke.mts [photo.jpg] [calls=3]
//
// Prints latency per call, the parsed reply, and how many memory entries were kept
// (the same photo again should NOT add a new entry).
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { WATCHER_BASE_URL, WATCHER_LABEL, WATCHER_MODEL, watcherConfigured } from "../lib/fireworks";
import { parseWatcherReply, watch } from "../lib/watcher";
import { recall, recent } from "../lib/memory";

const DEFAULT_PHOTO =
  "C:\\Users\\SYEDZE~1\\AppData\\Local\\Temp\\claude\\C--Metahack\\70cee906-017b-4e46-a267-3711159f96f9\\scratchpad\\real_front.jpg";

// Offline parser checks first (free).
const samples = [
  '```json\n{"caption":"A black office chair on a wooden floor","objects":["chair","floor"],"remark":null}\n```',
  '<think>hmm</think>{"caption":"Keys beside a laptop","objects":["Keys","laptop!"],"remark":"null"}',
  "A desk with a lamp and some papers.",
];
for (const s of samples) console.log("parse:", JSON.stringify(parseWatcherReply(s)));

if (!watcherConfigured()) {
  console.log("\nNo FIREWORKS_API_KEY / WATCHER_API_KEY set: skipping live calls.");
  process.exit(0);
}

const photoPath = process.argv[2] || DEFAULT_PHOTO;
const calls = Math.min(3, Number(process.argv[3]) || 3);
const mime = extname(photoPath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
const image = `data:${mime};base64,${(await readFile(photoPath)).toString("base64")}`;
console.log(`\n${WATCHER_LABEL}  model=${WATCHER_MODEL}  base=${WATCHER_BASE_URL}`);

const sessionId = `smoke-${Date.now()}`;
for (let i = 1; i <= calls; i++) {
  const t0 = performance.now();
  try {
    const out = await watch({ sessionId, frame: { image, width: 0, height: 0 } });
    console.log(`\n#${i} ${((performance.now() - t0) / 1000).toFixed(2)}s  ${JSON.stringify(out)}`);
  } catch (err) {
    console.log(`\n#${i} FAILED after ${((performance.now() - t0) / 1000).toFixed(2)}s: ${String(err)}`);
    break;
  }
}
console.log(`\nmemory entries kept: ${recent(sessionId, 100).length}`);
console.log(`recall("chair"): ${JSON.stringify(recall(sessionId, "where is the chair", 2))}`);
