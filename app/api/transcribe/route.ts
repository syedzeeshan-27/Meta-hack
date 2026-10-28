import { transcribe } from "@/lib/meta";

// POST raw WAV bytes (audio/wav) -> { transcript }.
export async function POST(request: Request) {
  const wav = await request.blob();
  if (!wav.size) return Response.json({ error: "empty audio" }, { status: 400 });

  const started = Date.now();
  if (!process.env.MODEL_API_KEY) return Response.json({ transcript: "next", ms: 0, fake: true });

  try {
    const transcript = await transcribe(wav, ["FixCam", "gas lift", "armrest", "caster", "Allen key"]);
    return Response.json({ transcript, ms: Date.now() - started });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
