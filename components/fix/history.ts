// Repair cards made on this device, newest first (localStorage; the cards themselves live on the server).

const KEY = "fixcam.repairs";
const MAX = 20;

export type SavedRepair = { id: string; title: string; fixed: boolean; at: number };

export function listRepairs(): SavedRepair[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((r): r is SavedRepair => typeof r?.id === "string" && typeof r?.title === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRepair(r: SavedRepair) {
  try {
    localStorage.setItem(KEY, JSON.stringify([r, ...listRepairs().filter((x) => x.id !== r.id)].slice(0, MAX)));
  } catch {
    // Private mode or storage full: the card still exists, it just won't be listed here.
  }
}
