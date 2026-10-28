import { AlertIcon, Button, Card } from "@/components/ui";

/** Placeholder cards while the list loads (shapes, not spinners). */
export function FlatSkeletons({ count = 2 }: { count?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading your flats…</span>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} aria-hidden className="animate-pulse">
          <div className="h-5 w-2/3 rounded bg-ink/10" />
          <div className="mt-2 h-4 w-1/4 rounded bg-ink/5" />
          <div className="mt-4 h-4 w-3/4 rounded bg-ink/5" />
          <div className="mt-2 h-4 w-1/2 rounded bg-ink/5" />
          <div className="mt-4 h-12 rounded-full bg-ink/5" />
        </Card>
      ))}
    </div>
  );
}

export function LoadError({ detail, retrying, onRetry }: { detail: string; retrying: boolean; onRetry: () => void }) {
  return (
    <Card role="alert">
      <div className="flex items-start gap-3">
        <AlertIcon className="mt-0.5 size-5 shrink-0 text-muted" />
        <div className="min-w-0">
          <p className="font-medium">Couldn&rsquo;t load your flats</p>
          <p className="mt-0.5 text-sm text-muted">
            {detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1).replace(/\.$/, "")}. ` : ""}
            Check your connection, then try again.
          </p>
        </div>
      </div>
      <Button variant="secondary" className="mt-4" loading={retrying} onClick={onRetry}>
        Retry
      </Button>
    </Card>
  );
}
