import { NextRequest, NextResponse } from "next/server";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { respondToReview } from "@/lib/reviews/service";
import { ReviewError } from "@/lib/reviews/types";

// POST /api/reviews/[id]/respond — la clínica responde a una de SUS reseñas.
// El service valida que la reseña pertenezca a session.clinic.id (multi-tenant).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const forbidden = requireRole(session, ["ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  try {
    const review = await respondToReview(session.clinic.id, params.id, body.response, session.user.id);
    return NextResponse.json({ review });
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[reviews:respond]", err);
    return NextResponse.json({ error: "Error al responder" }, { status: 500 });
  }
}
