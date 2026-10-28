import type { Tone } from "./Chip";

const dot: Record<Tone, string> = {
  neutral: "bg-white/60",
  info: "bg-cam-info",
  existing: "bg-cam-existing",
  new: "bg-cam-new",
  ok: "bg-cam-ok",
};

/** Dot + short status ("Listening", "Offline · 4 waiting"). Announced politely to screen readers. */
export function StatusPill({
  tone = "neutral",
  pulse,
  children,
  onDark = true,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: React.ReactNode;
  onDark?: boolean;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-sm font-medium ${
        onDark ? "bg-black/55 text-white backdrop-blur" : "bg-ink/5 text-ink"
      }`}
    >
      <span className={`size-2 rounded-full ${dot[tone]} ${pulse ? "animate-pulse" : ""}`} aria-hidden />
      {children}
    </span>
  );
}
