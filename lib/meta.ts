// Server-side helpers for the Meta Model API. Never import this from client components:
// it reads MODEL_API_KEY.
import OpenAI from "openai";
import {
  decodeMaskToSVGPath,
  parseImageStream,
  recordsOfKind,
} from "@meta-sam/parser";
import type { Outline } from "./types";

export const BASE_URL = process.env.MODEL_BASE_URL ?? "https://api.meta.ai/v1";

export const MODELS = {
  spark: process.env.SPARK_MODEL ?? "muse-spark-1.3",
  sam: "sam-3.1",
  image: "muse-image-1.0",
  transcribe: "muse-voice-transcribe-1.0",
} as const;

function apiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set. Put it in .env.local.");
  return key;
}

let client: OpenAI | undefined;
export function meta(): OpenAI {
  client ??= new OpenAI({ baseURL: BASE_URL, apiKey: apiKey() });
  return client;
}

// ---------- Muse Spark ----------

export type SparkContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type SparkMessage = {
  role: "system" | "user" | "assistant";
  content: string | SparkContent[];
};

/** One Spark call. Pass `schema` to get parsed JSON back instead of text. */
export async function spark<T = string>(
  messages: SparkMessage[],
  opts: {
    schema?: { name: string; schema: Record<string, unknown> };
    maxTokens?: number;
    /** Spark thinks before answering; "minimal" is fastest (~1.2s vs ~2s for a one-word reply). */
    effort?: "minimal" | "low" | "medium" | "high";
  } = {},
): Promise<T> {
  const res = await meta().chat.completions.create({
    model: MODELS.spark,
    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
    // Reasoning tokens count against this budget, so keep it generous.
    max_completion_tokens: opts.maxTokens ?? 2000,
    ...(opts.effort && { reasoning_effort: opts.effort as OpenAI.ReasoningEffort }),
    ...(opts.schema && {
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schema.name, schema: opts.schema.schema, strict: true },
      },
    }),
  });
  const text = res.choices[0]?.message?.content ?? "";
  return (opts.schema ? JSON.parse(text) : text) as T;
}

// ---------- SAM 3.1 ----------

export type Segmentation = { width: number; height: number; outlines: Outline[] };

/**
 * Outline every match for a short noun phrase ("gas lift cylinder") in one image.
 * `image` is a URL or a data: URL.
 */
export async function sam(image: string, phrase: string): Promise<Segmentation> {
  const stream = await meta().responses.create({
    model: MODELS.sam,
    stream: true,
    metadata: { mask_encoding: "one_bit" },
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: phrase },
          { type: "input_image", image_url: image, detail: "auto" },
        ],
      },
    ],
  });
  const result = await parseImageStream(stream).finalResult;

  // Frame size comes from the box tokens (w=, h=) in the raw output.
  const size = /w=(\d+);h=(\d+)/.exec(result.rawOutput);
  const masks = new Map(recordsOfKind(result.records, "mask").map((m) => [m.objectId, m]));

  const outlines = recordsOfKind(result.records, "box").map((b) => {
    const m = masks.get(b.objectId);
    return {
      id: b.objectId,
      box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      // Mask paths are local to the mask's own bounds, so shift them into image space.
      path: m ? shiftPath(decodeMaskToSVGPath(m.mask), m.bounds.left, m.bounds.top) : "",
    };
  });

  return {
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    outlines,
  };
}

/** Offsets every absolute x,y pair in an SVG path made of M/L/H/V/Z commands. */
function shiftPath(d: string, dx: number, dy: number): string {
  return d.replace(/([MLHV])([^MLHVZ]*)/gi, (_, cmd: string, args: string) => {
    const nums = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const up = cmd.toUpperCase();
    if (cmd !== up) return cmd + args; // relative commands need no shift
    if (up === "H") return "H" + nums.map((x) => x + dx).join(" ");
    if (up === "V") return "V" + nums.map((y) => y + dy).join(" ");
    const out: number[] = [];
    for (let i = 0; i < nums.length; i += 2) out.push(nums[i] + dx, nums[i + 1] + dy);
    return up + out.join(" ");
  });
}

// ---------- Muse Voice Transcribe ----------

/** Transcribe a mono 16-bit PCM WAV (16 or 24 kHz). */
export async function transcribe(wav: Blob, keywords: string[] = []): Promise<string> {
  const form = new FormData();
  form.append(
    "request",
    new Blob(
      [
        JSON.stringify({
          mode: "PUSH_TO_TALK",
          model: MODELS.transcribe,
          audioEncoding: "WAV",
          ...(keywords.length && { keywords }),
        }),
      ],
      { type: "application/json" },
    ),
  );
  form.append("audio", wav, "clip.wav");

  const res = await fetch(`${BASE_URL}/asr/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
    body: form,
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { transcript: string };
  return json.transcript;
}

// ---------- Muse Image ----------

/** Generate an image, or edit `references` (data: URLs) when given. Returns a data: URL. */
export async function image(prompt: string, references: string[] = []): Promise<string> {
  const res = await fetch(`${BASE_URL}/images/${references.length ? "edits" : "generations"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS.image,
      prompt,
      n: 1,
      ...(references.length
        ? { images: references.map((url) => ({ image_url: url })) }
        : { output_format: "jpeg" }),
    }),
  });
  if (!res.ok) throw new Error(`image ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { b64_json: string }[]; output_format?: string };
  return `data:image/${json.output_format ?? "webp"};base64,${json.data[0].b64_json}`;
}
