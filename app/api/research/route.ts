// POST ResearchRequest -> Research. Runs once per verdict, in the background, while the person keeps talking.
import { research } from "@/lib/repair/research";
import type { ResearchRequest } from "@/lib/repair/types";

export const maxDuration = 90;

export async function POST(request: Request) {
  let body: Partial<ResearchRequest>;
  try {
    body = (await request.json()) as Partial<ResearchRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.object?.name || typeof body.cause !== "string" || !body.cause.trim()) {
    return Response.json({ error: "object.name and cause are required." }, { status: 400 });
  }
  if (!process.env.MODEL_API_KEY) return Response.json({ error: "MODEL_API_KEY is not set." }, { status: 503 });

  try {
    return Response.json(
      await research({
        object: body.object,
        complaint: body.complaint,
        cause: body.cause,
        path: body.path === "shop" ? "shop" : "diy",
        city: typeof body.city === "string" ? body.city.slice(0, 60) : "",
      }),
    );
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
