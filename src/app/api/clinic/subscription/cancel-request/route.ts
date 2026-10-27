import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { leerGrupoDePago } from "@/lib/billing/sedes-incluidas";
import { avisoSedeIncluida } from "@/lib/billing/sedes-incluidas-core";
import { isClinicBillingAdmin, notClinicBillingAdminResponse } from "@/lib/billing/authz";

/**
 * Marca la clínica como "cancelRequested" — no cancela inmediatamente,
 * solo registra la intención del usuario para que el admin / proceso de cobro
 * no cobre al terminar el trial.
 */
export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Cancelar es solo del dueño (SUPER_ADMIN), decisión de Rafael del 26-oct-2026; antes bastaba un ADMIN.
  if (!isClinicBillingAdmin(ctx.role)) {
    return NextResponse.json(notClinicBillingAdminResponse(), { status: 403 });
  }

  try {
    // M2 (ws1-t5): una sede incluida no paga; marcar «cancelar» en ella perdía la intención (la principal no
    // se enteraba y /admin la veía en la clínica equivocada). Se avisa y se manda a la clínica que paga.
    const grupo = await leerGrupoDePago(ctx.clinicId, ctx.user?.supabaseId);
    if (grupo.esSedeIncluida) {
      return NextResponse.json(
        { code: "SEDE_INCLUIDA", error: avisoSedeIncluida(grupo.pagadoraNombre), pagadoraId: grupo.pagadoraId },
        { status: 409 },
      );
    }
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: {
        cancelRequested: true,
        cancelRequestedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("cancel-request error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno" }, { status: 500 });
  }
}
