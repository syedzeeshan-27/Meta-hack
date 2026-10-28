"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CreateInspectionRequest, Inspection } from "@/lib/inspect/types";

const PLACE_KEY = "dg.place";
const DEFAULT_CITY = "Bengaluru";

const card = "rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";
const field =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 dark:border-neutral-700 dark:bg-neutral-900 dark:placeholder:text-neutral-500";
const quiet = "text-neutral-500 dark:text-neutral-400";

export default function Home() {
  const router = useRouter();
  const propertyRef = useRef<HTMLInputElement>(null);
  const [property, setProperty] = useState("");
  const [city, setCity] = useState(DEFAULT_CITY);
  const [list, setList] = useState<Inspection[] | null>(null);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState(""); // "move_in" or the baseline id being started
  const [error, setError] = useState("");
  const [needProperty, setNeedProperty] = useState(false);
  const [pickingBaseline, setPickingBaseline] = useState(false);
  const [savedId, setSavedId] = useState("");

  async function load() {
    setListError("");
    try {
      const res = await fetch("/api/inspections", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as Inspection[] | { error?: string } | null;
      if (!res.ok || !Array.isArray(data)) throw new Error((data && !Array.isArray(data) && data.error) || `HTTP ${res.status}`);
      setList(data);
    } catch (err) {
      setListError(short(err));
      setList((l) => l ?? []);
    }
  }

  // Runs on first load and again whenever Next shows this page after navigating back to it.
  /* eslint-disable react-hooks/set-state-in-effect -- restore from storage and the URL once per visit */
  useEffect(() => {
    try {
      const place = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null") as { property?: string; city?: string } | null;
      if (place?.property) setProperty((p) => p || place.property!);
      if (place?.city) setCity((c) => (c && c !== DEFAULT_CITY ? c : place.city!));
    } catch {}
    // A finished move-in comes back here as /?saved=<id>.
    const savedParam = new URLSearchParams(window.location.search).get("saved");
    if (savedParam) {
      setSavedId(savedParam);
      window.history.replaceState(null, "", window.location.pathname);
    }
    void load();
    return () => setBusy("");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function remember(p: string, c: string) {
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({ property: p, city: c }));
    } catch {}
  }

  async function create(body: CreateInspectionRequest, busyKey: string) {
    setBusy(busyKey);
    setError("");
    try {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Inspection> & { error?: string };
      if (!res.ok || data.error || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/inspect/${data.id}`);
    } catch (err) {
      setError(`Couldn't start the inspection. ${short(err)}`);
      setBusy("");
    }
  }

  function startMoveIn() {
    const p = property.trim();
    const c = city.trim() || DEFAULT_CITY;
    if (!p) {
      setNeedProperty(true);
      propertyRef.current?.focus();
      return;
    }
    remember(p, c);
    void create({ kind: "move_in", property: p, city: c }, "move_in");
  }

  function startMoveOut(baseline: Inspection) {
    remember(baseline.property, baseline.city);
    void create({ kind: "move_out", property: baseline.property, city: baseline.city, baselineId: baseline.id }, baseline.id);
  }

  const moveIns = (list ?? [])
    .filter((i) => i.kind === "move_in")
    .sort((a, b) => Number(!!b.finishedAt) - Number(!!a.finishedAt) || b.createdAt - a.createdAt);
  const savedInspection = list?.find((i) => i.id === savedId);

  return (
    <main className="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Deposit Guard</h1>
            <p className={`mt-1 ${quiet}`}>Film your flat when you move in. Film it again when you move out. Only new damage counts.</p>
          </div>
          <Link href="/live" className={`mt-2 shrink-0 text-sm underline underline-offset-4 ${quiet}`}>
            Ask about anything
          </Link>
        </header>

        {savedId && (
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-600/30 bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            <p className="text-sm">
              <span className="font-semibold">Saved.</span>{" "}
              {savedInspection
                ? `Your move-in record for ${savedInspection.property} is stored: ${roomCount(savedInspection)}, ${photoCount(savedInspection)}.`
                : "Your move-in record is stored."}{" "}
              Come back here when you move out.
            </p>
            <button onClick={() => setSavedId("")} className="text-sm opacity-60" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        <section className={`${card} flex flex-col gap-3`}>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Flat</span>
            <input
              ref={propertyRef}
              value={property}
              onChange={(e) => {
                setProperty(e.target.value);
                setNeedProperty(false);
              }}
              placeholder="Flat 302, Koramangala"
              autoComplete="street-address"
              className={field}
            />
            {needProperty && <span className="text-sm text-amber-700 dark:text-amber-400">Add the flat&rsquo;s name or address first.</span>}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" className={field} />
          </label>

          <button
            onClick={startMoveIn}
            disabled={!!busy}
            className="mt-1 rounded-full bg-emerald-600 py-4 text-lg font-semibold text-white disabled:opacity-60"
          >
            {busy === "move_in" ? "Starting…" : "Start move-in inspection"}
          </button>
          <button
            onClick={() => setPickingBaseline((v) => !v)}
            disabled={!!busy}
            aria-expanded={pickingBaseline}
            className="rounded-full border border-neutral-300 py-3 text-base font-medium disabled:opacity-60 dark:border-neutral-700"
          >
            Start move-out inspection
          </button>

          {pickingBaseline && (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-sm font-medium">Which move-in should it be checked against?</p>
              {list === null ? (
                <p className={`text-sm ${quiet}`}>Loading…</p>
              ) : moveIns.length === 0 ? (
                <p className={`text-sm ${quiet}`}>You need a move-in inspection first. Start one above when you move in.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {moveIns.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => startMoveOut(m)}
                        disabled={!!busy}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-left disabled:opacity-60 dark:border-neutral-800"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{m.property}</span>
                          <span className={`block text-xs ${quiet}`}>
                            {formatDate(m.createdAt)} · {roomCount(m)}
                            {m.finishedAt ? "" : " · not finished"}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                          {busy === m.id ? "Starting…" : "Use"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={`text-sm font-medium uppercase tracking-wider ${quiet}`}>Your inspections</h2>
          {list === null ? (
            <p className={`text-sm ${quiet}`}>Loading…</p>
          ) : list.length === 0 && !listError ? (
            <p className={`text-sm ${quiet}`}>Nothing yet. Your move-in and move-out walkthroughs will show up here.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((i) => (
                <li key={i.id} className={`${card} flex items-center justify-between gap-3`}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-xs font-medium">
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          i.kind === "move_in"
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                            : "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
                        }`}
                      >
                        {i.kind === "move_in" ? "Move-in" : "Move-out"}
                      </span>
                      <span className={quiet}>{i.finishedAt ? "Finished" : "In progress"}</span>
                    </p>
                    <p className="mt-1 truncate font-medium">{i.property}</p>
                    <p className={`text-xs ${quiet}`}>
                      {formatDate(i.createdAt)} · {roomCount(i)} · {photoCount(i)}
                    </p>
                  </div>
                  {!i.finishedAt ? (
                    <Link href={`/inspect/${i.id}`} className="shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
                      Continue
                    </Link>
                  ) : i.kind === "move_out" ? (
                    <Link href={`/r/${i.id}`} className="shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
                      View report
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {listError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Couldn&rsquo;t load your inspections ({listError}).{" "}
              <button onClick={() => void load()} className="underline underline-offset-2">
                Try again
              </button>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function formatDate(t: number): string {
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function roomCount(i: Inspection): string {
  const n = i.rooms.length;
  return `${n} ${n === 1 ? "room" : "rooms"}`;
}

function photoCount(i: Inspection): string {
  const n = i.rooms.reduce((sum, r) => sum + r.frames.length, 0);
  return `${n} ${n === 1 ? "photo" : "photos"}`;
}

function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}
