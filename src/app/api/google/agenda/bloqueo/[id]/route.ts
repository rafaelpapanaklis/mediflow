import { NextResponse } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { detalleBloqueoGoogle } from "@/lib/google/convertir.server";

export const dynamic = "force-dynamic";

// GET → el detalle de un bloqueo de Google Calendar para el panel de la agenda
// (título, hora, doctor, si ya se convirtió). WS1-T9. «Convertir en cita» no
// vive aquí: va por POST /api/appointments con `googleBloqueoId`.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;
  const { id } = await params;
  const d = await detalleBloqueoGoogle(
    { clinicId: session.clinic.id, userId: session.user.id, role: session.user.role },
    id,
  );
  if (!d) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(d, { headers: { "Cache-Control": "no-store" } });
}
