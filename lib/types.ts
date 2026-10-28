// Shapes shared by the API routes and the client.

export type Step = {
  /** What to do, said out loud and shown on the card. */
  instruction: string;
  /** Short noun phrase SAM can find, e.g. "gas lift cylinder". */
  part: string;
};

export type Outline = {
  id: string;
  box: { left: number; top: number; right: number; bottom: number };
  path: string;
};

export type SegmentResponse = {
  width: number;
  height: number;
  outlines: Outline[];
  ms: number;
  fake?: boolean;
};
