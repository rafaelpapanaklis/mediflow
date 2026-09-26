import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminClinicMutation } from "@/lib/admin-audit";
import { SpeiError, confirmarSolicitudSpei } from "@/lib/billing/spei-directo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — el admin vio la transferencia en su banco: activa la clínica (ver confirmarSolicitudSpei). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const r = await confirmarSolicitudSpei(params.id, admin.user.id);
    await logAdminClinicMutation({
      req,
      admin: admin.user,
      clinicId: r.clinicId,
      entityType: "admin-billing",
      entityId: r.clinicId,
      action: "update",
      after: {
        op: "confirm_spei_transfer",
        requestId: params.id,
        invoiceId: r.invoiceId,
        plan: r.plan,
        billing: r.billing,
        amountCents: r.amountCents,
        periodEnd: r.periodEnd.toISOString(),
        subscriptionStatus: "active",
      },
    });
    return NextResponse.json({ success: true, periodEnd: r.periodEnd.toISOString() });
  } catch (err) {
    if (err instanceof SpeiError) {
      return NextResponse.json({ error: err.message }, { status: err.codigo === "no-encontrada" ? 404 : 409 });
    }
    console.error("[admin/spei-transferencias] confirmar:", err);
    return NextResponse.json({ error: "No se pudo confirmar" }, { status: 500 });
  }
}
