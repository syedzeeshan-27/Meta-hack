import { planGuide } from "@/lib/plan";
import { DEMO_STEPS } from "@/lib/demo-steps";
import type { Guide } from "@/lib/types";

// Reading a manual (or searching the web for one) takes 20-60s.
export const maxDuration = 120;

// POST { product: string, manualImages?: dataURL[], userNotes?: string } -> Guide
export async function POST(request: Request) {
  const { product, manualImages = [], userNotes = "" } = (await request.json()) as {
    product?: string;
    manualImages?: string[];
    userNotes?: string;
  };
  if (!product?.trim()) return Response.json({ error: "Tell me what you're building first." }, { status: 400 });

  if (!process.env.MODEL_API_KEY) {
    const demo: Guide = { product, basis: "typical", parts: [], steps: DEMO_STEPS, sources: ["demo data"] };
    return Response.json(demo);
  }

  try {
    return Response.json(await planGuide({ product: product.trim(), manualImages, userNotes }));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
