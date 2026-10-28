// Times one call to each Meta model on a real photo, so we know how "live" FixCam can feel.
//
//   npx tsx --env-file=.env.local scripts/speedtest.ts <photo.jpg> "<part phrase>" [clip.wav] [--image]
//
// Costs roughly a cent or two per run (one Spark call, one SAM image, optional Muse Image).
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { image, MODELS, sam, spark, transcribe } from "../lib/meta";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const started = performance.now();
  try {
    const out = await fn();
    console.log(`\n[${label}] ${((performance.now() - started) / 1000).toFixed(2)}s`);
    return out;
  } catch (err) {
    console.log(`\n[${label}] FAILED after ${((performance.now() - started) / 1000).toFixed(2)}s\n  ${String(err)}`);
  }
}

async function main() {
  const [photoPath, phrase = "chair", wavPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const withImage = process.argv.includes("--image");
  if (!photoPath) throw new Error("Usage: speedtest.ts <photo.jpg> \"<part phrase>\" [clip.wav] [--image]");

  const mime = extname(photoPath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  const photo = `data:${mime};base64,${(await readFile(photoPath)).toString("base64")}`;
  console.log(`Models: ${JSON.stringify(MODELS)}`);

  const said = await timed("Muse Spark: describe photo", () =>
    spark<string>([
      {
        role: "user",
        content: [
          { type: "text", text: "In two sentences: what object is this, and what parts of it can you see?" },
          { type: "image_url", image_url: { url: photo } },
        ],
      },
    ]),
  );
  if (said) console.log(said);

  const seg = await timed(`SAM 3.1: outline "${phrase}"`, () => sam(photo, phrase));
  if (seg) {
    console.log(`frame ${seg.width}x${seg.height}, ${seg.outlines.length} match(es)`);
    for (const o of seg.outlines) console.log(`  #${o.id} box ${JSON.stringify(o.box)} path ${o.path.length} chars`);
  }

  if (wavPath) {
    const wav = new Blob([await readFile(wavPath)], { type: "audio/wav" });
    const text = await timed("Voice Transcribe", () => transcribe(wav));
    if (text !== undefined) console.log(`"${text}"`);
  }

  if (withImage) {
    const out = await timed("Muse Image: generate", () =>
      image("A fully assembled black mesh office chair, product photo, plain background"),
    );
    if (out) console.log(`image data URL, ${out.length} chars`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
