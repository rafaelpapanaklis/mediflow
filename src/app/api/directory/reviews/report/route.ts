import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { reportReview } from "@/lib/reviews/service";

// POST /api/directory/reviews/report — cualquier visitante reporta una reseña
// publicada como inapropiada → entra a la cola de moderación del admin.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  // Tope GLOBAL por IP (no por ruta/reviewId): frena el mass-flagging de muchas
  // reseñas distintas de un competidor desde una misma IP. 6/hora/IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimitKey(`review-report:${ip}`, 6, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Demasiados reportes. Intenta más tarde." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.reviewId || typeof body.reviewId !== "string") {
    return NextResponse.json({ error: "reviewId requerido" }, { status: 400 });
  }

  try {
    await reportReview(body.reviewId, body.reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[directory/reviews/report]", err);
    return NextResponse.json({ error: "Error al reportar" }, { status: 500 });
  }
}
