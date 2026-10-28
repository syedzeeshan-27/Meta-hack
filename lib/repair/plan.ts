// Turns a diagnosis into a hands-free repair guide: Spark writes the steps from the cause, what the web
// research found and the camera frame; code then puts the safety checkpoints in front.
// Part phrases aren't SAM-tested here (unlike the chair guide): most parts are hidden until the thing is
// opened, so a test on today's frame says little and cost ~20 s. "Show me" falls back to Spark pointing.
import { spark } from "../meta";
import type { Frame, Guide } from "../types";
import { gateSteps } from "./safety";
import type { RepairState } from "./types";

const GUIDE_SCHEMA = {
  name: "guide",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["product", "basis", "parts", "steps"],
    properties: {
      product: { type: "string" },
      basis: { type: "string", enum: ["manual", "web", "typical"] },
      parts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "phrase", "count"],
          properties: {
            name: { type: "string" },
            phrase: { type: "string" },
            count: { type: "integer" },
          },
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["instruction", "part", "check"],
          properties: {
            instruction: { type: "string" },
            part: { type: "string" },
            check: { type: "string" },
          },
        },
      },
    },
  },
};

const PROMPT = `You write hands-free repair guides that are read aloud one step at a time to someone holding the broken thing, with their phone camera on it.

Rules:
- One physical action per step, short spoken English (max ~22 words), no step numbers. 4 to 10 steps.
- Start from the device as it is in the photo. Include opening it up, the fix itself, putting it back together, and a last step that tests it works.
- Don't write steps for switching off, unplugging or letting it cool: the app adds those safety checkpoints before your steps.
- Name the tool in the step when one is needed ("Undo the four screws on the back cover with a Phillips screwdriver").
- Never ask them to work on anything while it's plugged in or switched on, except the final test once it's closed up.
- "part" is the single thing to look at for that step, as a PLAIN VISUAL noun phrase of 1-3 everyday words that an object-segmentation model can find in a photo ("back cover", "blade", "screw", "battery cover", "white wire"). Never technical names.
- "check" says in one sentence what it looks like when the step is done right, judged from a photo.
- "parts" lists the tools and spare parts needed, each with a plain "phrase" and a count.
- "basis": "web" if the research notes describe this repair, otherwise "typical".`;

export async function planRepair(repair: RepairState, frame: Frame, notes = ""): Promise<Guide> {
  const object = [repair.object?.brand, repair.object?.name, repair.object?.model].filter(Boolean).join(" ") || "the device";
  const r = repair.research;
  const context = [
    `Device: ${object}`,
    repair.complaint && `Problem: ${repair.complaint}`,
    repair.verdict && `Diagnosed cause (${repair.verdict.confidence}% sure): ${repair.verdict.cause}`,
    repair.tests.length && `Tests done:\n${repair.tests.map((t) => `- ${t.ask} -> ${t.result ?? "?"}`).join("\n")}`,
    r?.howto && `Research notes: ${r.howto}`,
    r?.part && `Spare part: ${r.part.name}`,
    notes && `The person said: ${notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const planned = await spark<Omit<Guide, "sources">>(
    [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `${context}\n\nThe photo is the device right now. Write the repair guide.` },
          { type: "image_url", image_url: { url: frame.image } },
        ],
      },
    ],
    { schema: GUIDE_SCHEMA, maxTokens: 6000, effort: "low" },
  );

  // The label is decided here: "web" only when research actually returned sources.
  const sources = r?.sources.map((s) => s.url) ?? [];
  const guide = checkGuide({
    ...planned,
    product: object,
    basis: planned.basis === "web" && sources.length ? "web" : "typical",
    parts: planned.parts.map((p) => ({ ...p, name: plain(p.name), phrase: plain(p.phrase) })),
    sources,
  });
  return { ...guide, steps: [...gateSteps(repair.verdict?.gates ?? []), ...guide.steps] };
}

/** "flat_screwdriver" -> "flat screwdriver" (Spark sometimes writes ids instead of names). */
function plain(s: string): string {
  return s.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Deterministic checks on Spark's output. An empty plan fails loudly; a long part phrase is cut to its first
 * few words (SAM wants short phrases) rather than throwing away a good plan mid-repair.
 */
function checkGuide(guide: Guide): Guide {
  const steps = guide.steps
    .filter((s) => s.instruction.trim())
    .map((s) => ({ ...s, part: plain(s.part).split(" ").slice(0, 4).join(" ") || "device" }));
  if (!steps.length) throw new Error("The planner returned no steps.");
  return { ...guide, steps };
}
