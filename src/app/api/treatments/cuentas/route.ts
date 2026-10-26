import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { leerCuentaDelPlan } from "@/lib/treatments/cobro.server";
import { repoFilas } from "@/lib/treatments/items-db";
import { planesDelPaciente } from "@/lib/treatments/sin-doble-cobro.server";
import { filasAgendadasEnCita } from "@/lib/treatments/citas-del-plan-db";
import type { PlanConCuenta } from "@/lib/treatments/sin-doble-cobro";

export const dynamic = "force-dynamic";

/** Planes por paciente que se cuentan (un paciente real tiene 1–3; las cuentas se leen de una en una). */
const MAX_PLANES = 10;

/**
 * GET /api/treatments/cuentas?patientId= — la cuenta de CADA plan vivo del paciente (ws1-t12 ·
 * fase 2), en una sola llamada: lo que pintan la tarjeta «Cuenta del plan» de la ficha y la hoja
 * «Cobrar hoy» (abono a la nota del plan en vez de una factura nueva). Cada cuenta es la misma de
 * `GET /api/treatments/[id]/cuenta` (`leerCuentaDelPlan`); además van las notas por cobrar (para
 * repartir el abono) y las filas vivas (para reconocer lo que la hoja va a cobrar).
 *
 * Con `&appointmentId=` (la hoja abierta desde una cita) responde además `planesDeLaCita`: los planes
 * de ESTE paciente con filas agendadas en esa cita (`filasAgendadasEnCita`), para que la hoja abone
 * a ese plan y no proponga cobrar aparte. Al unir la fase 2 (REPORTE-ws1-t1 §6).
 *
 * Permisos: `treatments.view` + `billing.view`, los de `…/cuenta`. Tenant y paciente: los de la
 * sesión; un plan cancelado (ABANDONED) entra solo por su nota viva (la hoja no le ofrece crear una). Las cuentas se leen en serie (el pooler no aguanta
 * muchas a la vez) y como mucho `MAX_PLANES`.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.clinicId) return NextResponse.json({ planes: [] });
  const denied = denyIfMissingPermission(ctx, "treatments.view") ?? denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const patientId = params.get("patientId") ?? "";
  if (!patientId || !esIdDeLaBase(patientId)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });
  const appointmentId = params.get("appointmentId");
  if (appointmentId !== null && !esIdDeLaBase(appointmentId)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });
  const paciente = await prisma.patient.findFirst({ where: { id: patientId, clinicId: ctx.clinicId }, select: { id: true } });
  if (!paciente) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  const oculto = await assertPatientVisible(paciente.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;

  // También los cancelados: su nota viva se sigue abonando (cancelar no la cambia).
  const planes = (await planesDelPaciente(ctx.clinicId, paciente.id)).slice(0, MAX_PLANES);
  const filasPorPlan = await repoFilas.leerDePlanes(ctx.clinicId, planes.map((p) => p.id));

  // La zona de la clínica, una vez por petición (revisión t5, A8): cada cuenta la necesita para su «vencido».
  const zona = planes.length
    ? (await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } }).catch(() => null))?.timezone ?? null
    : null;
  const salida: PlanConCuenta[] = [];
  for (const p of planes) {
    const cuenta = await leerCuentaDelPlan({ clinicId: ctx.clinicId, planId: p.id, timezone: zona });
    if (!cuenta) continue;
    const filas = filasPorPlan.get(p.id) ?? [];
    salida.push({
      planId: p.id,
      nombre: p.name,
      estado: p.status,
      conFilas: filas.length > 0,
      total: cuenta.total,
      facturado: cuenta.facturado,
      pagado: cuenta.pagado,
      soloDelPlan: cuenta.soloDelPlan,
      saldo: cuenta.saldo,
      porFacturar: cuenta.porFacturar,
      aceptado: cuenta.aceptado,
      hecho: cuenta.hecho,
      debe: cuenta.debe,
      saldoAFavor: cuenta.saldoAFavor,
      porHacer: cuenta.porHacer,
      vencido: cuenta.vencido,
      facturasDeAntes: cuenta.facturasDeAntes ?? [],
      notas: cuenta.notas.map((n) => ({
        invoiceId: n.id, invoiceNumber: n.invoiceNumber, status: n.status, total: n.total, paid: n.paid, createdAt: n.createdAt ?? "",
      })),
      filas: filas.map((f) => ({
        id: f.id, planId: f.planId, nombre: f.nombre, procedureId: f.procedureId, dientes: f.dientes, cantidad: f.cantidad,
        estado: f.estado, hechoEn: f.hechoEn ? f.hechoEn.toISOString() : null, invoiceId: f.invoiceId,
      })),
    });
  }
  // Solo planes de ESTE paciente (los de la lista): una cita de otro paciente no dice nada aquí.
  const delPaciente = new Set(planes.map((p) => p.id));
  const planesDeLaCita = appointmentId
    ? Array.from(new Set((await filasAgendadasEnCita(ctx.clinicId, appointmentId)).map((f) => f.planId))).filter((id) => delPaciente.has(id))
    : [];
  return NextResponse.json({ planes: salida, planesDeLaCita });
}
