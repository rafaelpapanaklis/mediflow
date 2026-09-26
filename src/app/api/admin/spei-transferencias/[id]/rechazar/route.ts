import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminClinicMutation } from "@/lib/admin-audit";
import { SpeiError, rechazarSolicitudSpei } from "@/lib/billing/spei-directo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { reason } — la transferencia no llegó o no cuadra: la clínica vuelve a la pantalla de pago con el motivo. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "Escribe el motivo del rechazo" }, { status: 400 });

  try {
    const r = await rechazarSolicitudSpei(params.id, admin.user.id, reason);
    await logAdminClinicMutation({
      req,
      admin: admin.user,
      clinicId: r.clinicId,
      entityType: "admin-billing",
      entityId: r.clinicId,
      action: "update",
      after: { op: "reject_spei_transfer", requestId: params.id, reference: r.reference, reason },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof SpeiError) {
      return NextResponse.json({ error: err.message }, { status: err.codigo === "no-encontrada" ? 404 : 409 });
    }
    console.error("[admin/spei-transferencias] rechazar:", err);
    return NextResponse.json({ error: "No se pudo rechazar" }, { status: 500 });
  }
}
