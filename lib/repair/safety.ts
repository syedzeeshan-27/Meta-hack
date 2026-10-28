// Safety rules, in code. The model only tags hazards; whether someone may open the thing, and which
// checkpoints must pass on camera first, is decided here, so a confident-sounding model can't talk past them.
import type { Gate, Step } from "../types";
import { HAZARDS, type Hazard, type RepairPath } from "./types";

/** Any of these and we don't guide the repair: it goes to a shop. */
const SHOP_ONLY: Partial<Record<Hazard, string>> = {
  high_voltage: "parts inside can hold a dangerous charge even when it's unplugged",
  gas: "it involves a gas supply",
  refrigerant: "it involves the sealed cooling gas",
  swollen_battery: "a swollen battery can catch fire if it's pressed or punctured",
};

/** Fine to fix yourself, with care. */
const CAREFUL: Partial<Record<Hazard, string>> = {
  mains: "it runs on mains power",
  lithium_battery: "it has a lithium battery that mustn't be punctured or bent",
  moving_blade: "it has a sharp blade",
  heat: "parts of it get hot",
  spring: "there's a spring under tension",
  water: "it's around water",
  glass: "there's glass that can break",
};

export function cleanHazards(raw: unknown): Hazard[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((h): h is Hazard => (HAZARDS as readonly string[]).includes(h)))];
}

export function decidePath(hazards: Hazard[]): RepairPath {
  if (hazards.some((h) => h in SHOP_ONLY)) return "shop";
  if (hazards.some((h) => h in CAREFUL)) return "careful";
  return "diy";
}

export function gatesFor(hazards: Hazard[]): Gate[] {
  const gates: Gate[] = [];
  if (hazards.includes("mains")) gates.push("unplugged");
  // Unplugging stops a mains blade; a battery or hand-driven blade needs its own check.
  if (hazards.includes("moving_blade") && !hazards.includes("mains")) gates.push("blade_stopped");
  if (hazards.includes("heat")) gates.push("cooled");
  return gates;
}

const GATE_WORDS: Record<Gate, string> = {
  unplugged: "unplug it",
  cooled: "let it cool down",
  blade_stopped: "make sure the blade can't move",
};

/** The spoken safety line for a verdict. Written here, not by the model. */
export function safetyLine(path: RepairPath, hazards: Hazard[], gates: Gate[]): string {
  if (path === "shop") {
    const why = hazards.map((h) => SHOP_ONLY[h]).filter(Boolean);
    return `Please don't open this one yourself: ${why.join(", and ")}. A repair shop should do it, and I'll find some near you.`;
  }
  if (path === "careful") {
    const why = hazards.map((h) => CAREFUL[h]).filter(Boolean);
    const first = gates.length ? ` We'll ${joinWords(gates.map((g) => GATE_WORDS[g]))} first, and I'll check that on camera.` : "";
    return `You can fix this yourself, carefully, since ${why.join(" and ")}.${first}`;
  }
  return "This is safe to fix yourself.";
}

/** The checkpoint steps put in front of every repair plan. Each has to pass a camera check. */
const GATE_STEPS: Record<Gate, Step> = {
  unplugged: {
    instruction: "Switch it off, pull the plug out of the socket, and hold the plug up to the camera.",
    part: "plug",
    check: "The power plug is out of the wall socket: held in a hand or lying loose, clearly not plugged in.",
    gate: "unplugged",
  },
  blade_stopped: {
    instruction: "Make sure the blade has completely stopped and can't be switched on, then show it to me.",
    part: "blade",
    check: "The blade is still and the device is switched off or its power source is removed.",
    gate: "blade_stopped",
  },
  cooled: {
    instruction: "Leave it switched off to cool for a few minutes, then show it to me.",
    part: "power switch",
    check: "The device is switched off and unplugged, with no glowing or steaming parts.",
    gate: "cooled",
  },
};

export function gateSteps(gates: Gate[]): Step[] {
  return gates.map((g) => GATE_STEPS[g]);
}

/** The first step the guide may not move past yet (a gate that hasn't passed), or -1. */
export function firstOpenGate(steps: Step[], passed: Gate[]): number {
  return steps.findIndex((s) => s.gate && !passed.includes(s.gate));
}

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}
