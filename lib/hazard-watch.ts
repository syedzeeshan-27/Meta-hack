// The safety watcher: during a repair the client sends a small frame every few seconds. Meta's open-weight
// model (Muse Spark Open on Fireworks) looks for hazards; if it flags one, Muse Spark double-checks the same
// frame before the app raises the alarm (a false STOP mid-repair is almost as bad as a missed one), and SAM
// outlines the thing at fault.
import type { HazardRequest, HazardResponse } from "./repair/types";
import { fireworks, lowReasoningParams, WATCHER_LABEL, WATCHER_MODEL } from "./fireworks";
import { sam, spark } from "./meta";

const MAX_TOKENS = Number(process.env.WATCHER_MAX_TOKENS) || 400;
const KINDS = ["plugged_in", "hand_near_blade", "smoke_or_fire", "swollen_battery", "water_near_power", "other"] as const;

function system(req: HazardRequest): string {
  const rules = [
    req.hazards.includes("mains") &&
      `The device runs on mains power and ${req.gatesPassed.includes("unplugged") ? "has been unplugged; it must stay unplugged while it's open" : "must be unplugged before it's opened"}. ` +
        "Flag plugged_in ONLY if you can see its plug pushed into a wall socket or extension board while the device is opened up or being worked on. " +
        "A plug lying loose, held in a hand, or out of view is NOT plugged in.",
    req.hazards.includes("moving_blade") && "It has a blade: flag hand_near_blade only if fingers are on or right next to a blade that could be powered.",
    req.hazards.includes("lithium_battery") && "It has a lithium battery: flag swollen_battery if a battery looks puffed up, bent or punctured.",
  ].filter(Boolean);
  return `You watch one frame from a phone camera during a home repair${req.object ? ` of a ${req.object}` : ""}.${
    req.step ? ` The current step: "${req.step}".` : ""
  }
${rules.join("\n")}
Also flag smoke_or_fire (smoke, sparks, flames) and water_near_power (water on or near something powered).
Reply with ONLY a JSON object, no other text:
{"hazard": null}  or  {"hazard": "${KINDS.join('" | "')}", "say": "under 15 calm words: what to do now", "where": "1-3 plain words for the thing, e.g. plug"}
Only flag what you can clearly see in THIS frame. When unsure, {"hazard": null}.`;
}

type Flag = { kind: string; say: string; where: string };

export function parseFlag(raw: string): Flag | null {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    const kind = typeof j.hazard === "string" ? j.hazard.trim().toLowerCase() : "";
    if (!kind || kind === "null" || kind === "none") return null;
    return {
      kind: (KINDS as readonly string[]).includes(kind) ? kind : "other",
      say: typeof j.say === "string" && j.say.trim() ? j.say.trim() : "Stop for a second, something doesn't look safe.",
      where: typeof j.where === "string" ? j.where.trim().split(/\s+/).slice(0, 3).join(" ") : "",
    };
  } catch {
    return null;
  }
}

let jsonModeOk = process.env.WATCHER_JSON_MODE !== "0";

export async function watchHazards(req: HazardRequest): Promise<HazardResponse> {
  const started = Date.now();
  const body = {
    model: WATCHER_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    messages: [
      { role: "system" as const, content: system(req) },
      {
        role: "user" as const,
        content: [
          { type: "image_url" as const, image_url: { url: req.frame.image } },
          { type: "text" as const, text: "The current frame. JSON only." },
        ],
      },
    ],
    ...lowReasoningParams(),
  };
  const call = (json: boolean) =>
    fireworks().chat.completions.create({
      ...body,
      ...(json ? { response_format: { type: "json_object" as const } } : {}),
    } as Parameters<ReturnType<typeof fireworks>["chat"]["completions"]["create"]>[0] & { stream?: false });

  let completion;
  try {
    completion = await call(jsonModeOk);
  } catch (err) {
    // Some deployments reject JSON mode for vision or reasoning models; drop it once and remember.
    if (!jsonModeOk || !/response_format|json|grammar|structured/i.test(String(err))) throw err;
    jsonModeOk = false;
    completion = await call(false);
  }

  const flag = parseFlag(completion.choices[0]?.message?.content ?? "");
  const quiet: HazardResponse = { hazard: null, model: WATCHER_LABEL, confirmed: false, ms: Date.now() - started };
  if (!flag) return quiet;

  // Second opinion from Muse Spark on the same frame before we stop someone mid-repair.
  const check = await spark<{ real: boolean; say: string; where: string }>(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `${system(req)}\n\nA first look at this frame flagged "${flag.kind}"${flag.where ? ` (${flag.where})` : ""}. ` +
              "Look carefully yourself. real = true only if that hazard is clearly visible in this frame right now. " +
              "say = under 15 calm spoken words telling them what to do. where = 1-3 plain words for the thing at fault.",
          },
          { type: "image_url", image_url: { url: req.frame.image } },
        ],
      },
    ],
    {
      schema: {
        name: "hazard_check",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["real", "say", "where"],
          properties: { real: { type: "boolean" }, say: { type: "string" }, where: { type: "string" } },
        },
      },
      effort: "minimal",
    },
  );
  if (!check.real) return { ...quiet, ms: Date.now() - started };

  const phrase = (check.where || flag.where).trim();
  const seg = phrase ? await sam(req.frame.image, phrase).catch(() => null) : null;
  return {
    hazard: {
      kind: flag.kind,
      say: check.say.trim() || flag.say,
      ...(phrase && { phrase }),
      ...(seg?.outlines.length && { outline: { width: seg.width || req.frame.width, height: seg.height || req.frame.height, outlines: seg.outlines } }),
    },
    model: WATCHER_LABEL,
    confirmed: true,
    ms: Date.now() - started,
  };
}
