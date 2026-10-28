// Turns a product's manual (photos of the paper pages) and/or a web search into a FixCam guide.
import type OpenAI from "openai";
import { meta, MODELS, sam, spark, type SparkContent } from "./meta";
import type { Guide } from "./types";

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

const PLANNER_PROMPT = `You turn product assembly instructions into a hands-free guide that is read aloud, one step at a time, to someone holding the parts.

Rules:
- One physical action per step. Instructions are short, spoken English (max ~20 words), no step numbers.
- Follow the source's order. The person's own notes are the most trusted source for order; the photos show what each part looks like.
- Set "basis" to "manual" when the steps come from the attached photos (manual pages or a parts layout) and/or the person's notes, "web" when they come from the web notes.
- If the sources don't actually describe the assembly steps, write the standard assembly steps for this kind of product and set "basis" to "typical". Never return an empty step list.
- "part" names the single object the person should look at for that step, as a short PLAIN VISUAL noun phrase of 1-3 everyday words that an object-segmentation model can find in a photo. Describe what it looks like, not its technical name: "seat post" not "gas lift cylinder", "wheel" not "castor", "armrest" not "1-way adjustable armrest assembly".
- "check" says in one sentence what it looks like when the step is done correctly.
- "parts" lists what comes in the box with the same kind of plain "phrase" and a count.`;

/** Builds a guide from manual/parts photos and the person's own notes, or a web search when given neither. */
export async function planGuide(input: {
  product: string;
  manualImages?: string[];
  userNotes?: string;
}): Promise<Guide> {
  const images = input.manualImages ?? [];
  const userNotes = input.userNotes?.trim() ?? "";
  const sources: string[] = [];
  if (images.length) sources.push(`${images.length} photo(s) you added`);
  if (userNotes) sources.push("your notes");
  let notes = "";

  // With nothing from the person, fall back to what the web knows about this exact product.
  if (!images.length && !userNotes) {
    const research = await researchAssembly(input.product);
    notes = research.text;
    sources.push(...research.urls);
  }

  const content: SparkContent[] = [
    {
      type: "text",
      text:
        `Product: ${input.product}\n\n` +
        (images.length ? "The attached images are manual pages and/or photos of the parts laid out.\n" : "") +
        (userNotes ? `The person's own notes on how it goes together:\n${userNotes}\n` : "") +
        (notes ? `Assembly notes found on the web:\n${notes}\n` : "") +
        "Write the guide.",
    },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];

  const guide = await spark<Omit<Guide, "sources">>(
    [
      { role: "system", content: PLANNER_PROMPT },
      { role: "user", content },
    ],
    { schema: GUIDE_SCHEMA, maxTokens: 8000, effort: "medium" },
  );
  // Spark labelled a web-only plan "manual" in testing, so the label is decided here, not by the model.
  const basis = !images.length && !userNotes && guide.basis === "manual" ? "web" : guide.basis;
  const checked = checkGuide({ ...guide, basis, sources });
  return images.length ? verifyPartPhrases(checked, images) : checked;
}

/**
 * Tests every step's part phrase with SAM on the person's photos. A phrase SAM can't find gets
 * swapped for a plain alternative that it can, so "Show me" works by name (~2s) at build time
 * instead of falling back to the slower Spark-points route (~6-9s).
 */
async function verifyPartPhrases(guide: Guide, images: string[]): Promise<Guide> {
  const phrases = [...new Set(guide.steps.map((s) => s.part))];
  const found = new Map<string, string | null>();

  await Promise.all(
    phrases.map(async (phrase) => {
      if (await foundInAny(images, phrase)) return found.set(phrase, phrase);
      for (const alt of await alternativePhrases(phrase, images)) {
        if (await foundInAny(images, alt)) return found.set(phrase, alt);
      }
      found.set(phrase, null);
    }),
  );

  return {
    ...guide,
    steps: guide.steps.map((s) => {
      const phrase = found.get(s.part);
      return phrase ? { ...s, part: phrase, partVerified: true } : { ...s, partVerified: false };
    }),
  };
}

async function foundInAny(images: string[], phrase: string): Promise<boolean> {
  for (const image of images) if ((await sam(image, phrase)).outlines.length) return true;
  return false;
}

async function alternativePhrases(phrase: string, images: string[]): Promise<string[]> {
  const { phrases } = await spark<{ phrases: string[] }>(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `An object-segmentation model can't find "${phrase}" in these photos. Give 3 other short plain ` +
              "descriptions (1-3 everyday words, mostly colour + shape, like \"black cylinder\" or \"black plastic star\") " +
              "of that same object as it looks here.",
          },
          ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
    {
      schema: {
        name: "phrases",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["phrases"],
          properties: { phrases: { type: "array", items: { type: "string" } } },
        },
      },
      effort: "low",
    },
  );
  return phrases.slice(0, 3);
}

/** Spark with web search: how is this product assembled? Returns notes plus the URLs it cited. */
async function researchAssembly(product: string): Promise<{ text: string; urls: string[] }> {
  const res = (await meta().responses.create({
    model: MODELS.spark,
    tools: [{ type: "web_search", search_context_size: "low" }],
    input:
      `Find the official assembly instructions for: ${product}. ` +
      "List what comes in the box and every assembly step in order, as plain notes. Say which source each step came from. " +
      "Only use sources for this exact model. If you can only find instructions for a different product, say so plainly instead of using them.",
  })) as OpenAI.Responses.Response;

  const urls = new Set<string>();
  for (const item of res.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      for (const a of part.annotations) if (a.type === "url_citation") urls.add(a.url);
    }
  }
  return { text: res.output_text, urls: [...urls] };
}

/** Deterministic checks on Spark's output, so a bad plan fails loudly instead of confusing the user. */
export function checkGuide(guide: Guide): Guide {
  if (!guide.steps.length) throw new Error("The planner returned no steps.");
  for (const [i, s] of guide.steps.entries()) {
    if (!s.instruction.trim()) throw new Error(`Step ${i + 1} has no instruction.`);
    const words = s.part.trim().split(/\s+/).length;
    if (!s.part.trim() || words > 4) throw new Error(`Step ${i + 1} part "${s.part}" isn't a short noun phrase.`);
  }
  return guide;
}
