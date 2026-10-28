// Checks that one streamed Responses call can mix web_search, function tools and an image,
// then feeds the function results back for a second round. Two Spark calls per run.
//
//   npx tsx --env-file=.env.local scripts/brain-smoke.ts <photo.jpg> ["question"] [--round2] [--brain]
import { readFile } from "node:fs/promises";
import type OpenAI from "openai";
import { runBrain } from "../lib/brain";
import { meta, MODELS } from "../lib/meta";

const TOOLS: OpenAI.Responses.Tool[] = [
  { type: "web_search", search_context_size: "low" },
  {
    type: "function",
    name: "show_part",
    description: "Outline a visible object on the camera view. Use plain visual words (\"seat post\").",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["phrase"],
      properties: { phrase: { type: "string" } },
    },
  },
  {
    type: "function",
    name: "recall",
    description: "Look up what the camera saw earlier in this session.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string" } },
    },
  },
];

async function round(input: OpenAI.Responses.ResponseInputItem[], label: string) {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const stream = await meta().responses.create({
    model: MODELS.spark,
    stream: true,
    tools: TOOLS,
    reasoning: { effort: "low" },
    max_output_tokens: 3000,
    include: ["web_search_call.action.sources"],
    instructions:
      "You see through the person's phone camera. Answer in 1-3 short spoken sentences. " +
      "Use web search for prices/specs. Never announce what you are about to do. " +
      "To point at something, first give your full spoken answer, then call show_part in the same turn; it runs while you speak.",
    input,
  });

  let firstText = -1;
  let text = "";
  const counts = new Map<string, number>();
  let final: OpenAI.Responses.Response | undefined;
  for await (const ev of stream) {
    counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1);
    if (ev.type === "response.output_text.delta") {
      if (firstText < 0) firstText = ms();
      text += ev.delta;
      continue;
    }
    if (ev.type.endsWith(".delta")) continue;
    let extra = "";
    if (ev.type === "response.output_item.added" || ev.type === "response.output_item.done") {
      extra = ev.item.type + (ev.item.type === "function_call" ? ` ${ev.item.name} ${ev.item.arguments}` : "");
      if (ev.item.type === "message") extra += ` phase=${String((ev.item as { phase?: unknown }).phase)}`;
      if (ev.item.type === "web_search_call") extra += ` ${JSON.stringify((ev.item as { action?: unknown }).action ?? {})}`;
    }
    if (ev.type === "response.output_text.annotation.added") extra = JSON.stringify(ev.annotation).slice(0, 160);
    if (ev.type === "response.completed") final = ev.response;
    if (ev.type === "response.failed" || ev.type === "error") extra = JSON.stringify(ev).slice(0, 300);
    console.log(`  +${ms()}ms ${ev.type} ${extra}`);
  }
  console.log(`[${label}] first text +${firstText}ms, total ${ms()}ms`);
  console.log(`[${label}] event counts ${JSON.stringify(Object.fromEntries(counts))}`);
  console.log(`[${label}] text: ${text}`);
  if (final) {
    console.log(`[${label}] output items: ${final.output.map((o) => o.type).join(", ")}`);
    console.log(`[${label}] usage: ${JSON.stringify(final.usage)}`);
    for (const item of final.output)
      if (item.type === "message")
        for (const p of item.content)
          if (p.type === "output_text") console.log(`[${label}] final annotations: ${JSON.stringify(p.annotations).slice(0, 400)}`);
  }
  return final;
}

async function main() {
  const [photoPath, question = "What chair is this, roughly what does it cost new, and where's the seat post?"] =
    process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!photoPath) throw new Error("Usage: brain-smoke.ts <photo.jpg> [question]");
  const photo = `data:image/jpeg;base64,${(await readFile(photoPath)).toString("base64")}`;

  // --brain: run the real brain end to end and time its events (one Spark round, more if it uses tools).
  if (process.argv.includes("--brain")) {
    const started = performance.now();
    let firstText = -1;
    for await (const ev of runBrain({ sessionId: "smoke", question, frame: { image: photo, width: 683, height: 911 } })) {
      const ms = Math.round(performance.now() - started);
      if (ev.type === "text" && firstText < 0) firstText = ms;
      const shown = ev.type === "outline" ? { ...ev, outlines: `${ev.outlines.length} outline(s)` } : ev;
      console.log(`  +${ms}ms ${JSON.stringify(shown).slice(0, 300)}`);
    }
    console.log(`[brain] first text +${firstText}ms, total ${Math.round(performance.now() - started)}ms`);
    return;
  }

  const input: OpenAI.Responses.ResponseInputItem[] = [
    {
      role: "user",
      content: [
        { type: "input_text", text: question },
        { type: "input_image", image_url: photo, detail: "auto" },
      ],
    },
  ];
  const first = await round(input, "round 1");
  const calls = first?.output.filter((o) => o.type === "function_call") ?? [];
  if (!first || !calls.length || !process.argv.includes("--round2")) return;

  // Feed back every output item (reasoning, web_search_call, function_call) plus the results.
  const next: OpenAI.Responses.ResponseInputItem[] = [
    ...input,
    ...(first.output as OpenAI.Responses.ResponseInputItem[]),
    ...calls.map((c) => ({
      type: "function_call_output" as const,
      call_id: (c as OpenAI.Responses.ResponseFunctionToolCall).call_id,
      output: "Outlined 1 match on the camera view.",
    })),
  ];
  await round(next, "round 2");
}

main().catch((err) => {
  console.error("FAILED", err);
  process.exit(1);
});
