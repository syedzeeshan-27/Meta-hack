import { AlertIcon, Chip, chipClass } from "@/components/ui";
import type { AskSource } from "./useAsk";
import { hostname } from "./util";

/**
 * Ask's answer, captioned. Same look as CaptionBar (80% black scrim), but not clamped to two lines:
 * an answer is often three or four sentences and has to be readable in full on mute.
 * `bare` drops the scrim for use inside a dark Sheet.
 */
export function AnswerCard({
  heard,
  answer,
  thinking,
  status,
  phrase,
  sources,
  error,
  placeholder,
  bare,
}: {
  heard: string;
  answer: string;
  thinking: boolean;
  status?: string;
  phrase?: string;
  sources: AskSource[];
  error?: string;
  placeholder?: string;
  bare?: boolean;
}) {
  if (!heard && !answer && !thinking && !error && !placeholder) return null;
  return (
    <div
      aria-live="polite"
      className={`anim-fade overflow-y-auto text-white ${bare ? "" : "max-h-[40dvh] rounded-2xl bg-black/80 px-4 py-3 backdrop-blur"}`}
    >
      {heard && <p className="text-sm text-white/65">You: &ldquo;{heard}&rdquo;</p>}
      {answer ? (
        <p className={`whitespace-pre-wrap text-base leading-6 ${heard ? "mt-1" : ""}`}>{answer}</p>
      ) : thinking ? (
        <p className={`text-base text-white/65 ${heard ? "mt-1" : ""}`}>Thinking…</p>
      ) : !heard && !error ? (
        <p className="text-base text-white/75">{placeholder}</p>
      ) : null}
      {thinking && status && <p className="mt-2 text-xs text-white/60">{status}</p>}
      {(phrase || sources.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {phrase && (
            <Chip tone="info" onDark>
              Outlined: {phrase}
            </Chip>
          )}
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={s.title}
              className={`${chipClass("neutral", true)} relative after:absolute after:-inset-y-1.5 after:inset-x-0`}
            >
              {hostname(s.url)}
            </a>
          ))}
        </div>
      )}
      {error && (
        <p className="mt-2 flex gap-1.5 break-words text-sm text-white/85">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
