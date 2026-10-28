"use client";

import { useEffect, useState } from "react";
import { fetchComparison, type ComparisonResult } from "./api";

const POLL_MS = 5000;
const MAX_POLLS = 120; // ten minutes, then the report page takes over

export type ComparisonView = ComparisonResult | { state: "loading" };

/**
 * The move-out's comparison, re-checked every few seconds while it's still running.
 * Polling stops when the card unmounts or Next hides the page (effects clean up under Activity).
 */
export function useComparison(moveOutId: string | undefined): ComparisonView | null {
  const [result, setResult] = useState<{ id: string; value: ComparisonResult } | null>(null);

  useEffect(() => {
    if (!moveOutId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const tick = async () => {
      const value = await fetchComparison(moveOutId);
      if (cancelled) return;
      setResult({ id: moveOutId, value });
      if (value.state === "running" && ++polls < MAX_POLLS) timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [moveOutId]);

  if (!moveOutId) return null;
  return result?.id === moveOutId ? result.value : { state: "loading" };
}
