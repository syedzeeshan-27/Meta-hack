"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Button, ButtonLink, CameraIcon, Page, PlusIcon, SparkleIcon, useToast } from "@/components/ui";
import type { Inspection } from "@/lib/inspect/types";
import { errorText, listInspections } from "./home/api";
import { EmptyState } from "./home/EmptyState";
import { FlatCard } from "./home/FlatCard";
import { groupFlats } from "./home/flats";
import { NewFlatSheet } from "./home/NewFlatSheet";
import { FlatSkeletons, LoadError } from "./home/States";

const HIGHLIGHT_MS = 2600;

export default function Home() {
  const toast = useToast();
  const [list, setList] = useState<Inspection[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [savedId, setSavedId] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listInspections();
      setList(data);
      setLoadError("");
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  // Runs on first load and again each time Next shows this page after navigating back to it
  // (cacheComponents keeps the page alive under <Activity>, which re-runs effects but keeps state).
  useEffect(() => {
    // A finished move-in comes back here as /?saved=<id>.
    const saved = new URLSearchParams(window.location.search).get("saved");
    if (saved) {
      window.history.replaceState(null, "", window.location.pathname);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once per visit from the URL
      setSavedId(saved);
      toast("Move-in saved. Come back when you move out.", "ok");
    }
    void load();
  }, [load, toast]);

  // The sheet shouldn't still be open when the renter comes back from a walkthrough.
  useLayoutEffect(() => () => setSheetOpen(false), []);

  // The saved flat's card glows briefly once the list is in, then settles.
  useEffect(() => {
    if (!savedId || list === null) return;
    const t = setTimeout(() => setSavedId(""), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [savedId, list]);

  const flats = useMemo(() => (list ? groupFlats(list) : []), [list]);
  const existingKeys = useMemo(() => new Set(flats.map((f) => f.key)), [flats]);
  const highlightKey = savedId ? flats.find((f) => f.ids.includes(savedId))?.key : undefined;

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const retry = useCallback(async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  }, [load]);

  const loading = list === null && !loadError;
  const empty = list !== null && list.length === 0 && !loadError;

  return (
    <>
      <Page>
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight">Deposit Guard</h1>
            <p className="mt-1 text-muted">Proof of your flat&rsquo;s condition, so your deposit comes back.</p>
            <p className="mt-3 hidden items-center gap-2 text-sm text-muted lg:flex">
              <CameraIcon className="size-4 shrink-0" />
              Walkthroughs work best on your phone.
            </p>
          </div>
          <ButtonLink
            href="/live"
            variant="ghost"
            className="shrink-0"
            icon={<SparkleIcon className="size-5 text-info" />}
            aria-label="Ask about anything"
          >
            Ask
          </ButtonLink>
        </header>

        <div className="mt-8 flex flex-col gap-3">
          {loadError && <LoadError detail={loadError} retrying={retrying} onRetry={() => void retry()} />}

          {empty && <EmptyState />}

          {(loading || flats.length > 0) && (
            <section aria-labelledby="flats-heading" aria-busy={loading || undefined}>
              <h2 id="flats-heading" className={loading ? "sr-only" : "mb-3 text-sm font-medium text-muted"}>
                Your flats
              </h2>
              {loading ? (
                <FlatSkeletons />
              ) : (
                <ul className="flex flex-col gap-3">
                  {flats.map((flat) => (
                    <li key={flat.key}>
                      <FlatCard flat={flat} highlight={flat.key === highlightKey} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* Room for the fixed button below, so the last card can scroll clear of it. */}
        <div aria-hidden className="h-20" />
      </Page>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-linear-to-t from-paper from-60% to-paper/0 pt-8">
        <div className="pointer-events-auto mx-auto w-full max-w-[680px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button size="lg" block icon={<PlusIcon />} onClick={openSheet} aria-haspopup="dialog">
            {empty ? "Add your flat" : "Add a flat"}
          </Button>
        </div>
      </div>

      {sheetOpen && <NewFlatSheet onClose={closeSheet} existingKeys={existingKeys} />}
    </>
  );
}
