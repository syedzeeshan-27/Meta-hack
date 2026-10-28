"use client";

import { useState, type FormEvent } from "react";
import { BANDS } from "@/lib/listen";
import { AlertIcon, Button, Sheet, WaveIcon } from "@/components/ui";
import type { Hazard, ListenState } from "./useFix";

/** The safety stop: red frame, what to do, and a re-check before they can carry on. */
export function StopOverlay({
  hazard,
  model,
  rechecking,
  onRecheck,
}: {
  hazard: Hazard;
  model: string;
  rechecking: boolean;
  onRecheck: () => void;
}) {
  return (
    <div className="anim-fade pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-cam-new/20 px-6 ring-[10px] ring-inset ring-cam-new">
      <div role="alertdialog" aria-label="Stop" className="pointer-events-auto w-full max-w-sm rounded-2xl bg-black/85 p-5 text-center backdrop-blur">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-cam-new text-black" aria-hidden>
          <AlertIcon className="size-7" />
        </span>
        <p className="mt-3 text-3xl font-bold tracking-wide text-cam-new">STOP</p>
        <p className="mt-2 text-lg leading-snug">{hazard.say}</p>
        <p className="mt-3 text-xs text-white/55">
          Spotted by the safety watcher{model && ` (${model})`}, double-checked by Muse Spark.
        </p>
        <Button onDark block className="mt-4" loading={rechecking} onClick={onRecheck}>
          {rechecking ? "Checking…" : "It's safe now"}
        </Button>
      </div>
    </div>
  );
}

/** The sound test in progress: a live spectrum while the phone records the device. */
export function ListenMeter({ listen, onTap, onCancel }: { listen: ListenState; onTap: () => void; onCancel: () => void }) {
  const bars = listen.bands.length ? listen.bands : Array.from({ length: BANDS }, () => 0.04);
  return (
    <div className="anim-fade absolute inset-x-4 top-1/3 z-20 mx-auto max-w-sm rounded-2xl bg-black/80 p-4 backdrop-blur">
      <p className="flex items-center gap-2 text-sm font-semibold text-cam-info">
        <WaveIcon className="size-4" /> {listen.needsTap ? "Ready for the sound test" : "Listening to the device…"}
      </p>
      {listen.ask && <p className="mt-1 text-sm text-white/80">{listen.ask}</p>}
      <div className="mt-3 flex h-16 items-end gap-[3px]" aria-hidden>
        {bars.map((b, i) => (
          <span key={i} className="flex-1 rounded-sm bg-cam-info transition-[height] duration-75" style={{ height: `${Math.max(4, b * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-white/45" aria-hidden>
        <span>60 Hz</span>
        <span>8 kHz</span>
      </div>
      <div className="mt-3 flex gap-2">
        {listen.needsTap && (
          <Button onDark className="flex-1" onClick={onTap}>
            Start the sound test
          </Button>
        )}
        <Button variant="ghost" onDark onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Type instead of talk: for desktops and noisy rooms. */
export function TypeSheet({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
    onClose();
  }
  return (
    <Sheet open={open} onClose={onClose} onDark title="Type to FixCam" size="half">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. My fan hums but won't spin"
          enterKeyHint="send"
          className="min-h-12 w-full rounded-xl border border-white/20 bg-white/10 px-4 text-base text-white placeholder:text-white/45 focus:border-cam-info focus:outline-none"
        />
        <Button onDark block type="submit" disabled={!text.trim()}>
          Send
        </Button>
      </form>
    </Sheet>
  );
}
