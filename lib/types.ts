// Shapes shared by the API routes and the client.

export type Step = {
  /** What to do, said out loud and shown on the card. */
  instruction: string;
  /** Short plain noun phrase SAM can find, e.g. "seat post" (not "gas lift cylinder"). */
  part: string;
  /** What the step looks like when it's done, used to check the user's work. */
  check?: string;
};

export type PartItem = { name: string; phrase: string; count: number };

export type Guide = {
  product: string;
  /** "manual": read from the user's manual photos. "web": from web pages. "typical": standard steps for this kind of product. */
  basis: "manual" | "web" | "typical";
  parts: PartItem[];
  steps: Step[];
  /** Where the steps came from: the user's manual photos and/or web pages. */
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

export type SegmentResponse = {
  width: number;
  height: number;
  outlines: Outline[];
  ms: number;
  fake?: boolean;
};
