// Outline tones map straight onto the classes in app/globals.css.
// info = "here it is", existing = caution, new = something wrong or unsafe, ok = fine / done.

export type OutlineTone = "info" | "existing" | "new" | "ok";

const TONE_CLASS: Record<OutlineTone, string> = {
  info: "",
  existing: "tone-existing",
  new: "tone-new",
  ok: "tone-ok",
};

export function outlineClass(tone: OutlineTone = "info", fresh = false): string {
  return ["part-outline", TONE_CLASS[tone], fresh ? "is-fresh" : ""].filter(Boolean).join(" ");
}
