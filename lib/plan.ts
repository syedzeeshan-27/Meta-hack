// Turns a product's manual (photos of the paper pages) and/or a web search into a FixCam guide.
import type OpenAI from "openai";
import { meta, MODELS, spark, type SparkContent } from "./meta";
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
- Follow the source's order. Set "basis" to "manual" when the steps come from the attached manual pages, "web" when they come from the web notes.
- If the sources don't actually describe the assembly steps, write the standard assembly steps for this kind of product and set "basis" to "typical". Never return an empty step list.
- "part" names the single object the person should look at for that step, as a short PLAIN VISUAL noun phrase of 1-3 everyday words that an object-segmentation model can find in a photo. Describe what it looks like, not its technical name: "seat post" not "gas lift cylinder", "wheel" not "castor", "armrest" not "1-way adjustable armrest assembly".
- "check" says in one sentence what it looks like when the step is done correctly.
- "parts" lists what comes in the box with the same kind of plain "phrase" and a count.`;

/** Builds a guide from manual photos and/or a web search for the product name. */
export async function planGuide(input: { product: string; manualImages?: string[] }): Promise<Guide> {
  const images = input.manualImages ?? [];
  const sources: string[] = images.length ? [`${images.length} manual photo(s)`] : [];
  let notes = "";

  // Without the paper manual, fall back to what the web knows about this exact product.
  if (!images.length) {
    const research = await researchAssembly(input.product);
    notes = research.text;
    sources.push(...research.urls);
  }

  const content: SparkContent[] = [
    {
      type: "text",
      text:
        `Product: ${input.product}\n\n` +
        (images.length ? "The attached images are pages of its assembly manual.\n" : "") +
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
  const basis = !images.length && guide.basis === "manual" ? "web" : guide.basis;
  return checkGuide({ ...guide, basis, sources });
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
