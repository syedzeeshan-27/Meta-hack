"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertIcon, Button, CameraIcon, Sheet } from "@/components/ui";
import { createInspection, errorText } from "./api";
import { flatKey } from "./flats";
import { TextField } from "./TextField";

const DEFAULT_CITY = "Bengaluru";
const FORM_ID = "new-flat-form";

/** Mounted only while open, so every visit starts with a fresh form. `onClose` must be stable (Sheet refocuses on change). */
export function NewFlatSheet({ onClose, existingKeys }: { onClose: () => void; existingKeys: Set<string> }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState(DEFAULT_CITY);
  const [nameError, setNameError] = useState("");
  const [cityError, setCityError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);

  // With a mouse and keyboard, put the cursor in the name field. On phones, leave the keyboard closed until tapped.
  // (Sheet focuses its panel first, so this waits a moment.)
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const t = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const property = name.trim();
    const c = city.trim();
    const nErr = property ? "" : "Add the flat’s name or address, so you can find it later.";
    const cErr = c ? "" : "Add the city. Repair prices depend on it.";
    setNameError(nErr);
    setCityError(cErr);
    setSubmitError("");
    if (nErr) return nameRef.current?.focus();
    if (cErr) return cityRef.current?.focus();

    setBusy(true);
    try {
      const created = await createInspection({ kind: "move_in", property, city: c });
      router.push(`/inspect/${encodeURIComponent(created.id)}`);
    } catch (err) {
      setSubmitError(`Couldn’t start the walkthrough: ${errorText(err)}. Check your connection and try again.`);
      setBusy(false);
    }
  }

  const known = !!name.trim() && existingKeys.has(flatKey(name));

  return (
    <Sheet
      open
      onClose={onClose}
      title="New flat"
      footer={
        <div className="flex flex-col gap-3">
          <div aria-live="polite">
            {submitError && (
              <p className="flex items-start gap-1.5 text-sm text-ink">
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                {submitError}
              </p>
            )}
          </div>
          <Button type="submit" form={FORM_ID} size="lg" block loading={busy} icon={<CameraIcon />}>
            {busy ? "Starting…" : "Start move-in walkthrough"}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          You&rsquo;ll walk through each room with your camera. Marks that are already there get outlined and logged.
        </p>
        <TextField
          ref={nameRef}
          id="new-flat-name"
          label="Flat name or address"
          placeholder="Flat 302, Koramangala"
          autoComplete="street-address"
          enterKeyHint="next"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError("");
          }}
          error={nameError}
          hint={known ? "You already have this flat. This starts a fresh move-in for it." : undefined}
        />
        <TextField
          ref={cityRef}
          id="new-flat-city"
          label="City"
          autoComplete="address-level2"
          enterKeyHint="go"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            setCityError("");
          }}
          error={cityError}
          hint="Used for local repair prices."
        />
      </form>
    </Sheet>
  );
}
