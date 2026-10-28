// The FixCam Live brain: Muse Spark sees the camera frame, answers out loud (streamed), and can
// search the web, outline what it's talking about, recall what the watcher saw, and start or move a guide.
//
// One streamed Responses call per round mixes the built-in web_search tool with our function tools
// and the image (checked with scripts/brain-smoke.ts). Things learned there that shape this file:
// - Spark sometimes writes a "commentary" message ("I'll search for this chair...") before a tool call.
//   It's marked phase="commentary", so it becomes a status line instead of being read aloud.
// - Search sources come back on the web_search_call item (include: web_search_call.action.sources),
//   as bare URLs. No url_citation annotations arrived, so titles are made from the host name.
// - A second round after a search re-runs the search (results aren't carried over), so when the only
//   tool calls are show_part/go_to_step and the answer has already been spoken, we stop after one round.
import type OpenAI from "openai";
import { locatePart } from "./locate";
import { recall, recent } from "./memory";
import { meta, MODELS } from "./meta";
import { planGuide } from "./plan";
import type { LiveEvent, LiveRequest, MemoryEntry } from "./live-types";
import type { Guide } from "./types";

const MAX_ROUNDS = 4;
type Effort = "minimal" | "low" | "medium" | "high";

const FUNCTION_TOOLS: Record<string, OpenAI.Responses.FunctionTool> = {
  show_part: {
    type: "function",
    name: "show_part",
    strict: true,
    description:
      "Outline one thing on the person's live camera view so they can see exactly what you mean. " +
      "The outliner only understands PLAIN VISUAL words for something visible in the image: " +
      '"seat post", "black cylinder", "armrest", "red button", "wheel". Never technical names ' +
      '("gas lift cylinder", "castor"). It runs while you speak; you don\'t need to wait for it.',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["phrase"],
      properties: { phrase: { type: "string", description: "1-3 plain everyday words naming one visible object" } },
    },
  },
  recall: {
    type: "function",
    name: "recall",
    strict: true,
    description:
      "Search what the camera saw earlier in this session (a background watcher logs a caption every few seconds " +
      'for the last ~10 minutes). Use for "where did I put...", "what did I see...", "was there a ... earlier".',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string", description: "Plain words for the thing or moment, e.g. \"keys\", \"red mug\"" } },
    },
  },
  start_guide: {
    type: "function",
    name: "start_guide",
    strict: true,
    description:
      "Build a hands-free step-by-step guide for assembling, fixing or setting up the thing in view. Only call this " +
      "when the person asks for step-by-step help building or fixing something. Takes 10-40 seconds.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["product"],
      properties: {
        product: {
          type: "string",
          description: "The product and task, as specific as you can tell, e.g. \"mesh office chair with headrest: assembly\"",
        },
      },
    },
  },
  go_to_step: {
    type: "function",
    name: "go_to_step",
    strict: true,
    description: "Move the active guide to a step, e.g. when they finished the current step, or ask to go back or skip.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["step"],
      properties: { step: { type: "integer", description: "1-based step number" } },
    },
  },
};

/** Tools whose result the model doesn't need before it can finish speaking. */
const FIRE_AND_FORGET = new Set(["show_part", "go_to_step"]);

export async function* runBrain(
  req: LiveRequest,
  opts: { signal?: AbortSignal; effort?: Effort } = {},
): AsyncGenerator<LiveEvent> {
  const started = Date.now();
  let guide: Guide | undefined = req.guide?.steps?.length ? req.guide : undefined;
  let stepIndex = clampStep(req.stepIndex ?? 0, guide);

  const tools: OpenAI.Responses.Tool[] = [
    { type: "web_search", search_context_size: "low" },
    FUNCTION_TOOLS.show_part,
    FUNCTION_TOOLS.recall,
    FUNCTION_TOOLS.start_guide,
    ...(guide ? [FUNCTION_TOOLS.go_to_step] : []),
  ];

  const input: OpenAI.Responses.ResponseInputItem[] = [
    ...(req.history ?? []).slice(-6).flatMap((h): OpenAI.Responses.ResponseInputItem[] => [
      { role: "user", content: h.question },
      { role: "assistant", content: h.answer },
    ]),
    {
      role: "user",
      content: [
        { type: "input_text", text: req.question },
        { type: "input_image", image_url: req.frame.image, detail: "auto" },
      ],
    },
  ];

  const sources = new Map<string, { title: string; url: string }>();
  let spoken = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = await meta().responses.create(
      {
        model: MODELS.spark,
        stream: true,
        instructions: systemPrompt(req, guide, stepIndex),
        input,
        tools,
        include: ["web_search_call.action.sources"],
        reasoning: { effort: opts.effort ?? "low" },
        // Reasoning tokens count against this budget, so keep it generous.
        max_output_tokens: 3000,
      },
      { signal: opts.signal },
    );

    const phaseOf = new Map<string, string | null | undefined>();
    const commentary = new Map<string, string>();
    const pending: { call: OpenAI.Responses.ResponseFunctionToolCall; result: Promise<ToolResult> }[] = [];
    let spokeThisRound = false;
    let final: OpenAI.Responses.Response | undefined;

    for await (const ev of stream) {
      switch (ev.type) {
        case "response.output_item.added":
          if (ev.item.type === "message") phaseOf.set(ev.item.id, ev.item.phase);
          if (ev.item.type === "web_search_call") yield { type: "status", message: "Searching the web…" };
          break;

        case "response.output_text.delta": {
          if (phaseOf.get(ev.item_id) === "commentary") {
            commentary.set(ev.item_id, (commentary.get(ev.item_id) ?? "") + ev.delta);
            break;
          }
          let delta = ev.delta;
          // Separate answers from different messages/rounds with a space.
          if (!spokeThisRound && spoken && !/\s$/.test(spoken) && !/^\s/.test(delta)) delta = ` ${delta}`;
          spoken += delta;
          spokeThisRound = true;
          yield { type: "text", delta };
          break;
        }

        case "response.output_item.done":
          if (ev.item.type === "message" && commentary.has(ev.item.id)) {
            const note = commentary.get(ev.item.id)!.trim();
            if (note) yield { type: "status", message: note };
          }
          if (ev.item.type === "web_search_call") {
            const before = sources.size;
            const action = ev.item.action;
            if (action?.type === "search")
              for (const s of action.sources ?? []) if (s.url && !sources.has(s.url)) sources.set(s.url, sourceOf(s.url));
            if (sources.size > before) yield { type: "sources", items: [...sources.values()].slice(0, 8) };
          }
          if (ev.item.type === "function_call") {
            const call = ev.item;
            // Start the tool right away so SAM/planning overlaps whatever Spark streams next.
            if (call.name === "start_guide") yield { type: "status", message: "Building a step-by-step guide…" };
            if (call.name === "show_part") yield { type: "status", message: `Looking for the ${parseArgs(call).phrase ?? "part"}…` };
            pending.push({ call, result: runTool(call, req, guide).catch((err) => ({ output: `Tool failed: ${String(err)}` })) });
          }
          break;

        case "response.completed":
        case "response.incomplete":
          final = ev.response;
          break;

        case "response.failed":
          throw new Error(ev.response.error?.message ?? "Spark failed to answer.");
        case "error":
          throw new Error(ev.message);
      }
    }

    if (!pending.length) break;

    // Apply tool results in the order Spark asked for them.
    const outputs: OpenAI.Responses.ResponseInputItem[] = [];
    for (const { call, result } of pending) {
      const r = await result;
      for (const ev of r.events ?? []) yield ev;
      if (r.guide) {
        guide = r.guide;
        stepIndex = 0;
      }
      if (r.stepIndex !== undefined) stepIndex = r.stepIndex;
      outputs.push({ type: "function_call_output", call_id: call.call_id, output: r.output });
    }

    // Answer already spoken and nothing left that Spark needs to read: done in one round.
    if (spokeThisRound && pending.every((p) => FIRE_AND_FORGET.has(p.call.name))) {
      for (const { result } of pending) {
        const r = await result;
        if (r.missed) {
          const line = `I can't spot the ${r.missed} in view right now, though.`;
          spoken += ` ${line}`;
          yield { type: "text", delta: ` ${line}` };
        }
      }
      break;
    }

    // Otherwise feed everything back (reasoning, searches, calls, results) for the next round.
    input.push(...((final?.output ?? pending.map((p) => p.call)) as unknown as OpenAI.Responses.ResponseInputItem[]), ...outputs);
    if (guide && !tools.includes(FUNCTION_TOOLS.go_to_step)) tools.push(FUNCTION_TOOLS.go_to_step);
  }

  if (!spoken.trim()) yield { type: "text", delta: "Sorry, I didn't catch that. Could you ask again?" };
  yield { type: "done", ms: Date.now() - started };
}

// ---------- tools ----------

type ToolResult = {
  /** What Spark reads back. */
  output: string;
  events?: LiveEvent[];
  guide?: Guide;
  stepIndex?: number;
  /** show_part phrase that wasn't found, so we can say so without another round. */
  missed?: string;
};

async function runTool(
  call: OpenAI.Responses.ResponseFunctionToolCall,
  req: LiveRequest,
  guide: Guide | undefined,
): Promise<ToolResult> {
  const args = parseArgs(call);
  switch (call.name) {
    case "show_part": {
      const phrase = String(args.phrase ?? "").trim();
      if (!phrase) return { output: "No phrase given." };
      const found = await locatePart(req.frame.image, phrase, req.frame);
      if (!found.outlines.length) return { output: `Couldn't find "${phrase}" in view.`, missed: phrase };
      return {
        output: `Outlined ${found.outlines.length} "${phrase}" on their screen.`,
        events: [
          {
            type: "outline",
            phrase,
            width: found.width || req.frame.width,
            height: found.height || req.frame.height,
            outlines: found.outlines,
          },
        ],
      };
    }

    case "recall": {
      const query = String(args.query ?? "");
      const hits = recall(req.sessionId, query);
      return { output: hits.length ? hits.map(describeMemory).join("\n") : "Nothing recorded yet this session." };
    }

    case "start_guide": {
      const product = String(args.product ?? "").trim() || "the object in view";
      const planned = await planGuide({ product, manualImages: [req.frame.image] });
      // The image is a camera frame, not manual pages, so the planner can't honestly call this "from the manual".
      // Labels are decided here, not by the model.
      const built: Guide = {
        ...planned,
        basis: planned.basis === "manual" ? "typical" : planned.basis,
        sources: planned.sources.map((s) => (/photo\(s\) you added/.test(s) ? "your camera view" : s)),
      };
      return {
        output:
          `Guide ready for ${built.product}: ${built.steps.length} steps, now on step 1. ` +
          `Step 1: ${built.steps[0].instruction}. Tell them it's ready and read step 1.`,
        events: [{ type: "guide", guide: built }],
        guide: built,
        stepIndex: 0,
      };
    }

    case "go_to_step": {
      if (!guide) return { output: "No guide is active." };
      const index = clampStep(Number(args.step ?? 1) - 1, guide);
      const s = guide.steps[index];
      return {
        output: `Moved to step ${index + 1}: ${s.instruction} (done when: ${s.check ?? "n/a"})`,
        events: [{ type: "step", stepIndex: index }],
        stepIndex: index,
      };
    }

    default:
      return { output: `Unknown tool ${call.name}.` };
  }
}

// ---------- prompt ----------

function systemPrompt(req: LiveRequest, guide: Guide | undefined, stepIndex: number): string {
  const seen = recent(req.sessionId, 3);
  const parts = [
    `You are FixCam, a hands-free assistant that sees through the person's phone camera, like smart glasses. ` +
      `The attached image is what the camera sees right now. Your reply is read aloud. Today is ${new Date().toDateString()}.`,
    `How to answer:
- Look at the image first and answer about what you actually see. Any object, any question. Don't guess beyond it.
- 1-3 short spoken sentences. Plain talk: no markdown, no lists, no URLs, no reading out links or sources.
- Never announce what you are about to do ("I'll search..."). Just do it, then answer.
- Use web search for anything about prices, exact models, specs, reviews, where to buy, manuals or how-tos, or "what product is this". Don't search for things you can answer from the image or common knowledge.
- When pointing would help ("which one", "where is", "what's this part"), give your spoken answer and call show_part in the same turn with plain visual words.
- For "where did I put / what did I see / was there..." questions, call recall.
- Call start_guide only when they ask for step-by-step help assembling, building, fixing or setting something up.`,
  ];
  if (seen.length) {
    parts.push(`What the background watcher saw most recently:\n${seen.map(describeMemory).join("\n")}`);
  }
  if (guide) {
    const steps = guide.steps
      .map((s, i) => `${i + 1}. ${s.instruction} (part: ${s.part}; done when: ${s.check ?? "n/a"})`)
      .join("\n");
    parts.push(
      `A step-by-step guide for ${guide.product} is active. They are on step ${stepIndex + 1} of ${guide.steps.length}.\n${steps}\n` +
        "If they finished a step or ask to move, call go_to_step and read the new step. Help with the current step otherwise.",
    );
  }
  return parts.join("\n\n");
}

// ---------- helpers ----------

function describeMemory(e: MemoryEntry): string {
  const ago = Math.max(0, Math.round((Date.now() - e.t) / 1000));
  const when = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`;
  return `${when}: ${e.caption}${e.objects.length ? ` (objects: ${e.objects.join(", ")})` : ""}`;
}

function parseArgs(call: OpenAI.Responses.ResponseFunctionToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function clampStep(i: number, guide: Guide | undefined): number {
  if (!guide?.steps.length || !Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(guide.steps.length - 1, Math.round(i)));
}

function sourceOf(url: string): { title: string; url: string } {
  try {
    return { title: new URL(url).hostname.replace(/^www\.|^m\./, ""), url };
  } catch {
    return { title: url, url };
  }
}
