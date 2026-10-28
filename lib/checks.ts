// Is this step done? Spark judges the camera frame against the step's "done when"; if something's
// wrong, the part at fault is outlined so the person can see exactly what to fix.
import { locatePart, type Located } from "./locate";
import { spark } from "./meta";
import type { Frame, Step } from "./types";

export type StepCheck = {
  done: boolean;
  say: string;
  /** The part that's wrong, outlined on the frame. */
  problem?: Located & { phrase: string };
};

export async function checkStep(frame: Frame, step: Step, product: string, said = ""): Promise<StepCheck> {
  const verdict = await spark<{ done: boolean; say: string; problem_part: string }>(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Someone is repairing a ${product}, with their phone camera on it. The step was: "${step.instruction}". ` +
              `It's done correctly when: ${step.check ?? "the step is complete"}. ` +
              (said ? `They just said: "${said}". ` : "") +
              "Look at the photo. Is the step done correctly? Judge what you can see; if the photo can't show it " +
              "(a sound, a temperature, something out of view), go by what they said unless the photo contradicts it. " +
              (step.gate
                ? "This is a SAFETY checkpoint: only say done when the photo clearly shows it. When in doubt, it's not done. "
                : "") +
              "say = one or two short spoken sentences: confirm it, or say exactly what to fix or what to show. " +
              "problem_part = 1-3 plain words for the visible part that's wrong, or empty string.",
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
