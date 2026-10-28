// The client's copy of the repair (the server keeps none): created on Start, updated from /api/fix events,
// sent back with every turn.
import type { FixEvent, RepairState, Research } from "@/lib/repair/types";

/** Before Start: nothing random or time-based, so the page can be prerendered. */
export const NO_REPAIR: RepairState = { id: "", city: "", startedAt: 0, stage: "intake", causes: [], tests: [], stepIndex: 0, gatesPassed: [] };

/** A fresh repair. Call from an event handler (it reads the clock and makes a random id). */
export function newRepair(city: string): RepairState {
  return { ...NO_REPAIR, id: newId(), city, startedAt: Date.now() };
}

export function applyEvent(st: RepairState, ev: FixEvent): RepairState {
  switch (ev.type) {
    case "diagnosis":
      return {
        ...st,
        object: ev.object ?? st.object,
        complaint: ev.complaint ?? st.complaint,
        causes: ev.causes,
        tests: ev.tests,
        nextTest: ev.nextTest ?? undefined,
        stage: st.stage === "intake" ? "diagnosing" : st.stage,
      };
    case "verdict":
      return { ...st, verdict: ev.verdict, nextTest: undefined, stage: st.guide ? st.stage : "verdict" };
    case "guide":
      return { ...st, guide: ev.guide, stepIndex: 0, stage: "fixing" };
    case "step":
      return { ...st, stepIndex: ev.stepIndex };
    case "check":
      return ev.done && ev.gate && !st.gatesPassed.includes(ev.gate) ? { ...st, gatesPassed: [...st.gatesPassed, ev.gate] } : st;
    case "finish":
      return { ...st, outcome: { fixed: ev.fixed, summary: ev.summary }, stage: "done" };
    default:
      return st;
  }
}

export function withResearch(st: RepairState, research: Research): RepairState {
  return { ...st, research };
}

/** Words the speech model should expect right now: the object, brand, model, causes and parts. */
export function speechHints(st: RepairState): string[] {
  const words = [
    st.object?.name,
    st.object?.brand,
    st.object?.model,
    ...st.causes.map((c) => c.text),
    st.research?.part?.name,
    ...(st.guide?.parts.map((p) => p.name) ?? []),
  ];
  return [...new Set(words.filter((w): w is string => !!w && w.length <= 40))].slice(0, 10);
}

function newId(): string {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return raw.slice(0, 16);
}
