// Joins comparison findings to the photos and defects they point at.
import type { Comparison, Defect, Finding, Frame, Inspection } from "@/lib/inspect/types";

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

export const photoCount = (inspection: Inspection, room: string) =>
  inspection.rooms.filter((r) => r.name === room).reduce((n, r) => n + r.frames.length, 0);
