import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { submitReview } from "@/lib/reviews/service";
import { ReviewError } from "@/lib/reviews/types";

// POST /api/resena/[token] — el paciente envía su reseña (rating + comentario)
// sin login. Validación y sanitización en el service. Rate-limit por IP.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const limited = rateLimit(req, 8); // 8 envíos / min / IP
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  try {
    const result = await submitReview(params.token, body.rating, body.comment);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[resena/submit]", err);
    return NextResponse.json({ error: "No pudimos enviar tu reseña. Intenta de nuevo." }, { status: 500 });
  }
}
