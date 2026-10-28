import type { ComponentProps, ReactNode } from "react";
import { AlertIcon } from "@/components/ui";

/**
 * Labelled text input for document screens (not in components/ui yet).
 * Errors are calm: ink text with an icon, never red (red means new damage).
 */
export function TextField({
  id,
  label,
  error,
  hint,
  className,
  ...rest
}: { id: string; label: string; error?: string; hint?: ReactNode } & ComponentProps<"input">) {
  const msgId = `${id}-msg`;
  const message = error || hint;
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? msgId : undefined}
        className={`min-h-12 w-full rounded-xl border bg-paper px-4 text-base text-ink outline-none placeholder:text-muted focus-visible:border-info focus-visible:ring-2 focus-visible:ring-info/30 ${
          error ? "border-ink" : "border-line"
        }`}
      />
      {error ? (
        <p id={msgId} className="flex items-start gap-1.5 text-sm text-ink">
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-muted" />
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
