// The three checks: is this step done, are all the parts here, and does the finished thing look right.
import type { Frame } from "./agent";
import { locatePart, type Located } from "./locate";
import { image, sam, spark } from "./meta";
import type { Guide, PartItem, Step } from "./types";

// ---------- Is this step done? ----------

export type StepCheck = {
  done: boolean;
  say: string;
  /** The part that's wrong, outlined on the frame. */
  problem?: Located & { phrase: string };
};

export async function checkStep(frame: Frame, step: Step, product: string): Promise<StepCheck> {
  const verdict = await spark<{ done: boolean; say: string; problem_part: string }>(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Someone is assembling a ${product}. The step was: "${step.instruction}". ` +
              `It's done correctly when: ${step.check ?? "the step is complete"}. ` +
              "Look at the photo. Is the step done correctly? Judge only what you can see. " +
              "say = one or two short spoken sentences: confirm it, or say exactly what to fix. " +
              "problem_part = 1-3 plain words for the part that's wrong, or empty string if it's fine.",
          },
          { type: "image_url", image_url: { url: frame.image } },
        ],
      },
    ],
    {
      schema: {
        name: "step_check",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["done", "say", "problem_part"],
          properties: { done: { type: "boolean" }, say: { type: "string" }, problem_part: { type: "string" } },
        },
      },
      effort: "low",
    },
  );

  const result: StepCheck = { done: verdict.done, say: verdict.say };
  if (!verdict.done && verdict.problem_part.trim()) {
    const found = await locatePart(frame.image, verdict.problem_part.trim(), frame);
    if (found.outlines.length) result.problem = { ...found, phrase: verdict.problem_part.trim() };
  }
  return result;
}

// ---------- Are all the parts here? ----------

export type PartCount = PartItem & { seen: number };
export type PartsCheck = { counts: PartCount[]; outlines: (Located & { phrase: string })[]; say: string };

/**
 * Counts each listed part with SAM by name. The counts come from SAM's detections, not from a
 * model's opinion, so "you have 4 of 5 wheels" is something the app actually measured.
 */
export async function checkParts(frame: Frame, parts: PartItem[]): Promise<PartsCheck> {
  const results = await Promise.all(
    parts.map(async (p) => {
      const seg = await sam(frame.image, p.phrase);
      return { part: p, seg };
    }),
  );
  const counts = results.map(({ part, seg }) => ({ ...part, seen: seg.outlines.length }));
  const missing = counts.filter((c) => c.seen < c.count);
  const say = missing.length
    ? `I can see most of it. ` +
      missing.map((m) => `${m.seen} of ${m.count} ${m.name}`).join(", ") +
      ". Check the box, or move them into view."
    : "Everything on the list is here. Let's start.";
  return {
    counts,
    outlines: results.filter((r) => r.seg.outlines.length).map((r) => ({ ...r.seg, via: "name" as const, phrase: r.part.phrase })),
    say,
  };
}

// ---------- Does the finished thing look right? ----------

export type FinalCheck = { reference: string; ok: boolean; say: string };

/** Muse Image draws the finished product from the person's own photo; Spark compares the two. */
export async function finalCheck(frame: Frame, guide: Guide): Promise<FinalCheck> {
  const reference = await image(
    `This photo shows a ${guide.product}. Redraw it fully and correctly assembled, in the same room and from ` +
      "the same angle, with every part in its proper place. Keep it photorealistic.",
    [frame.image],
  );

  const verdict = await spark<{ ok: boolean; say: string }>(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `First image: someone's ${guide.product} after assembly. Second image: how it should look. ` +
              `The checks were:\n${guide.steps.map((s, i) => `${i + 1}. ${s.check ?? s.instruction}`).join("\n")}\n` +
              "Compare the first photo against these checks and the reference. ok = everything looks right. " +
              "say = two short spoken sentences: the verdict, and the one thing to fix if any.",
          },
          { type: "image_url", image_url: { url: frame.image } },
          { type: "image_url", image_url: { url: reference } },
        ],
      },
    ],
    {
      schema: {
        name: "final_check",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "say"],
          properties: { ok: { type: "boolean" }, say: { type: "string" } },
        },
      },
      effort: "medium",
    },
  );
  return { reference, ...verdict };
}
