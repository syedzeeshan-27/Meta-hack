import { transcribe } from "@/lib/meta";

const MAX_KEYWORDS = 10;

// POST raw WAV bytes (audio/wav) -> { transcript }.
// ?k=word,word: hints from the current repair (object, brand, model, part names) so those words come out right.
// Only context words go here: fixed hints from an old demo bend everything else said toward them.
export async function POST(request: Request) {
  const wav = await request.blob();
  if (!wav.size) return Response.json({ error: "empty audio" }, { status: 400 });

  const started = Date.now();
  if (!process.env.MODEL_API_KEY) return Response.json({ transcript: "next", ms: 0, fake: true });

  const keywords = [
    ...new Set(
      (new URL(request.url).searchParams.get("k") ?? "")
        .split(",")
        .map((k) => k.trim().replace(/\s+/g, " "))
        .filter((k) => k.length >= 2 && k.length <= 40),
    ),
  ].slice(0, MAX_KEYWORDS);

  try {
    const transcript = await transcribe(wav, keywords);
    return Response.json({ transcript, ms: Date.now() - started });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
