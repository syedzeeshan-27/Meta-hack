// Shown only when ACCESS_CODE is set and this browser hasn't entered it yet (see proxy.ts).
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { Card, Page } from "@/components/ui/Card";
import { WrenchIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "FixCam", robots: { index: false, follow: false } };

export default function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string; wrong?: string }> }) {
  return (
    <div className="flex min-h-dvh items-center">
      <Page>
        <Card className="sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-full bg-ink text-paper" aria-hidden>
            <WrenchIcon className="size-6" />
          </span>
          <h1 className="mt-4 text-[28px] font-semibold leading-[34px]">FixCam</h1>
          <p className="mt-2 text-muted">Enter the access code you were given.</p>
          <Suspense fallback={<CodeForm next="/" wrong={false} />}>
            {searchParams.then((p) => (
              <CodeForm next={safeNext(p.next)} wrong={p.wrong === "1"} />
            ))}
          </Suspense>
        </Card>
      </Page>
    </div>
  );
}

function CodeForm({ next, wrong }: { next: string; wrong: boolean }) {
  return (
    <form action={next} method="get" className="mt-5 flex flex-col gap-3">
      <input
        name="code"
        required
        autoFocus
        autoComplete="off"
        aria-label="Access code"
        placeholder="Access code"
        className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-base focus:border-info focus:outline-none"
      />
      {wrong && <p className="text-sm text-new">That code didn&rsquo;t work. Check it and try again.</p>}
      <Button type="submit" block>
        Continue
      </Button>
    </form>
  );
}

/** Only same-site paths, so the form can't be used to bounce someone elsewhere. */
function safeNext(next?: string): string {
  return next && /^\/(?!\/)[\w\-/]*$/.test(next) && next !== "/unlock" ? next : "/";
}
