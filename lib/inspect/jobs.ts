// In-process plumbing for Deposit Guard: a per-inspection lock so concurrent read-modify-writes don't lose
// updates, a limit of 3 frames indexing at once, and background comparison runs.
// State lives on globalThis so every route bundle (and dev hot reloads) share the same lock and queue.
// It is per process: on serverless, two instances can still race on one inspection (see the report notes).
import { getComparison, getInspection, photoDataUrl, saveComparison, saveInspection } from "../store";
import { buildComparison } from "./compare";
import { indexFrame } from "./index-frame";
import type { Comparison, Frame, Inspection, Room } from "./types";

const MAX_INDEXING = Number(process.env.INDEXING_CONCURRENCY) || 5;

type ComparisonState = { status: "running" | "done" | "failed"; startedAt: number; promise?: Promise<Comparison>; error?: string };
type JobState = {
  locks: Map<string, Promise<void>>;
  active: number;
  waiting: (() => void)[];
  /** inspection id → frame id → running index job */
  indexing: Map<string, Map<string, Promise<void>>>;
  comparisons: Map<string, ComparisonState>;
};

const KEY = Symbol.for("deposit-guard.jobs");
const holder = globalThis as unknown as Record<symbol, JobState | undefined>;
const state: JobState = (holder[KEY] ??= {
  locks: new Map(),
  active: 0,
  waiting: [],
  indexing: new Map(),
  comparisons: new Map(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- per-inspection lock ----------

/** Runs `fn` after every earlier `withLock(id, …)` call has settled. Calls for different ids don't wait on each other. */
export function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = state.locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  state.locks.set(id, tail);
  void tail.then(() => {
    if (state.locks.get(id) === tail) state.locks.delete(id);
  });
  return run;
}

/** Read, change and save one inspection under its lock. Returns null if it doesn't exist. */
export function updateInspection(
  id: string,
  mutate: (i: Inspection) => void | Promise<void>,
): Promise<Inspection | null> {
  return withLock(id, async () => {
    const i = await getInspection(id);
    if (!i) return null;
    await mutate(i);
    await saveInspection(i);
    return i;
  });
}

/** The room with this name (case-insensitive), created at the end if it's new. */
export function roomFor(i: Inspection, name: string): Room {
  const key = name.trim().toLowerCase();
  let room = i.rooms.find((r) => r.name.trim().toLowerCase() === key);
  if (!room) {
    room = { name: name.trim(), notes: [], frames: [] };
    i.rooms.push(room);
  }
  return room;
}

export const allFrames = (i: Inspection): Frame[] => i.rooms.flatMap((r) => r.frames);

// ---------- indexing queue (max 3 at once, process-wide) ----------

async function acquireSlot(): Promise<() => void> {
  if (state.active < MAX_INDEXING) state.active++;
  else await new Promise<void>((r) => state.waiting.push(r)); // the releaser hands its slot straight over
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = state.waiting.shift();
    if (next) next();
    else state.active--;
  };
}

export const indexingQueue = () => ({ active: state.active, waiting: state.waiting.length });

/**
 * Index one stored frame in the background and write the result into the inspection.
 * Resolves when the frame is saved as "indexed" or "failed"; never rejects.
 */
export function startIndexing(
  inspectionId: string,
  frameId: string,
  image: string,
  size: { width: number; height: number },
  room?: string,
): Promise<void> {
  const existing = state.indexing.get(inspectionId)?.get(frameId);
  if (existing) return existing;

  const job = (async () => {
    let result: Awaited<ReturnType<typeof indexFrame>> | undefined;
    const release = await acquireSlot();
    try {
      result = await indexFrame(image, size, { room });
      console.log(
        `[inspect] indexed ${inspectionId}/${frameId} in ${(result.ms / 1000).toFixed(1)}s: ` +
          `${result.items.length} items, ${result.defects.length} defects (${result.defects.filter((d) => d.outline).length} outlined)`,
      );
    } catch (err) {
      console.error(`[inspect] indexing ${inspectionId}/${frameId} failed: ${String(err).slice(0, 300)}`);
    } finally {
      release();
    }
    try {
      await updateInspection(inspectionId, (i) => {
        const frame = allFrames(i).find((f) => f.id === frameId);
        if (!frame) return;
        if (result) {
          frame.status = "indexed";
          frame.items = result.items;
          frame.defects = result.defects;
          frame.indexedBy = result.indexedBy;
        } else {
          frame.status = "failed";
        }
      });
    } catch (err) {
      console.error(`[inspect] saving index for ${inspectionId}/${frameId} failed: ${String(err).slice(0, 300)}`);
    }
  })();

  const jobs = state.indexing.get(inspectionId) ?? new Map<string, Promise<void>>();
  jobs.set(frameId, job);
  state.indexing.set(inspectionId, jobs);
  void job.finally(() => {
    jobs.delete(frameId);
    if (!jobs.size && state.indexing.get(inspectionId) === jobs) state.indexing.delete(inspectionId);
  });
  return job;
}

/**
 * Waits until no frame of the inspection is "pending" (or `timeoutMs` passes), then re-indexes any frame still
 * pending that no job in this process is working on (e.g. the dev server restarted mid-index).
 */
export async function settleIndexing(id: string, timeoutMs: number): Promise<Inspection | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const i = await getInspection(id);
    if (!i) return null;
    const pending = allFrames(i).filter((f) => f.status === "pending");
    if (!pending.length) return i;
    const mine = [...(state.indexing.get(id)?.values() ?? [])];
    const left = deadline - Date.now();
    if (left <= 0) {
      const orphans = pending.filter((f) => !state.indexing.get(id)?.has(f.id));
      if (!orphans.length) return i;
      console.warn(`[inspect] ${id}: re-indexing ${orphans.length} orphaned pending frame(s)`);
      await Promise.all(
        orphans.map(async (f) => {
          const room = i.rooms.find((r) => r.frames.includes(f))?.name;
          const image = await photoDataUrl(f.imageUrl).catch(() => undefined);
          if (image) await startIndexing(id, f.id, image, { width: f.width, height: f.height }, room);
        }),
      );
      return getInspection(id);
    }
    // Wake when this process's jobs finish, or poll the store (another instance may be indexing).
    await Promise.race([mine.length ? Promise.allSettled(mine) : sleep(1500), sleep(Math.min(left, 15_000))]);
  }
}

// ---------- comparison runs ----------

export function comparisonStatus(id: string): { status: "running" | "done" | "failed" | "not_started"; error?: string } {
  const s = state.comparisons.get(id);
  return s ? { status: s.status, ...(s.error && { error: s.error }) } : { status: "not_started" };
}

/**
 * Builds and saves the comparison for a move-out inspection. Waits up to `waitMs` for frames still being indexed.
 * If a run for this id is already going, returns that one instead of starting another.
 */
export function runComparison(id: string, opts: { waitMs?: number } = {}): Promise<Comparison> {
  const current = state.comparisons.get(id);
  if (current?.status === "running" && current.promise) return current.promise;

  const promise = (async () => {
    const moveOut = await settleIndexing(id, opts.waitMs ?? 0);
    if (!moveOut) throw new Error("Inspection not found.");
    if (moveOut.kind !== "move_out" || !moveOut.baselineId) throw new Error("Only a move-out inspection with a baseline can be compared.");
    const moveIn = await getInspection(moveOut.baselineId);
    if (!moveIn) throw new Error(`Move-in inspection ${moveOut.baselineId} not found.`);
    const pending = allFrames(moveIn).filter((f) => f.status === "pending").length;
    if (pending) console.warn(`[inspect] baseline ${moveIn.id} still has ${pending} pending frame(s); comparing without them`);
    const comparison = await buildComparison(moveOut, moveIn);
    await saveComparison(comparison);
    return comparison;
  })();

  const entry: ComparisonState = { status: "running", startedAt: Date.now(), promise };
  state.comparisons.set(id, entry);
  promise.then(
    () => {
      entry.status = "done";
      entry.promise = undefined;
    },
    (err) => {
      entry.status = "failed";
      entry.error = String(err instanceof Error ? err.message : err).slice(0, 300);
      entry.promise = undefined;
      console.error(`[inspect] comparison ${id} failed: ${entry.error}`);
    },
  );
  return promise;
}

/** True if a comparison is saved for this id (cheap check before starting another run). */
export async function hasComparison(id: string): Promise<boolean> {
  return Boolean(await getComparison(id));
}
