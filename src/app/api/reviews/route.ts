import { NextRequest, NextResponse } from "next/server";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { getClinicReviews, getInvitacionesRecientes } from "@/lib/reviews/service";
import { prisma } from "@/lib/prisma";

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
    // Las invitaciones van aparte y solo en la primera página; si fallan no
    // tumban la lista de reseñas.
    const invitaciones =
      page === 1 ? await getInvitacionesRecientes(session.clinic.id).catch(() => []) : [];
    // N-65: con esto «No se envió» dice la causa probable y el botón que la arregla.
    const whatsappConectado =
      page === 1
        ? await prisma.clinic
            .findUnique({ where: { id: session.clinic.id }, select: { waConnected: true } })
            .then((c) => c?.waConnected === true)
            .catch(() => undefined)
        : undefined;
    return NextResponse.json({ ...data, invitaciones, whatsappConectado });
  } catch (err) {
    console.error("[reviews:list]", err);
    return NextResponse.json({ error: "Error al cargar reseñas" }, { status: 500 });
  }
}
