// Writes a fake move-in + move-out pair and a finished comparison through lib/store, so /r/<id> renders
// without any model calls. Same photo for every frame; the outlines are hand-drawn, not SAM.
//
//   npx tsx scripts/report-fixture.mts [photo.jpg]
import { readFile } from "node:fs/promises";
import { getComparison, getInspection, saveComparison, saveInspection, savePhoto } from "../lib/store";
import type { Comparison, Defect, Frame, Inspection } from "../lib/inspect/types";

const DEFAULT_PHOTO =
  "C:\\Users\\SYEDZE~1\\AppData\\Local\\Temp\\claude\\C--Metahack\\70cee906-017b-4e46-a267-3711159f96f9\\scratchpad\\real_front.jpg";
const MOVE_IN_ID = "fixture-movein";
const MOVE_OUT_ID = "fixture-moveout";
const MOVE_IN_AT = Date.parse("2025-10-12T10:30:00+05:30");
const MOVE_OUT_AT = Date.parse("2026-10-26T17:00:00+05:30");

/** Width and height from the JPEG's SOF marker. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error("Not a JPEG (no SOF marker)");
}

const jpeg = await readFile(process.argv[2] ?? DEFAULT_PHOTO);
const { width, height } = jpegSize(jpeg);

/** A fake SAM outline: path in mask pixels, placed with translate + scale like the real ones. */
function defect(id: string, phrase: string, description: string, severity: Defect["severity"], path: string, transform: string): Defect {
  return {
    id,
    phrase,
    description,
    severity,
    outline: {
      width,
      height,
      via: "name",
      outlines: [{ id: `${id}-o`, box: { left: 0, top: 0, right: 0, bottom: 0 }, path, transform }],
    },
  };
}

// Shapes drawn for the 683x911 chair photo (white mark on wall, seat, floor, skirting).
const WALL_MARK = ["M0 6 C 6 0, 26 -2, 32 6 C 34 14, 24 22, 12 22 C 2 20, -2 12, 0 6 Z", "translate(520 221)"];
const SEAT_TEAR = ["M4 10 C 20 0, 150 -2, 170 8 C 176 18, 170 32, 150 36 C 110 40, 50 40, 15 34 C 0 30, -2 18, 4 10 Z", "translate(165 443) scale(2)"];
const FLOOR_CRACK = ["M0 0 L30 18 L55 22 L90 50 L86 55 L52 28 L27 24 L-3 5 Z", "translate(380 745)"];
const SKIRTING = ["M0 4 C 20 0, 60 0, 80 4 L 80 16 C 60 20, 20 20, 0 16 Z", "translate(40 616)"];

async function frame(key: string, t: number, items: string[], defects: Defect[]): Promise<Frame> {
  const { url, sha256 } = await savePhoto(`fixture/${key}`, jpeg);
  return { id: key, t, imageUrl: url, sha256, width, height, items, defects, status: "indexed", indexedBy: "fixture (no model)" };
}

const minutes = (n: number) => n * 60_000;

const moveIn: Inspection = {
  id: MOVE_IN_ID,
  kind: "move_in",
  property: "Flat 302, Sunrise Residency, Koramangala",
  city: "Bengaluru",
  createdAt: MOVE_IN_AT,
  finishedAt: MOVE_IN_AT + minutes(14),
  rooms: [
    {
      name: "Living room",
      notes: [{ t: MOVE_IN_AT + minutes(2), text: "Small white mark on the wall, right of the chair." }],
      frames: [
        await frame("in-living-1", MOVE_IN_AT + minutes(1), ["chair", "wall", "floor tiles", "skirting"], [
          defect("d-in-wall", "white mark on wall", "Small white mark on the wall to the right of the chair.", "minor", WALL_MARK[0], WALL_MARK[1]),
        ]),
      ],
    },
    {
      name: "Bedroom",
      notes: [],
      frames: [await frame("in-bedroom-1", MOVE_IN_AT + minutes(8), ["chair", "floor tiles", "skirting", "curtain rod"], [])],
    },
  ],
};

const moveOut: Inspection = {
  id: MOVE_OUT_ID,
  kind: "move_out",
  baselineId: MOVE_IN_ID,
  property: moveIn.property,
  city: moveIn.city,
  createdAt: MOVE_OUT_AT,
  finishedAt: MOVE_OUT_AT + minutes(12),
  rooms: [
    {
      name: "Living room",
      notes: [],
      frames: [
        await frame("out-living-1", MOVE_OUT_AT + minutes(1), ["chair", "wall", "floor tiles", "skirting"], [
          defect("d-out-wall", "white mark on wall", "Small white mark on the wall to the right of the chair.", "minor", WALL_MARK[0], WALL_MARK[1]),
          defect("d-out-seat", "tear in seat cushion", "Fabric on the chair seat is torn across the front edge.", "moderate", SEAT_TEAR[0], SEAT_TEAR[1]),
        ]),
      ],
    },
    {
      name: "Bedroom",
      notes: [],
      frames: [
        await frame("out-bedroom-1", MOVE_OUT_AT + minutes(7), ["chair", "floor tiles", "skirting"], [
          defect("d-out-crack", "crack in floor tile", "Diagonal crack in a floor tile in front of the chair.", "major", FLOOR_CRACK[0], FLOOR_CRACK[1]),
          defect("d-out-skirting", "scuff on skirting", "Light scuffing along the skirting near the corner.", "minor", SKIRTING[0], SKIRTING[1]),
        ]),
      ],
    },
  ],
};

const comparison: Comparison = {
  inspectionId: MOVE_OUT_ID,
  baselineId: MOVE_IN_ID,
  createdAt: MOVE_OUT_AT + minutes(15),
  findings: [
    {
      room: "Living room",
      status: "new",
      summary: "Tear in the chair's seat cushion",
      severity: "moderate",
      before: { frameId: "in-living-1" },
      after: { frameId: "out-living-1", defectId: "d-out-seat" },
      repair: "Re-upholster the seat: new fabric cover, foam reused if intact.",
      cost: {
        low: 1200,
        high: 2500,
        currency: "INR",
        sources: [
          { title: "Furniture repair in Bengaluru (fixture link)", url: "https://www.urbancompany.com/" },
          { title: "Chair repair services (fixture link)", url: "https://www.justdial.com/" },
        ],
      },
    },
    {
      room: "Bedroom",
      status: "new",
      summary: "Cracked floor tile",
      severity: "major",
      before: { frameId: "in-bedroom-1" },
      after: { frameId: "out-bedroom-1", defectId: "d-out-crack" },
      repair: "Replace one vitrified floor tile and re-grout.",
      cost: {
        low: 1800,
        high: 3500,
        currency: "INR",
        sources: [{ title: "Tile replacement cost (fixture link)", url: "https://www.urbancompany.com/" }],
      },
    },
    {
      room: "Living room",
      status: "pre_existing",
      summary: "White mark on the wall, right of the chair",
      severity: "minor",
      before: { frameId: "in-living-1", defectId: "d-in-wall" },
      after: { frameId: "out-living-1", defectId: "d-out-wall" },
    },
    {
      room: "Bedroom",
      status: "wear",
      summary: "Light scuffing on the skirting",
      severity: "minor",
      before: { frameId: "in-bedroom-1" },
      after: { frameId: "out-bedroom-1", defectId: "d-out-skirting" },
    },
  ],
  missingItems: [{ room: "Bedroom", item: "curtain rod" }],
  total: { low: 3000, high: 6000, currency: "INR" },
  models: [
    "Fixture data: no models were called for this report.",
    "Real reports list the indexer, outline (SAM) and comparison models here.",
  ],
};

await saveInspection(moveIn);
await saveInspection(moveOut);
await saveComparison(comparison);

// Read back through the store, the same way the report page does.
const ok = (await getInspection(MOVE_OUT_ID))?.baselineId === MOVE_IN_ID && (await getComparison(MOVE_OUT_ID))?.findings.length === 4;
console.log(`photo ${width}x${height}, read-back ${ok ? "ok" : "FAILED"}`);
console.log(`Fixture id: ${MOVE_OUT_ID}  ->  http://localhost:3000/r/${MOVE_OUT_ID}`);
