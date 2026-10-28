// The FixCam agent: Muse Spark sees the current camera frame, knows the guide and the current step,
// answers out loud, and can act through tools (outline a part, move to a step).
import type OpenAI from "openai";
import { locatePart, type Located } from "./locate";
import { meta, MODELS } from "./meta";
import type { Guide } from "./types";

export type Frame = { image: string; width: number; height: number };

export type AgentReply = {
  /** What to say out loud. */
  say: string;
  /** Step to move to (0-based), if the agent decided to. */
  goToStep?: number;
  /** Outline the agent asked for, if any. */
  outline?: Located & { phrase: string };
  /** Tools the agent used, in order, for the UI's "what it did" line. */
  actions: string[];
};

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "show_part",
      description:
        "Outline a part on the person's camera view so they can see exactly what you mean. " +
        "Use plain visual words for the part (\"seat post\", \"black cylinder\", \"armrest\").",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["phrase"],
        properties: { phrase: { type: "string", description: "1-3 plain words naming one visible object" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "go_to_step",
      description: "Move the guide to a step, e.g. when the person says they finished, or asks to go back.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["step"],
        properties: { step: { type: "integer", description: "1-based step number" } },
      },
    },
  },
];

function systemPrompt(guide: Guide, stepIndex: number): string {
  if (!guide.steps.length) {
    return `You are FixCam, a hands-free assistant. The person points their phone camera at something${
      guide.product ? ` (they said: ${guide.product})` : ""
    } and talks to you; your reply is read aloud. The attached image is what the camera sees right now.

How to answer:
- Look at the image first and answer about what you actually see. Any object, any question.
- If they ask how to assemble, fix, adjust or use something, walk them through the next action only, then wait.
- Reply in 1-3 short spoken sentences. No lists, no markdown.
- If pointing at something would help, call show_part.`;
  }
  const steps = guide.steps
    .map((s, i) => `${i + 1}. ${s.instruction} (part: ${s.part}; done when: ${s.check ?? "n/a"})`)
    .join("\n");
  return `You are FixCam, a hands-free assistant helping someone assemble, adjust or fix a ${guide.product}. They talk to you while holding parts; your reply is read aloud.

The guide:
${steps}

They are on step ${stepIndex + 1}. The attached image is what their phone camera sees right now.

How to answer:
- Look at the image before answering. Say what you actually see; don't guess beyond it.
- Reply in 1-3 short spoken sentences. No lists, no markdown.
- If pointing at something would help, call show_part. If they finished a step or ask to move, call go_to_step.
- If the question isn't about the task, answer briefly anyway.`;
}

export async function askAgent(input: {
  question: string;
  frame: Frame;
  guide: Guide;
  stepIndex: number;
}): Promise<AgentReply> {
  const { question, frame, guide, stepIndex } = input;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(guide, stepIndex) },
    {
      role: "user",
      content: [
        { type: "text", text: question },
        { type: "image_url", image_url: { url: frame.image } },
      ],
    },
  ];
  const reply: AgentReply = { say: "", actions: [] };

  // A few rounds at most: look, maybe act, then speak.
  for (let round = 0; round < 3; round++) {
    const res = await meta().chat.completions.create({
      model: MODELS.spark,
      messages,
      tools: guide.steps.length ? TOOLS : TOOLS.filter((t) => t.type === "function" && t.function.name !== "go_to_step"),
      max_completion_tokens: 2000,
      reasoning_effort: "low",
    });
    const msg = res.choices[0]?.message;
    if (!msg) break;
    if (!msg.tool_calls?.length) {
      reply.say = msg.content?.trim() ?? "";
      break;
    }

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const args = JSON.parse(call.function.arguments || "{}") as { phrase?: string; step?: number };
      let result: string;
      if (call.function.name === "show_part" && args.phrase) {
        const found = await locatePart(frame.image, args.phrase, frame);
        if (found.outlines.length) reply.outline = { ...found, phrase: args.phrase };
        result = found.outlines.length ? `Outlined ${found.outlines.length} "${args.phrase}".` : `Couldn't find "${args.phrase}" in view.`;
        reply.actions.push(`show ${args.phrase}`);
      } else if (call.function.name === "go_to_step" && args.step) {
        const step = Math.max(1, Math.min(guide.steps.length, args.step));
        reply.goToStep = step - 1;
        result = `Moved to step ${step}: ${guide.steps[step - 1].instruction}`;
        reply.actions.push(`step ${step}`);
      } else {
        result = "Unknown tool.";
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  if (!reply.say) reply.say = "Sorry, I didn't catch that. Could you ask again?";
  return reply;
}
