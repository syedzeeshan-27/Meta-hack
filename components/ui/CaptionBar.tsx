/** What the app just said (or is saying), shown over the camera so it works on mute. Max 2 lines. */
export function CaptionBar({ text, sub }: { text: string; sub?: string }) {
  if (!text) return null;
  return (
    <div aria-live="polite" className="anim-fade rounded-2xl bg-black/80 px-4 py-3 text-white backdrop-blur">
      <p className="line-clamp-2 text-base leading-snug">{text}</p>
      {sub && <p className="mt-1 line-clamp-1 text-xs text-white/60">{sub}</p>}
    </div>
  );
}
