import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ok";
type Size = "md" | "lg";

type Common = {
  variant?: ButtonVariant;
  size?: Size;
  /** Camera screens are always dark; this switches to the light-on-dark styles. */
  onDark?: boolean;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[opacity,transform] " +
  "active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-info select-none";

const sizes: Record<Size, string> = {
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
};

const paper: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper",
  secondary: "border border-line bg-surface text-ink",
  ghost: "text-ink hover:bg-ink/5",
  danger: "bg-new text-white",
  ok: "bg-ok text-white",
};

const dark: Record<ButtonVariant, string> = {
  primary: "bg-white text-black",
  secondary: "bg-white/15 text-white backdrop-blur",
  ghost: "text-white hover:bg-white/10",
  danger: "bg-cam-new text-black",
  ok: "bg-cam-ok text-black",
};

export function buttonClass({ variant = "primary", size = "md", onDark, block, className }: Common = {}) {
  return [base, sizes[size], (onDark ? dark : paper)[variant], block ? "w-full" : "", className ?? ""].join(" ");
}

function Content({ loading, icon, children }: Pick<Common, "loading" | "icon" | "children">) {
  return (
    <>
      {loading ? <Spinner /> : icon}
      {children}
    </>
  );
}

export function Button({
  variant,
  size,
  onDark,
  block,
  loading,
  icon,
  children,
  className,
  disabled,
  ...rest
}: Common & Omit<ComponentProps<"button">, "children">) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, onDark, block, className })}
    >
      <Content loading={loading} icon={icon}>
        {children}
      </Content>
    </button>
  );
}

/** A link that looks like a Button. */
export function ButtonLink({
  variant,
  size,
  onDark,
  block,
  icon,
  children,
  className,
  ...rest
}: Common & Omit<ComponentProps<typeof Link>, "children">) {
  return (
    <Link {...rest} className={buttonClass({ variant, size, onDark, block, className })}>
      <Content icon={icon}>{children}</Content>
    </Link>
  );
}

/** Round icon-only button. `label` is required: it's the accessible name. */
export function IconButton({
  label,
  onDark,
  size = 48,
  className,
  children,
  ...rest
}: { label: string; onDark?: boolean; size?: number } & ComponentProps<"button">) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
        onDark ? "bg-white/15 text-white backdrop-blur hover:bg-white/25" : "text-ink hover:bg-ink/5"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}
