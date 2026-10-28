// The repair technician: Muse Spark sees the camera frame, talks (streamed), and runs the repair through
// function tools: it keeps the diagnosis board current, asks for one test at a time (including a sound
// test the phone records), gives a verdict, writes the repair steps and checks each one on camera.
//
// One streamed Responses call per round mixes the built-in web_search tool with our function tools and the
// image. Learned while building FixCam Live: Spark sometimes writes a "commentary" message before a tool
// call (phase="commentary"), which becomes a status line instead of being read aloud; search sources come
// back on the web_search_call item as bare URLs; a second round after a search re-runs the search, so we
// avoid second rounds whenever the tools can speak for themselves.
// Safety is decided in code (lib/repair/safety.ts): the model tags hazards, code picks the path, the gates,
// and the words spoken about them. Lines the app must say exactly (safety, step text, check results) are
// spoken from here, not left to the model, which also saves a second model round.
import type OpenAI from "openai";
import { checkStep } from "../checks";
import { locatePart } from "../locate";
import { meta, MODELS, spark } from "../meta";
import { planRepair } from "./plan";
import { cleanHazards, decidePath, firstOpenGate, gatesFor, safetyLine } from "./safety";
import { HAZARDS, type Cause, type FixEvent, type FixRequest, type RepairState, type TestKind } from "./types";

const MAX_ROUNDS = 3;
const MAX_CAUSES = 4;
const MAX_TESTS = 12;
const TEST_KINDS: TestKind[] = ["look", "do", "say", "listen"];

type Effort = "minimal" | "low" | "medium" | "high";

const fn = (name: string, description: string, properties: Record<string, unknown>): OpenAI.Responses.FunctionTool => ({
  type: "function",
  name,
  strict: true,
  description,
  parameters: { type: "object", additionalProperties: false, required: Object.keys(properties), properties },
});

const TOOLS = {
  update_diagnosis: fn(
    "update_diagnosis",
    "Update the diagnosis board on their screen. Call it every turn while diagnosing: what the object is, " +
      "the complaint, your current causes with likelihoods, what the last test showed, and the one test you're asking for now.",
    {
      object: { type: "string", description: "What it is in plain words, e.g. \"table fan\". Empty if nothing's in view." },
      brand: { type: "string", description: "Brand if you can read or recognise it, else empty." },
      model: { type: "string", description: "Model name/number if readable on a label, else empty." },
      complaint: { type: "string", description: "What's wrong, short, in their words." },
      causes: {
        type: "array",
        description: "2-4 possible causes, most likely first. Likelihoods add up to about 100.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["cause", "likelihood", "why"],
          properties: {
            cause: { type: "string", description: "Short, plain: \"worn coupler\", \"flat batteries\"." },
            likelihood: { type: "integer", description: "0-100" },
            why: { type: "string", description: "One short reason, from what you saw or heard." },
          },
        },
      },
      last_test_result: { type: "string", description: "What the last test showed, in a few words. Empty if none." },
      next_test: { type: "string", description: "The ONE test you're asking for now, as a short instruction. Empty if none." },
      next_test_kind: { type: "string", enum: ["look", "do", "say", "listen", "none"] },
    },
  ),
  give_verdict: fn(
    "give_verdict",
    "Call when one cause is clearly ahead (about 75%+) or the tests have run out. The app decides from the hazards " +
      "whether it's safe to fix at home and says the safety part itself, then looks up the part and price.",
    {
      cause: { type: "string", description: "The cause, plain and specific." },
      confidence: { type: "integer", description: "0-100" },
      hazards: {
        type: "array",
        description:
          "Every hazard involved in fixing THIS fault on THIS device: mains (plugs into the wall), lithium_battery, " +
          "swollen_battery, high_voltage (microwave, CRT, big capacitors inside power supplies), gas, refrigerant, " +
          "moving_blade, heat, spring, water, glass. Empty if none.",
        items: { type: "string", enum: [...HAZARDS] },
      },
    },
  ),
  listen_test: fn(
    "listen_test",
    "Have the app record the device's sound and measure it (hum and its pitch, grinding, buzzing, clicking, how loud). " +
      "Say what they should do first (e.g. switch it on and hold the phone close). Recording starts after you finish " +
      "speaking; the measurement arrives as their next message.",
    {
      seconds: { type: "integer", description: "3-6" },
      ask: { type: "string", description: "What they should do while it records, short." },
    },
  ),
  start_fix: fn(
    "start_fix",
    "Build the step-by-step repair guide (takes ~15 s). Only after give_verdict, when they want to fix it themselves.",
    { notes: { type: "string", description: "Anything they said that matters for the steps, or empty." } },
  ),
  check_step: fn(
    "check_step",
    "Check the current step on camera when they say they've done it or ask you to check. The app speaks the result " +
      "and moves on if it's done.",
    { said: { type: "string", description: "What they said about the step, short." } },
  ),
  go_to_step: fn(
    "go_to_step",
    "Move the guide to a step (they ask to go back, skip or repeat). The app reads the step aloud.",
    { step: { type: "integer", description: "1-based step number" } },
  ),
  show_part: fn(
    "show_part",
    "Outline one thing on their live camera view. Only PLAIN VISUAL words for something visible: " +
      '"blade", "back cover", "red wire", "battery cover", "screw". Never technical names.',
    { phrase: { type: "string", description: "1-3 plain everyday words naming one visible object" } },
  ),
  finish_repair: fn(
    "finish_repair",
    "Call when the repair is over: it works again, or it doesn't and they're giving up or taking it to a shop. " +
      "The app makes their repair card.",
    {
      fixed: { type: "boolean" },
      summary: { type: "string", description: "One or two sentences: what was wrong and what was done." },
    },
  ),
};

/** Tools whose results the model doesn't need: they speak for themselves or need nothing said. */
const SELF_CONTAINED = new Set(["update_diagnosis", "give_verdict", "listen_test", "start_fix", "check_step", "go_to_step", "show_part", "finish_repair"]);

type ToolResult = {
  /** What Spark reads back (only matters if there's another round). */
  output: string;
  events?: FixEvent[];
  /** Said by the app after Spark's own words, exactly as written. */
  say?: string;
};

export async function* runFix(req: FixRequest, opts: { signal?: AbortSignal; effort?: Effort } = {}): AsyncGenerator<FixEvent> {
  const started = Date.now();
  // This turn's working copy. Tools update it so later tools and rounds see the changes; the client gets
  // the same changes through the events and keeps the real copy.
  const st: RepairState = structuredClone(req.repair);

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
  let boardMoved = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = await meta().responses.create(
      {
        model: MODELS.spark,
        stream: true,
        instructions: systemPrompt(st),
        input,
        tools: toolsFor(st),
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
          if (!spokeThisRound && spoken && !/\s$/.test(spoken) && !/^\s/.test(delta)) delta = ` ${delta}`;
          spoken += delta;
          spokeThisRound = true;
          yield { type: "text", delta };
          break;
        }

        case "response.output_item.done":
          if (ev.item.type === "message" && commentary.has(ev.item.id)) {
            // Spark often puts what it means to say (the cause, the next test) in a commentary message just
            // before its tool calls. Speak it, unless it's only narrating the tools ("I'll track the causes").
            const note = commentary.get(ev.item.id)!.trim();
            if (note && TOOL_NARRATION.test(note)) yield { type: "status", message: note };
            else if (note) {
              const delta = `${spoken && !/\s$/.test(spoken) ? " " : ""}${note}`;
              spoken += delta;
              spokeThisRound = true;
              yield { type: "text", delta };
            }
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
            const status = STATUS[call.name];
            if (status) yield { type: "status", message: status };
            // Start right away so SAM/planning overlaps whatever Spark streams next.
            pending.push({
              call,
              result: runTool(call, st, req).catch((err): ToolResult => ({ output: `Tool failed: ${String(err)}`, say: FAILED[call.name] })),
            });
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

    const outputs: OpenAI.Responses.ResponseInputItem[] = [];
    const says: string[] = [];
    boardMoved ||= pending.some((p) => p.call.name === "update_diagnosis" || p.call.name === "give_verdict");
    for (const { call, result } of pending) {
      const r = await result;
      for (const ev of r.events ?? []) yield ev;
      if (r.say) says.push(r.say);
      outputs.push({ type: "function_call_output", call_id: call.call_id, output: r.output });
    }

    // Something has been said (by Spark or by the app) and no tool needs Spark to read its result: done.
    if ((spokeThisRound || says.length) && pending.every((p) => SELF_CONTAINED.has(p.call.name))) {
      for (const line of says) {
        const delta = `${spoken && !/\s$/.test(spoken) ? " " : ""}${line}`;
        spoken += delta;
        yield { type: "text", delta };
      }
      break;
    }

    input.push(...((final?.output ?? pending.map((p) => p.call)) as unknown as OpenAI.Responses.ResponseInputItem[]), ...outputs);
  }

  if (!spoken.trim()) yield { type: "text", delta: "Sorry, I didn't catch that. Could you say it again?" };
  // Spark answered a diagnosing turn without touching the board (it does sometimes, and the Meta API only
  // allows tool_choice "auto"). Fill the board from what was said, after the answer, so it costs no wait.
  else if (!boardMoved && !st.guide && !st.verdict && !opts.signal?.aborted) {
    try {
      yield applyDiagnosis(st, await boardFromTurn(st, req, spoken));
    } catch (err) {
      console.error("[fix] board fallback failed", err);
    }
  }
  yield { type: "done", ms: Date.now() - started };
}

/** One quick structured call: the board as it should look after this turn. */
async function boardFromTurn(st: RepairState, req: FixRequest, answer: string): Promise<Record<string, unknown>> {
  const params = TOOLS.update_diagnosis.parameters as Record<string, unknown>;
  return spark<Record<string, unknown>>(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You keep the diagnosis board for a repair technician who is looking at this photo through the person's camera.\n" +
              `The repair so far:\n${describe(st)}\n\nThey just said: "${req.question}"\nThe technician answered: "${answer}"\n\n` +
              "Fill in the board as it should be now: the object, the complaint, 2-4 likely causes (likelihoods adding to ~100), " +
              "what the last test showed (if they just reported one), and the one test the technician just asked for.",
          },
          { type: "image_url", image_url: { url: req.frame.image } },
        ],
      },
    ],
    { schema: { name: "board", schema: params }, effort: "minimal" },
  );
}

/** "I'll track the likely causes", "Let me update the board": tool talk, not something to say out loud. */
const TOOL_NARRATION = /\b(i'?ll|i will|i'm going to|let me)\b[^.]{0,40}\b(track|update|log|note down|record|search|look (?:it |that )?up|board)\b/i;

const STATUS: Record<string, string> = {
  start_fix: "Writing the repair steps…",
  check_step: "Checking this step…",
  show_part: "Finding it on camera…",
};

const FAILED: Record<string, string> = {
  start_fix: "I couldn't put the steps together just now. Say \"let's fix it\" to try again.",
  check_step: "I couldn't check that just now. Hold it steady and ask me again.",
};

// ---------- tools ----------

function toolsFor(st: RepairState): OpenAI.Responses.Tool[] {
  const tools: OpenAI.Responses.Tool[] = [{ type: "web_search", search_context_size: "low" }, TOOLS.show_part];
  if (!st.guide) tools.push(TOOLS.update_diagnosis, TOOLS.listen_test, TOOLS.give_verdict);
  if (st.verdict && st.verdict.path !== "shop") tools.push(TOOLS.start_fix);
  if (st.guide) tools.push(TOOLS.check_step, TOOLS.go_to_step, TOOLS.listen_test);
  if (st.stage !== "intake") tools.push(TOOLS.finish_repair);
  return tools;
}

async function runTool(call: OpenAI.Responses.ResponseFunctionToolCall, st: RepairState, req: FixRequest): Promise<ToolResult> {
  const a = parseArgs(call);
  switch (call.name) {
    case "update_diagnosis":
      return { output: "Board updated.", events: [applyDiagnosis(st, a)] };

    case "give_verdict": {
      const hazards = cleanHazards(a.hazards);
      const path = decidePath(hazards);
      const gates = gatesFor(hazards);
      const cause = str(a.cause) || st.causes[0]?.text || "unknown";
      st.verdict = { cause, confidence: clampInt(a.confidence, 0, 100), hazards, path, gates, safety: safetyLine(path, hazards, gates) };
      st.stage = "verdict";
      st.nextTest = undefined;
      const next =
        path === "shop"
          ? ""
          : " I'm looking up the part and what it costs. Say \"let's fix it\" when you're ready, and I'll take you through it step by step.";
      return {
        output: `Verdict saved. Safety rules decided: ${path}. The app is telling them: ${st.verdict.safety}`,
        events: [{ type: "verdict", verdict: st.verdict }],
        say: `Most likely it's ${withArticle(cause)}, about ${st.verdict.confidence}% sure. ${st.verdict.safety}${next}`,
      };
    }

    case "listen_test": {
      const seconds = clampInt(a.seconds, 3, 6);
      return { output: "Recording after you finish speaking.", events: [{ type: "listen", ask: str(a.ask), seconds }] };
    }

    case "start_fix": {
      if (!st.verdict) return { output: "No verdict yet.", say: "Let's pin down what's wrong first." };
      if (st.verdict.path === "shop") return { output: "Refused: shop only.", say: st.verdict.safety };
      const guide = await planRepair(st, req.frame, str(a.notes));
      st.guide = guide;
      st.stepIndex = 0;
      st.stage = "fixing";
      const tools = guide.parts.slice(0, 4).map((p) => p.name.toLowerCase());
      const real = guide.steps.filter((s) => !s.gate).length;
      return {
        output: `Guide ready: ${guide.steps.length} steps.`,
        events: [{ type: "guide", guide }],
        say:
          `Here's the plan: ${real} steps${guide.steps.length > real ? ", after a quick safety check" : ""}.` +
          (tools.length ? ` You'll need: ${joinWords(tools)}.` : "") +
          ` First: ${guide.steps[0].instruction}`,
      };
    }

    case "check_step": {
      const guide = st.guide;
      if (!guide) return { output: "No guide is active." };
      const i = st.stepIndex;
      const step = guide.steps[i];
      const c = await checkStep(req.frame, step, guide.product, str(a.said));
      const events: FixEvent[] = [{ type: "check", stepIndex: i, done: c.done, ...(step.gate && { gate: step.gate }) }];
      if (c.problem?.outlines.length)
        events.push({ type: "outline", phrase: c.problem.phrase, width: c.problem.width, height: c.problem.height, outlines: c.problem.outlines, tone: "new" });
      let say = c.say;
      if (c.done) {
        if (step.gate && !st.gatesPassed.includes(step.gate)) st.gatesPassed = [...st.gatesPassed, step.gate];
        if (i < guide.steps.length - 1) {
          st.stepIndex = i + 1;
          events.push({ type: "step", stepIndex: i + 1 });
          say += ` Next: ${guide.steps[i + 1].instruction}`;
        } else say += " That was the last step. Does it work now?";
      }
      return { output: c.done ? "Step done." : "Not done yet.", events, say };
    }

    case "go_to_step": {
      const guide = st.guide;
      if (!guide) return { output: "No guide is active." };
      let target = clampInt(Number(a.step) - 1, 0, guide.steps.length - 1);
      const open = firstOpenGate(guide.steps, st.gatesPassed);
      const blocked = open >= 0 && target > open;
      if (blocked) target = open;
      st.stepIndex = target;
      const s = guide.steps[target];
      return {
        output: `On step ${target + 1}.`,
        events: [{ type: "step", stepIndex: target }],
        say: blocked ? `Safety check first: ${s.instruction}` : `Step ${target + 1}: ${s.instruction}`,
      };
    }

    case "show_part": {
      const phrase = str(a.phrase);
      if (!phrase) return { output: "No phrase given." };
      const found = await locatePart(req.frame.image, phrase, req.frame);
      if (!found.outlines.length) return { output: `Couldn't find "${phrase}".`, say: `I can't spot the ${phrase} in view right now.` };
      return {
        output: `Outlined "${phrase}".`,
        events: [
          {
            type: "outline",
            phrase,
            width: found.width || req.frame.width,
            height: found.height || req.frame.height,
            outlines: found.outlines,
            tone: "info",
          },
        ],
      };
    }

    case "finish_repair": {
      const fixed = a.fixed === true;
      const summary = str(a.summary) || (fixed ? "Repaired." : "Not repaired.");
      st.outcome = { fixed, summary };
      st.stage = "done";
      return { output: "Repair card is being made.", events: [{ type: "finish", fixed, summary }] };
    }

    default:
      return { output: `Unknown tool ${call.name}.` };
  }
}

/** update_diagnosis, applied: the board's new state and the event that shows it. */
function applyDiagnosis(st: RepairState, a: Record<string, unknown>): FixEvent {
  const name = str(a.object);
  if (name) {
    // Keep a brand/model read earlier unless it's a different object now.
    const prev = st.object?.name.toLowerCase() === name.toLowerCase() ? st.object : undefined;
    const brand = str(a.brand) || prev?.brand;
    const model = str(a.model) || prev?.model;
    st.object = { name, ...(brand && { brand }), ...(model && { model }) };
  }
  if (str(a.complaint)) st.complaint = str(a.complaint);
  const causes = normalizeCauses(a.causes);
  if (causes.length) st.causes = causes;
  const result = str(a.last_test_result);
  if (result) st.tests = [...st.tests, { ...(st.nextTest ?? { ask: "What they told me", kind: "say" as const }), result }].slice(-MAX_TESTS);
  const kind = TEST_KINDS.find((k) => k === a.next_test_kind);
  st.nextTest = str(a.next_test) && kind ? { ask: str(a.next_test), kind } : undefined;
  if (st.stage === "intake") st.stage = "diagnosing";
  return { type: "diagnosis", object: st.object, complaint: st.complaint, causes: st.causes, tests: st.tests, nextTest: st.nextTest ?? null };
}

// ---------- prompt ----------

function systemPrompt(st: RepairState): string {
  const parts = [
    `You are FixCam, a calm, expert repair technician who sees through the person's phone camera and talks them through ` +
      `finding out what's wrong with a broken household thing and fixing it: fans, mixer grinders, remotes, chargers, ` +
      `earphones, speakers, lamps, kettles, toys, gadgets, small furniture. The attached image is what the camera sees ` +
      `right now. Your reply is read aloud. Today is ${new Date().toDateString()}. They're in ${st.city || "India"}.`,
    `How you talk:
- 1-3 short spoken sentences. Plain words. No markdown, lists, URLs or prices you haven't looked up.
- Speak first, then call tools in the same turn. Never announce tool calls ("I'll update the board").
- Messages starting with "[Sound test]" are the app's measurements of the device, not the person talking.`,
    `How you diagnose (their screen shows your board, so keep it current with update_diagnosis every turn until the verdict):
- Work from what you see and hear. Name the object, and the brand and model if you can read them.
- If you don't know what's wrong yet, ask what it's doing or not doing. If it looks fine, say so and ask.
- Keep 2-4 causes with likelihoods adding to about 100. Include simple ones when they fit: switched off at the wall, loose plug, flat or backwards batteries, wrong mode.
- Ask for ONE test at a time: the safest, quickest test that best separates your top causes. Kinds: look (show me), do (try this and tell me), say (answer me), listen (call listen_test: the phone records the sound; great for hums, grinding, buzzing, clicking).
- Never ask them to open, poke inside, or test inside anything that's plugged in. Unplug first.
- When one cause is clearly ahead (about 75%+), or tests have run out, call give_verdict with every hazard involved. Only say a short lead-in like "Okay, I think I've got it." The app then announces the cause, how sure you are and the safety advice, and finds the part and price. Never promise it's safe yourself.
- Search the web only for model-specific facts (a known fault, a part number); it's slow.`,
    `Fixing:
- When they want to fix it and the verdict allows, call start_fix and say one short line like "Okay, let me write the steps."
- With a guide active: help with the current step. When they say they've done it or ask you to check, call check_step and say only "Let me look." To change steps call go_to_step; the app reads steps aloud, so don't read them yourself.
- The first steps can be safety checkpoints; they only pass on camera. Don't wave them through.
- When it works again (or it doesn't and they're stopping), call finish_repair and congratulate or reassure them in one sentence.
- Use show_part with plain visual words whenever pointing helps ("which screw", "where").`,
    `The repair so far:\n${describe(st)}`,
  ];
  return parts.join("\n\n");
}

function describe(st: RepairState): string {
  const lines: string[] = [`Stage: ${st.stage}`];
  if (st.object) lines.push(`Object: ${[st.object.brand, st.object.name, st.object.model && `(model ${st.object.model})`].filter(Boolean).join(" ")}`);
  if (st.complaint) lines.push(`Complaint: ${st.complaint}`);
  if (st.causes.length) lines.push(`Causes now: ${st.causes.map((c) => `${c.text} ${c.likelihood}% (${c.why})`).join("; ")}`);
  if (st.tests.length) lines.push(`Tests done:\n${st.tests.map((t) => `- ${t.ask} -> ${t.result}`).join("\n")}`);
  if (st.nextTest) lines.push(`Waiting on this test: ${st.nextTest.ask} (${st.nextTest.kind})`);
  if (st.verdict) lines.push(`Verdict: ${st.verdict.cause} (${st.verdict.confidence}%). Path set by the safety rules: ${st.verdict.path}. ${st.verdict.safety}`);
  const r = st.research;
  if (r) {
    const price = (m?: { low: number; high: number }) => (m ? `₹${m.low}-${m.high}` : "unknown");
    lines.push(`Research (${r.basis}): part ${r.part?.name ?? "?"} ${price(r.part?.price)}; new ${price(r.newPrice)}. ${r.howto ?? ""}`);
  }
  if (st.guide) {
    const steps = st.guide.steps
      .map((s, i) => `${i + 1}. ${s.gate ? `[SAFETY CHECKPOINT${st.gatesPassed.includes(s.gate) ? ", passed" : ", NOT passed"}] ` : ""}${s.instruction} (done when: ${s.check ?? "n/a"})`)
      .join("\n");
    lines.push(`Repair guide, they're on step ${st.stepIndex + 1} of ${st.guide.steps.length}:\n${steps}`);
  }
  if (st.outcome) lines.push(`Outcome: ${st.outcome.fixed ? "fixed" : "not fixed"}. ${st.outcome.summary}`);
  return lines.join("\n");
}

// ---------- helpers ----------

function normalizeCauses(raw: unknown): Cause[] {
  if (!Array.isArray(raw)) return [];
  const list = raw
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { text: str(o.cause), likelihood: clampInt(o.likelihood, 0, 100), why: str(o.why) };
    })
    .filter((c) => c.text);
  const total = list.reduce((s, c) => s + c.likelihood, 0);
  return list
    .map((c) => ({ ...c, likelihood: total > 0 ? Math.round((c.likelihood / total) * 100) : Math.round(100 / list.length) }))
    .sort((x, y) => y.likelihood - x.likelihood)
    .slice(0, MAX_CAUSES);
}

const str = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

/** "worn gas lift" -> "a worn gas lift"; leaves "the ...", plurals and "flat batteries" alone. */
function withArticle(cause: string): string {
  const c = cause.trim().replace(/[.]+$/, "");
  if (/^(a|an|the|some|no|your|its)\s/i.test(c) || /s$/i.test(c.split(" ").at(-1) ?? "")) return c;
  return `${/^[aeiou]/i.test(c) ? "an" : "a"} ${c}`;
}

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function parseArgs(call: OpenAI.Responses.ResponseFunctionToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sourceOf(url: string): { title: string; url: string } {
  try {
    return { title: new URL(url).hostname.replace(/^www\.|^m\./, ""), url };
  } catch {
    return { title: url, url };
  }
}
