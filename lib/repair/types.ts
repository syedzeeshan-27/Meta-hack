// Contracts for the repair flow, shared by the fix screen (client) and the API routes.
// The server keeps no repair state: the client holds RepairState and sends it with every turn.
import type { Frame, Gate, Guide, Outline } from "../types";

export type Source = { title: string; url: string };
export type Money = { low: number; high: number; currency: "INR" };

export type RepairObject = { name: string; brand?: string; model?: string };

/** One possible cause on the diagnosis board. likelihood is 0-100; the board's causes add up to ~100. */
export type Cause = { text: string; likelihood: number; why: string };

/** look: show me something. do: try something and tell me. say: answer a question. listen: the app records the device. */
export type TestKind = "look" | "do" | "say" | "listen";
export type Test = { ask: string; kind: TestKind; result?: string };

/** What the model tags; what to do about each tag is decided in lib/repair/safety.ts. */
export const HAZARDS = [
  "mains",
  "lithium_battery",
  "swollen_battery",
  "high_voltage",
  "gas",
  "refrigerant",
  "moving_blade",
  "heat",
  "spring",
  "water",
  "glass",
] as const;
export type Hazard = (typeof HAZARDS)[number];

/** diy: fix it yourself. careful: yourself, after the safety gates. shop: don't open it, take it to a repair shop. */
export type RepairPath = "diy" | "careful" | "shop";

export type Verdict = {
  cause: string;
  confidence: number;
  hazards: Hazard[];
  path: RepairPath;
  gates: Gate[];
  /** Plain-English safety line, written in code from the hazards. */
  safety: string;
};

export type Research = {
  /** "model": sources for this exact model. "similar": sources for this kind of device. "general": nothing found online. Decided in code. */
  basis: "model" | "similar" | "general";
  part?: { name: string; price?: Money };
  newPrice?: Money;
  /** What the sources say about doing this repair, in a sentence or two. */
  howto?: string;
  /** Rough weight of the device, for "e-waste avoided". */
  weightKg?: number;
  shops: Source[];
  sources: Source[];
  ms: number;
};

export type Stage = "intake" | "diagnosing" | "verdict" | "fixing" | "done";

export type RepairState = {
  id: string;
  city: string;
  startedAt: number;
  stage: Stage;
  object?: RepairObject;
  complaint?: string;
  causes: Cause[];
  /** Tests already done, with what came of them. */
  tests: Test[];
  /** The test the person is doing now. */
  nextTest?: Test;
  verdict?: Verdict;
  research?: Research;
  guide?: Guide;
  stepIndex: number;
  gatesPassed: Gate[];
  outcome?: { fixed: boolean; summary: string };
};

// ---------- /api/fix : one turn, streamed back as Server-Sent Events ----------

export type FixRequest = {
  question: string;
  frame: Frame;
  repair: RepairState;
  /** Last few exchanges, oldest first. */
  history?: { question: string; answer: string }[];
};

/** One SSE `data:` line each. The stream always ends with `done` or `error`. */
export type FixEvent =
  | { type: "text"; delta: string }
  | { type: "status"; message: string }
  | { type: "sources"; items: Source[] }
  | { type: "outline"; phrase: string; width: number; height: number; outlines: Outline[]; tone: "info" | "new" }
  | {
      type: "diagnosis";
      object?: RepairObject;
      complaint?: string;
      causes: Cause[];
      tests: Test[];
      nextTest: Test | null;
    }
  | { type: "verdict"; verdict: Verdict }
  | { type: "guide"; guide: Guide }
  | { type: "step"; stepIndex: number }
  | { type: "check"; stepIndex: number; done: boolean; gate?: Gate }
  | { type: "listen"; ask: string; seconds: number }
  | { type: "finish"; fixed: boolean; summary: string }
  | { type: "done"; ms: number }
  | { type: "error"; message: string };

// ---------- /api/research ----------

export type ResearchRequest = {
  object: RepairObject;
  complaint?: string;
  cause: string;
  path: RepairPath;
  city: string;
};

// ---------- /api/hazard : the open-weights safety watcher ----------

export type HazardRequest = {
  frame: Frame;
  object?: string;
  step?: string;
  hazards: Hazard[];
  gatesPassed: Gate[];
};

export type HazardResponse = {
  hazard: null | {
    kind: string;
    say: string;
    phrase?: string;
    outline?: { width: number; height: number; outlines: Outline[] };
  };
  /** Which model watched, e.g. "muse-spark-open @ fireworks". */
  model: string;
  /** True when Muse Spark double-checked the frame before raising the alarm. */
  confirmed: boolean;
  ms: number;
};

// ---------- the repair card (/r/[id]) ----------

export type StoredPhoto = { url: string; width: number; height: number };

export type RepairCard = {
  id: string;
  createdAt: number;
  object: RepairObject;
  complaint?: string;
  causes: Cause[];
  tests: Test[];
  verdict?: Verdict;
  research?: Research;
  steps: string[];
  fixed: boolean;
  summary: string;
  before?: StoredPhoto;
  after?: StoredPhoto;
  minutes: number;
};

export type SaveRepairRequest = {
  repair: RepairState;
  before?: Frame;
  after?: Frame;
};
