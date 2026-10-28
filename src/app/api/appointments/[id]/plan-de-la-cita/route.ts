// GET /api/appointments/[id]/plan-de-la-cita — v17 (decisión 2 de Rafael, 28-oct): lo que dice el detalle de
// la cita en la Agenda, «En esta cita: resina $700 (hecha) · Debe hoy $700». Los procedimientos del plan
// agendados para esa cita y/o hechos en ella, con su precio y estado, y «Debe hoy» (la misma cifra de
// Pacientes y de la ficha). Sin nada del plan en la cita: `{ filas: [] }` y el bloque no sale.
//
// Lo ve TODO el que ve la cita, doctor incluido (decisión de Rafael: «claro que sí ve los precios el doctor
// y todos»): `agenda.view`, no `billing.view`. Clínica de la sesión y visibilidad del paciente. Solo lectura.

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { planDeLaCita } from "@/lib/treatments/plan-de-la-cita.server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "agenda.view");
  if (denied) return denied;
  const id = String(params?.id ?? "").trim();
  if (!id || !esIdDeLaBase(id)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });

  const cita = await prisma.appointment.findFirst({ where: { id, clinicId: ctx.clinicId }, select: { id: true, patientId: true } });
  if (!cita) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  if (cita.patientId) {
    const oculto = await assertPatientVisible(cita.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (oculto) return oculto;
  }
  return NextResponse.json(await planDeLaCita(ctx.clinicId, cita.id));
}
