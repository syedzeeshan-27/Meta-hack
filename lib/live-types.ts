// Contracts shared by the live screen (client), the brain (/api/live) and the watcher (/api/watch).
// Change these only by agreement: three parts of the app are built against them.
import type { Guide, Outline } from "./types";

export type Frame = { image: string; width: number; height: number };

// ---------- /api/live : ask anything, streamed back as Server-Sent Events ----------

export type LiveRequest = {
  /** Stable per browser tab; keys the memory timeline. */
  sessionId: string;
  question: string;
  /** Camera frame at the moment the person stopped talking (JPEG data URL, ~768 px). */
  frame: Frame;
  /** The step guide in progress, if the person started one. */
  guide?: Guide;
  stepIndex?: number;
  /** Last few exchanges, oldest first, so follow-ups like "and how much is it?" work. */
  history?: { question: string; answer: string }[];
};

/** One SSE `data:` line each, JSON-encoded. The stream always ends with `done` or `error`. */
export type LiveEvent =
  | { type: "text"; delta: string }
  | { type: "outline"; phrase: string; width: number; height: number; outlines: Outline[] }
  | { type: "sources"; items: { title: string; url: string }[] }
  | { type: "guide"; guide: Guide }
  | { type: "step"; stepIndex: number }
  | { type: "status"; message: string }
  | { type: "done"; ms: number }
  | { type: "error"; message: string };

// ---------- /api/watch : the open-weights watcher, polled every few seconds ----------

export type WatchRequest = { sessionId: string; frame: Frame };

export type WatchResponse = {
  /** One line describing what the camera sees. */
  caption: string;
  /** Notable objects in view, plain words. */
  objects: string[];
  /** Something worth saying out loud without being asked, or null. Throttled server-side. */
  remark: string | null;
  /** Which model produced it, for the UI and the open-weights prize ("muse-glimmer @ fireworks"). */
  model: string;
  ms: number;
};

// ---------- memory ----------

export type MemoryEntry = {
  /** ms since epoch */
  t: number;
  caption: string;
  objects: string[];
};
