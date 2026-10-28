"use client";

// Desktop stand-in for a camera screen: the walkthrough is meant for a phone, so hand the link over.

import { Button, ButtonLink, Card, CameraIcon, Page, ShareIcon, useToast } from "@/components/ui";
import { usePageUrl } from "./hooks";

export function DesktopHandoff({ what, onUseAnyway }: { what: string; onUseAnyway: () => void }) {
  const toast = useToast();
  const url = usePageUrl();
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Open this on your phone to ${what}: ${url}`)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", "ok");
    } catch {
      toast("Couldn't copy. Select the link and copy it.");
    }
  }

  return (
    <div className="flex min-h-dvh items-center">
      <Page>
        <Card className="sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-full bg-info/10 text-info" aria-hidden>
            <CameraIcon className="size-6" />
          </span>
          <h1 className="mt-4 text-[28px] font-semibold leading-[34px]">Walkthroughs work best on your phone</h1>
          <p className="mt-2 text-base text-muted">
            Open this link on your phone to {what}. You walk room by room and the photos are taken for you.
          </p>

          <p className="mt-6 text-sm font-medium text-muted" id="handoff-link">
            Link to this walkthrough
          </p>
          <p
            aria-labelledby="handoff-link"
            className="mt-1 select-all break-all rounded-xl border border-line bg-paper px-4 py-3 font-mono text-sm"
          >
            {url}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => void copy()}>Copy link</Button>
            <ButtonLink href={whatsapp} target="_blank" rel="noreferrer" variant="secondary" icon={<ShareIcon />}>
              Send on WhatsApp
            </ButtonLink>
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <Button variant="ghost" className="-ml-3" onClick={onUseAnyway}>
              Use this computer&rsquo;s camera anyway
            </Button>
          </div>
        </Card>
      </Page>
    </div>
  );
}
