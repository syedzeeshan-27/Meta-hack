import type { ComponentProps, ReactNode } from "react";

export type Tone = "neutral" | "info" | "existing" | "new" | "ok";

const paperTone: Record<Tone, string> = {
  neutral: "bg-ink/5 text-ink",
  info: "bg-info/10 text-info",
  existing: "bg-existing/12 text-existing",
  new: "bg-new/10 text-new",
  ok: "bg-ok/10 text-ok",
};

const darkTone: Record<Tone, string> = {
  neutral: "bg-white/15 text-white",
  info: "bg-cam-info/20 text-cam-info",
  existing: "bg-cam-existing/20 text-cam-existing",
  new: "bg-cam-new/20 text-cam-new",
  ok: "bg-cam-ok/20 text-cam-ok",
};

export function chipClass(tone: Tone = "neutral", onDark = false) {
  return `inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${
    (onDark ? darkTone : paperTone)[tone]
  }`;
}

/** Small rounded tag. Pass onClick to make it a button (it then gets a 48px-tall hit area). */
export function Chip({
  tone = "neutral",
  onDark,
  icon,
  children,
  className,
  onClick,
  ...rest
}: { tone?: Tone; onDark?: boolean; icon?: ReactNode; children: ReactNode } & ComponentProps<"button">) {
  const cls = `${chipClass(tone, onDark)} ${className ?? ""}`;
  if (!onClick) {
    return (
      <span className={cls}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button {...rest} onClick={onClick} className={`${cls} relative after:absolute after:-inset-y-2 after:inset-x-0`}>
      {icon}
      {children}
    </button>
  );
}
