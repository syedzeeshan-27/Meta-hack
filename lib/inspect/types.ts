// Deposit Guard contracts, shared by the walkthrough app, the analysis pipeline and the report.
// Change these only by agreement: three parts of the app are built against them.
import type { Outline } from "../types";

export type InspectionKind = "move_in" | "move_out";
export type Severity = "minor" | "moderate" | "major";

/** SAM outlines for one defect on one frame, in that frame's pixel space. */
export type DefectOutline = { width: number; height: number; outlines: Outline[]; via: "name" | "pointed" };

export type Defect = {
  id: string;
  /** Plain visual phrase SAM can find, e.g. "crack on wall", "brown stain". */
  phrase: string;
  /** One sentence a person would write in an inspection report. */
  description: string;
  severity: Severity;
  /** Missing when SAM couldn't localise it; the defect is still "noted". */
  outline?: DefectOutline;
};

export type Frame = {
  id: string;
  /** ms since epoch, when the phone captured it */
  t: number;
  /** URL the browser can load (local /api/files/... in dev, Blob URL in production). */
  imageUrl: string;
  /** SHA-256 of the JPEG bytes as stored, hex. Lets anyone check a photo wasn't edited later. */
  sha256: string;
  width: number;
  height: number;
  /** Fittings and items in view, plain words ("ceiling fan", "switchboard", "window"). */
  items: string[];
  defects: Defect[];
  /** "pending" while the open-weights indexer is still working on it. */
  status: "pending" | "indexed" | "failed";
  /** Which model indexed it, e.g. "muse-spark-open @ fireworks". */
  indexedBy?: string;
};

export type VoiceNote = { t: number; text: string };

export type Room = { name: string; notes: VoiceNote[]; frames: Frame[] };

export type Inspection = {
  id: string;
  kind: InspectionKind;
  /** For a move-out: the move-in inspection it's compared against. */
  baselineId?: string;
  /** Free text, e.g. "Flat 302, Koramangala". */
  property: string;
  /** Used for local repair prices, e.g. "Bengaluru". */
  city: string;
  createdAt: number;
  finishedAt?: number;
  rooms: Room[];
};

export type Money = { low: number; high: number; currency: string };

export type Finding = {
  room: string;
  status: "new" | "pre_existing" | "wear";
  /** Plain-English summary for the report. */
  summary: string;
  severity: Severity;
  /** The same spot at move-in, if it was found. */
  before?: { frameId: string; defectId?: string };
  after: { frameId: string; defectId: string };
  /** Only for status "new". */
  repair?: string;
  cost?: Money & { sources: { title: string; url: string }[] };
};

export type Comparison = {
  inspectionId: string;
  baselineId: string;
  createdAt: number;
  findings: Finding[];
  /** Items listed at move-in that weren't seen at move-out, per room. */
  missingItems: { room: string; item: string }[];
  /** Sum of cost ranges for "new" findings. */
  total: Money;
  /** Which models did what, for the report footer. */
  models: string[];
};

// ---------- API shapes (/api/inspections/**) ----------

export type CreateInspectionRequest = { kind: InspectionKind; property: string; city: string; baselineId?: string };
export type AddFrameRequest = { room: string; t: number; image: string /* JPEG data URL */; width: number; height: number };
export type AddFrameResponse = { frame: Frame };
export type AddNoteRequest = { room: string; t: number; text: string };
