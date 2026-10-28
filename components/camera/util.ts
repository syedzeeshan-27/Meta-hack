// Small helpers shared by the camera screens.

export function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}

export function plural(n: number, word: string) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** 42_000 → "0:42", 3_725_000 → "1:02:05". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

/** A plain-English line for a failed getUserMedia (camera or mic). */
export function mediaError(err: unknown, what: "camera" | "microphone"): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return `The ${what} is blocked for this site.`;
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${what} found on this device.`;
  if (name === "NotReadableError" || name === "AbortError") return `Another app is using the ${what}. Close it and try again.`;
  return `Couldn't start the ${what}: ${short(err)}`;
}
