// The watcher: every few seconds the client sends a camera frame, Muse Glimmer (Meta open weights)
// describes it in one line, we keep that in the session's memory timeline, and very occasionally
// pass on something worth saying unprompted.
import type { MemoryEntry, WatchRequest, WatchResponse } from "./live-types";
import { fireworks, lowReasoningParams, WATCHER_LABEL, WATCHER_MODEL } from "./fireworks";
import { recent, remember, touchLast } from "./memory";

const MAX_TOKENS = Number(process.env.WATCHER_MAX_TOKENS) || 400; // includes Glimmer's (low) reasoning
const TEMPERATURE = 0.3; // Meta advises against 0 for Glimmer
const REMARK_GAP_MS = 20_000;
const SAME_SCENE = 0.7; // word overlap at or above this = "nothing changed", don't store again

const SYSTEM = `You are the eyes of a hands-free helper app. You see one frame from the person's phone camera.
Reply with ONLY a JSON object, no other text:
{"caption": "...", "objects": ["..."], "remark": null}

caption: what is in view, at most 15 words, plain and concrete. Mention where small things sit
  ("keys on the desk next to the laptop"), since the person may later ask where they left something.
objects: up to 8 notable things in view, plain everyday words ("keys", "screwdriver", "chair seat").
remark: almost always null. Only a short sentence (under 15 words) if the person clearly needs to hear it now:
  a real safety hazard (exposed wire, hot pan near a hand, sharp blade pointed at fingers), an obvious mistake
  (part fitted upside down, wrong screw), or something important that just changed. Never describe the scene,
  never chat, never repeat an earlier remark. When in doubt, null.`;

type Parsed = { caption: string; objects: string[]; remark: string | null };

// Per-session remark throttle: at most one every REMARK_GAP_MS, never the same one twice in a row.
const remarkState = new Map<string, { at: number; text: string }>();

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

function overlap(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

const entryText = (e: Pick<MemoryEntry, "caption" | "objects">) => `${e.caption} ${e.objects.join(" ")}`;

function clampWords(s: string, n: number): string {
  const parts = s.trim().replace(/\s+/g, " ").split(" ");
  return parts.length > n ? parts.slice(0, n).join(" ") : parts.join(" ");
}

/** Glimmer's text → {caption, objects, remark}. Tolerates code fences, think tags and stray prose. */
export function parseWatcherReply(raw: string): Parsed {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const caption = typeof j.caption === "string" ? j.caption : "";
      const objects = Array.isArray(j.objects) ? j.objects.filter((o): o is string => typeof o === "string") : [];
      const remark = typeof j.remark === "string" ? j.remark : null;
      if (caption.trim()) return clean({ caption, objects, remark });
    } catch {
      // fall through to caption-only
    }
  }
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  return clean({ caption: firstLine.replace(/^["'{\s]+|["'}\s]+$/g, ""), objects: [], remark: null });
}

function clean(p: Parsed): Parsed {
  const objects = [
    ...new Set(
      p.objects
        .map((o) => clampWords(o.toLowerCase().replace(/[^a-z0-9 \-]/g, ""), 3))
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const r = p.remark?.trim() ?? "";
  const remark = !r || /^(null|none|n\/a|nothing)\.?$/i.test(r) ? null : clampWords(r, 20);
  return { caption: clampWords(p.caption, 15), objects, remark };
}

function throttleRemark(sessionId: string, remark: string | null, now: number): string | null {
  if (!remark) return null;
  const last = remarkState.get(sessionId);
  if (last && now - last.at < REMARK_GAP_MS) return null;
  if (last && overlap(last.text, remark) >= 0.8) return null;
  remarkState.set(sessionId, { at: now, text: remark });
  return remark;
}

let jsonModeOk = process.env.WATCHER_JSON_MODE !== "0";

export async function watch(req: WatchRequest): Promise<WatchResponse> {
  const started = Date.now();
  const before = recent(req.sessionId, 2);
  const context = before.length
    ? `Earlier frames, oldest first:\n${before.map((e) => `- ${e.caption}`).join("\n")}\nNote anything that changed.`
    : "This is the first frame.";

  const body = {
    model: WATCHER_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [
      { role: "system" as const, content: SYSTEM },
      {
        role: "user" as const,
        content: [
          { type: "image_url" as const, image_url: { url: req.frame.image } },
          { type: "text" as const, text: `${context}\nNow the current frame. JSON only.` },
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

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = parseWatcherReply(raw);
  const now = Date.now();

  if (parsed.caption) {
    const last = before.at(-1);
    if (last && overlap(entryText(last), entryText(parsed)) >= SAME_SCENE) touchLast(req.sessionId, now);
    else remember(req.sessionId, { t: now, caption: parsed.caption, objects: parsed.objects });
  }

  return {
    caption: parsed.caption,
    objects: parsed.objects,
    remark: throttleRemark(req.sessionId, parsed.remark, now),
    model: WATCHER_LABEL,
    ms: Date.now() - started,
  };
}
