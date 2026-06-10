import { NextRequest, NextResponse } from "next/server";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { getClinicReviews } from "@/lib/reviews/service";

// GET /api/reviews?page=<n> — reseñas de LA clínica de la sesión (multi-tenant).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const forbidden = requireRole(session, ["ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;

  const { searchParams } = new URL(req.url);
  const pageRaw = parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;

  try {
    const data = await getClinicReviews(session.clinic.id, page);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[reviews:list]", err);
    return NextResponse.json({ error: "Error al cargar reseñas" }, { status: 500 });
  }
}
