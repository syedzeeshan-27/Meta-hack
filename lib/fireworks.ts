// OpenAI-compatible client for the watcher's open-weight model (Meta Muse Glimmer 30B).
// Server-side only: it reads API keys.
//
// Where Glimmer runs (as of 2026-10-28):
//  - Fireworks dropped Glimmer from SERVERLESS on 2026-09-25. It still runs there as an on-demand
//    (dedicated GPU) deployment. Then set WATCHER_MODEL to the deployment-qualified id, e.g.
//    "accounts/fireworks/models/muse-glimmer-30b#accounts/<your-account>/deployments/<id>".
//  - Or our own vLLM server on Modal (modal/glimmer.py). Then set
//    WATCHER_BASE_URL=https://<workspace>--fixcam-glimmer-serve.modal.run/v1
//    WATCHER_API_KEY=<the key you put in the Modal secret>
//    WATCHER_MODEL=muse-glimmer
import OpenAI from "openai";

export const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
export const GLIMMER_FIREWORKS_ID = "accounts/fireworks/models/muse-glimmer-30b";
// Glimmer is off Fireworks serverless, but Meta's other open-weight model is on it (checked 2026-10-28:
// image input works, ~5.7s per frame with low reasoning). Both count for the open-weights prize.
export const SPARK_OPEN_FIREWORKS_ID = "accounts/fireworks/models/muse-spark-open";

// With no open-weight host configured yet, fall back to Muse Spark on the Meta Model API so the
// watcher still works (it just isn't the open-weights build until WATCHER_* or FIREWORKS_API_KEY is set).
const OPEN_WEIGHTS_KEY =
  process.env.WATCHER_API_KEY || (!process.env.WATCHER_BASE_URL ? process.env.FIREWORKS_API_KEY : undefined);
const USE_META_FALLBACK = !OPEN_WEIGHTS_KEY && Boolean(process.env.MODEL_API_KEY);

export const WATCHER_BASE_URL = USE_META_FALLBACK
  ? process.env.MODEL_BASE_URL || "https://api.meta.ai/v1"
  : process.env.WATCHER_BASE_URL || FIREWORKS_BASE_URL;
export const WATCHER_MODEL = USE_META_FALLBACK
  ? "muse-spark-1.3"
  : process.env.WATCHER_MODEL || SPARK_OPEN_FIREWORKS_ID;

/** Which partner serves the model, for the UI label ("muse-glimmer @ fireworks"). */
export const WATCHER_HOST: "fireworks" | "modal" | "meta" | "custom" = USE_META_FALLBACK
  ? "meta"
  : WATCHER_BASE_URL.includes("fireworks.ai")
    ? "fireworks"
    : WATCHER_BASE_URL.includes("modal.run")
      ? "modal"
      : "custom";

export const WATCHER_LABEL = USE_META_FALLBACK
  ? "muse-spark @ meta (fallback)"
  : `${WATCHER_MODEL.includes("glimmer") ? "muse-glimmer" : WATCHER_MODEL.includes("spark-open") ? "muse-spark-open" : WATCHER_MODEL} @ ${WATCHER_HOST}`;

function watcherKey(): string | undefined {
  return USE_META_FALLBACK ? process.env.MODEL_API_KEY : OPEN_WEIGHTS_KEY;
}

/** True when a key is configured for the chosen endpoint. The route returns 503 otherwise. */
export function watcherConfigured(): boolean {
  return Boolean(watcherKey());
}

let client: OpenAI | undefined;
export function fireworks(): OpenAI {
  const apiKey = watcherKey();
  if (!apiKey) throw new Error("No watcher key: set FIREWORKS_API_KEY (or WATCHER_API_KEY for Modal) in .env.local.");
  client ??= new OpenAI({ baseURL: WATCHER_BASE_URL, apiKey, timeout: 15_000, maxRetries: 0 });
  return client;
}

/**
 * Glimmer reasons before answering. Keep that short for the watcher.
 * Fireworks takes `reasoning_effort`; Meta's chat template reads `chat_template_kwargs.reasoning_strength`
 * (low | medium | high | xhigh), which vLLM passes through to the template.
 */
export function lowReasoningParams(): Record<string, unknown> {
  if (WATCHER_HOST === "meta") return { reasoning_effort: "minimal" };
  return WATCHER_HOST === "fireworks"
    ? { reasoning_effort: "low" }
    : { chat_template_kwargs: { reasoning_strength: "low" } };
}
