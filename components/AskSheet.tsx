"use client";

// Ask, as a half-height sheet over a camera that's already running (the walkthrough's).
// The session (mic, answer stream, speech) lives in the parent via useAskSession, so the sheet
// reuses the parent's CameraStage for frames and its outlines draw on that camera behind the sheet.

import { Button, IconButton, MicIcon, MicOffIcon, Sheet, StatusPill } from "@/components/ui";
import { AnswerCard } from "@/components/camera/AnswerCard";
import { PHASE_LABEL, type AskSession } from "@/components/camera/useAskSession";

export default function AskSheet({ open, onClose, session: s }: { open: boolean; onClose: () => void; session: AskSession }) {
  const live = s.running && !s.muted;
  return (
    <Sheet open={open} onClose={onClose} onDark size="half" scrim="clear" title="Ask">
      <div className="flex items-center justify-between gap-3">
        {s.starting ? (
          <StatusPill pulse>Starting mic…</StatusPill>
        ) : !s.running ? (
          <StatusPill>Mic off</StatusPill>
        ) : s.muted ? (
          <StatusPill>Muted</StatusPill>
        ) : (
          <StatusPill tone={s.phase === "thinking" ? "neutral" : "info"} pulse={s.phase !== "listening"}>
            {PHASE_LABEL[s.phase]}
          </StatusPill>
        )}
        {s.running && (
          <IconButton
            onDark
            label={s.muted ? "Turn the mic on" : "Mute the mic"}
            aria-pressed={s.muted}
            onClick={() => {
              if (!s.muted) s.stopSpeaking();
              s.setMuted((m) => !m);
            }}
          >
            {s.muted ? <MicOffIcon /> : <MicIcon />}
          </IconButton>
        )}
      </div>

      {s.micError ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-base text-white/85">{s.micError} Allow the microphone for this site, then try again.</p>
          <Button onDark block onClick={() => void s.start()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <AnswerCard
            bare
            heard={s.heard}
            answer={s.answer}
            thinking={s.thinking}
            status={s.status}
            phrase={s.outline?.phrase}
            sources={s.sources}
            error={s.error}
            placeholder={
              live
                ? "Point at something and ask out loud. Try “is this crack serious?” or “what would this cost to fix?”"
                : "Turn the mic on to ask a question."
            }
          />
          {s.speaking && (
            <Button variant="ghost" onDark className="mt-2 -ml-3" onClick={() => s.stopSpeaking()}>
              Stop talking
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
