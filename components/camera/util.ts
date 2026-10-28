// Small helpers shared by the camera screens.

export function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
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
