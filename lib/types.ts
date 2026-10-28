// Shapes shared by the API routes and the client.

/** A camera frame: JPEG data URL plus its pixel size. */
export type Frame = { image: string; width: number; height: number };

/** Safety checkpoints that have to pass (on camera) before a repair's real steps start. Decided in code. */
export type Gate = "unplugged" | "cooled" | "blade_stopped";

export type Step = {
  /** What to do, said out loud and shown on the card. */
  instruction: string;
  /** Short plain noun phrase SAM can find, e.g. "seat post" (not "gas lift cylinder"). */
  part: string;
  /** What the step looks like when it's done, used to check the person's work. */
  check?: string;
  /** True when SAM found `part` by name on the person's photos at planning time. */
  partVerified?: boolean;
  /** A safety checkpoint: the guide can't move past it until a camera check passes. */
  gate?: Gate;
};

export type PartItem = { name: string; phrase: string; count: number };

export type Guide = {
  product: string;
  /** "manual": from the person's manual photos. "web": from web pages. "typical": standard steps for this kind of job. */
  basis: "manual" | "web" | "typical";
  /** Tools and spare parts needed. */
  parts: PartItem[];
  steps: Step[];
  /** Where the steps came from. */
  sources: string[];
};

export type Outline = {
  id: string;
  box: { left: number; top: number; right: number; bottom: number };
  /** Outline in mask pixels; draw it with `transform` to land on the image. */
  path: string;
  /** SVG transform that places the mask onto the image (translate + scale). */
  transform: string;
};

/** Outlines in one photo's pixel space (for stored photos on the repair card). */
export type PhotoOutline = { width: number; height: number; outlines: Outline[] };

export type SegmentResponse = {
  width: number;
  height: number;
  outlines: Outline[];
  /** "name": SAM found it by name. "pointed": Spark pointed, SAM outlined from the point. */
  via: "name" | "pointed" | "none";
  ms: number;
  fake?: boolean;
};
