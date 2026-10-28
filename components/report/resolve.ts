// Joins comparison findings to the photos and defects they point at.
import type { Comparison, Defect, Finding, Frame, Inspection } from "@/lib/inspect/types";
import { clause } from "./format";

export type Shot = { frame: Frame; room: string; defect?: Defect };
export type ResolvedFinding = Finding & { beforeShot?: Shot; afterShot?: Shot };

function shotsById(inspection: Inspection): Map<string, Shot> {
  const map = new Map<string, Shot>();
  for (const room of inspection.rooms) for (const frame of room.frames) map.set(frame.id, { frame, room: room.name });
  return map;
}

function lookup(shots: Map<string, Shot>, ref?: { frameId: string; defectId?: string }): Shot | undefined {
  const shot = ref && shots.get(ref.frameId);
  if (!shot) return undefined;
  return { ...shot, defect: ref.defectId ? shot.frame.defects.find((d) => d.id === ref.defectId) : undefined };
}

/** before.frameId is looked up in the move-in, after.frameId in the move-out, so frame ids may repeat across the two. */
export function resolveFindings(moveIn: Inspection, moveOut: Inspection, findings: Finding[]): ResolvedFinding[] {
  const inShots = shotsById(moveIn);
  const outShots = shotsById(moveOut);
  return findings.map((f) => ({ ...f, beforeShot: lookup(inShots, f.before), afterShot: lookup(outShots, f.after) }));
}

/** Move-out room order first, then any room only seen at move-in or only named by a finding. */
export function roomOrder(moveIn: Inspection, moveOut: Inspection, comparison: Comparison): string[] {
  const names = [
    ...moveOut.rooms.map((r) => r.name),
    ...moveIn.rooms.map((r) => r.name),
    ...comparison.findings.map((f) => f.room),
    ...comparison.missingItems.map((m) => m.room),
  ];
  return [...new Set(names)];
}

/** Stable sort by room, so each room's findings sit together (print breaks the page between rooms). */
export function sortByRoom<T extends { room: string }>(items: T[], rooms: string[]): T[] {
  const index = new Map(rooms.map((r, i) => [r, i]));
  return [...items].sort((a, b) => (index.get(a.room) ?? rooms.length) - (index.get(b.room) ?? rooms.length));
}

export const frameCount = (inspection: Inspection) => inspection.rooms.reduce((n, r) => n + r.frames.length, 0);

/** "Bedroom at move-out: crack near switchboard, outlined" */
export function photoAlt(room: string, when: "move-in" | "move-out", defect?: Defect, clean = false): string {
  if (defect) return `${room} at ${when}: ${clause(defect.description)}${defect.outline ? ", outlined" : ""}`;
  return clean ? `${room} at ${when}: the same spot, nothing marked` : `${room} at ${when}`;
}
