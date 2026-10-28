"use client";

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";

/** A ref that always holds the latest value (for callbacks handed to long-lived listeners). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

// ---------- desktop vs phone ----------

const WIDE = "(min-width: 1024px)";
const COARSE = "(any-pointer: coarse)";

function subscribeMedia(cb: () => void) {
  const queries = [WIDE, COARSE].map((q) => window.matchMedia(q));
  queries.forEach((q) => q.addEventListener("change", cb));
  return () => queries.forEach((q) => q.removeEventListener("change", cb));
}

/** True on a wide screen with no touch pointer (a laptop or desktop). Null until known (server render). */
export function useIsDesktop(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribeMedia,
    () => window.matchMedia(WIDE).matches && !window.matchMedia(COARSE).matches,
    () => null,
  );
}

// ---------- online / offline ----------

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

// ---------- a remembered yes/no (localStorage, with an in-memory fallback) ----------

const flagListeners = new Set<() => void>();
const flagMemory = new Set<string>();

function readFlag(key: string): boolean {
  if (flagMemory.has(key)) return true;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribeFlags(cb: () => void) {
  flagListeners.add(cb);
  return () => {
    flagListeners.delete(cb);
  };
}

/** [isSet, set]. Reads as set during the server render so nothing flashes before hydration. */
export function useLocalFlag(key: string): [boolean, () => void] {
  const value = useSyncExternalStore(subscribeFlags, () => readFlag(key), () => true);
  const set = useCallback(() => {
    flagMemory.add(key);
    try {
      localStorage.setItem(key, "1");
    } catch {}
    flagListeners.forEach((l) => l());
  }, [key]);
  return [value, set];
}

// ---------- the page URL (for the phone handoff) ----------

const noop = () => () => {};

export function usePageUrl(): string {
  return useSyncExternalStore(noop, () => window.location.href, () => "");
}
