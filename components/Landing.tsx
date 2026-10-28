"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { listRepairs, type SavedRepair } from "@/components/fix/history";
import { ButtonLink, Card, CheckIcon, ChevronRightIcon, EyeIcon, Page, ShieldIcon, WaveIcon, WrenchIcon } from "@/components/ui";

const STEPS = [
  { Icon: EyeIcon, title: "Show it and say what's wrong", body: "It reads the model off the label and lists the likely causes." },
  { Icon: WaveIcon, title: "Run quick tests together", body: "Look, try, answer, or let it listen to the motor. The causes narrow as you go." },
  { Icon: ShieldIcon, title: "A safety call made in code", body: "Fix it yourself, fix it carefully, or take it to a shop. Never guessed." },
  { Icon: WrenchIcon, title: "Fix it step by step", body: "The part to touch is outlined on camera, and each step is checked before the next." },
];

const noSubscribe = () => () => {};
const EMPTY: SavedRepair[] = [];
let cache: { raw: string; list: SavedRepair[] } | null = null;
// Same array back while localStorage is unchanged, so useSyncExternalStore doesn't loop.
function snapshot(): SavedRepair[] {
  const list = listRepairs();
  const raw = JSON.stringify(list);
  if (cache?.raw !== raw) cache = { raw, list };
  return cache.list;
}

export default function Landing() {
  const repairs = useSyncExternalStore(noSubscribe, snapshot, () => EMPTY);

  return (
    <Page>
      <header className="flex items-center gap-2 pt-2">
        <span className="flex size-9 items-center justify-center rounded-full bg-ink text-paper" aria-hidden>
          <WrenchIcon className="size-5" />
        </span>
        <span className="text-lg font-semibold">FixCam</span>
      </header>

      <section className="mt-10">
        <h1 className="text-[34px] font-semibold leading-[40px] tracking-tight sm:text-[44px] sm:leading-[50px]">
          Something broken?
          <br />
          Show me.
        </h1>
        <p className="mt-3 max-w-md text-lg text-muted">
          A repair technician in your phone. Point the camera at a fan, a mixer, a remote or a charger, and talk. It finds the
          cause with you and walks you through the fix.
        </p>
        <ButtonLink href="/fix" size="lg" className="mt-6 w-full sm:w-auto" icon={<WrenchIcon />}>
          Start a repair
        </ButtonLink>
      </section>

      <ol className="mt-10 grid gap-3 sm:grid-cols-2">
        {STEPS.map(({ Icon, title, body }, i) => (
          <li key={title}>
            <Card className="h-full">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info/10 text-info" aria-hidden>
                  <Icon className="size-5" />
                </span>
                <div>
                  <p className="font-semibold">
                    <span className="text-muted">{i + 1}. </span>
                    {title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{body}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      {repairs.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Your repairs</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {repairs.map((r) => (
              <li key={r.id}>
                <Link href={`/r/${r.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-ink/5">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${r.fixed ? "bg-ok/10 text-ok" : "bg-ink/5 text-muted"}`}>
                    {r.fixed ? <CheckIcon className="size-4" /> : <WrenchIcon className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block text-sm text-muted">
                      {r.fixed ? "Fixed" : "Not fixed"} · {new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-12 text-sm text-muted">
        Built with Meta&rsquo;s Muse Spark, SAM 3.1, Muse Voice, and Muse Spark Open (open weights) as the safety watcher.
      </p>
    </Page>
  );
}
