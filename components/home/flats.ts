import type { Inspection } from "@/lib/inspect/types";

/** What this flat needs next. Exactly one per flat. */
export type NextStep =
  | { kind: "continue_move_in"; inspection: Inspection }
  | { kind: "start_move_out"; baseline: Inspection }
  | { kind: "continue_move_out"; inspection: Inspection }
  | { kind: "view_report"; inspection: Inspection };

export type Flat = {
  /** Normalised property name: trimmed, single spaces, lower case. */
  key: string;
  /** As the renter last typed it. */
  name: string;
  city: string;
  /** The move-in of the current cycle (missing only if a move-out's baseline is gone). */
  moveIn?: Inspection;
  /** The move-out of the current cycle, if one was started. */
  moveOut?: Inspection;
  next: NextStep;
  /** Every inspection id in this flat, for "?saved=<id>" highlighting. */
  ids: string[];
  /** Latest activity, for ordering. */
  updatedAt: number;
};

export function flatKey(property: string): string {
  return property.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Groups inspections into flats by normalised property name. A move-out joins the flat of the move-in it's
 * compared against, so a later rename can't split a pair. The newest inspection decides the current cycle:
 * - newest is a move-in: unfinished → Continue move-in; finished → Start move-out (against it)
 * - newest is a move-out: unfinished → Continue move-out; finished → View report
 */
export function groupFlats(list: Inspection[]): Flat[] {
  const byId = new Map(list.map((i) => [i.id, i]));
  const keyOf = (i: Inspection) => {
    const baseline = i.kind === "move_out" && i.baselineId ? byId.get(i.baselineId) : undefined;
    return flatKey(baseline?.property ?? i.property);
  };

  const groups = new Map<string, Inspection[]>();
  for (const i of [...list].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = keyOf(i);
    const items = groups.get(key);
    if (items) items.push(i);
    else groups.set(key, [i]);
  }

  return [...groups.entries()]
    .map(([key, items]) => toFlat(key, items, byId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function toFlat(key: string, items: Inspection[], byId: Map<string, Inspection>): Flat {
  const newest = items[0];
  const common = {
    key,
    name: newest.property.trim(),
    city: newest.city.trim(),
    ids: items.map((i) => i.id),
    updatedAt: Math.max(...items.map((i) => Math.max(i.createdAt, i.finishedAt ?? 0))),
  };

  if (newest.kind === "move_out") {
    const moveIn = (newest.baselineId && byId.get(newest.baselineId)) || items.find((i) => i.kind === "move_in");
    return {
      ...common,
      moveIn,
      moveOut: newest,
      next: newest.finishedAt
        ? { kind: "view_report", inspection: newest }
        : { kind: "continue_move_out", inspection: newest },
    };
  }

  return {
    ...common,
    moveIn: newest,
    next: newest.finishedAt
      ? { kind: "start_move_out", baseline: newest }
      : { kind: "continue_move_in", inspection: newest },
  };
}
