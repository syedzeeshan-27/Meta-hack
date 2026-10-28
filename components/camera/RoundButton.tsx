import type { ComponentProps, ReactNode } from "react";

/**
 * Round camera control with a caption underneath. `solid` is the white, primary look (the big centre
 * button, or a control while it's active); otherwise it matches IconButton's glass-on-dark look.
 * Camera-only primitive: document screens use components/ui Button / IconButton.
 */
export function RoundButton({
  label,
  caption,
  size = 56,
  solid,
  children,
  className,
  ...rest
}: {
  label: string;
  caption?: ReactNode;
  size?: number;
  solid?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "children">) {
  return (
    <span className="flex flex-col items-center gap-1.5">
      <button
        {...rest}
        aria-label={label}
        title={label}
        style={{ width: size, height: size }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full transition-[transform,background-color] active:scale-95 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
          solid ? "bg-white text-black shadow-lg" : "bg-white/15 text-white backdrop-blur hover:bg-white/25"
        } ${className ?? ""}`}
      >
        {children}
      </button>
      {caption && <span className="text-xs font-medium text-white/85 drop-shadow">{caption}</span>}
    </span>
  );
}
