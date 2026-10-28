import type { Step } from "./types";

// Placeholder steps for a generic office chair, used until the real manual is parsed by Muse Spark.
// `part` phrases are ones SAM 3.1 found on a Gravita photo. It finds nothing for "gas lift",
// "gas lift cylinder" or "chair cylinder", but "seat post" outlines the gas lift exactly.
export const DEMO_STEPS: Step[] = [
  { instruction: "Lay the five-star base flat and push a caster into each leg until it clicks.", part: "wheel" },
  { instruction: "Drop the gas lift into the hole in the middle of the base.", part: "seat post" },
  { instruction: "Attach the armrests to the sides of the seat with the long bolts.", part: "armrest" },
  { instruction: "Lower the seat onto the gas lift and sit down firmly to lock it in.", part: "chair seat" },
  { instruction: "Slide the headrest onto the top of the backrest until it locks.", part: "headrest" },
];
