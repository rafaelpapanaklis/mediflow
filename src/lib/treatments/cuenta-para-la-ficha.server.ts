// La cuenta de UN plan con la forma que pinta la ficha (`PlanConCuenta`): la de cada plan en
// GET /api/treatments/cuentas y, desde la v14 (QA de Claude, 28-oct), la que devuelven «Hecho» /
// «Deshacer» (PATCH /api/treatments/[id]) y «Cerrar plan» (POST …/cerrar). Así la tarjeta «Cuenta del
// plan» cambia con la respuesta del servidor, sin esperar a releer todos los planes del paciente
// (unas 9 consultas por plan, en serie: con 166 ms por viaje eran segundos).

import { prisma } from "@/lib/prisma";
import { leerCuentaDelPlan } from "./cobro.server";
import { repoFilas } from "./items-db";
import type { FilaDelPlan } from "./items";
import type { PlanConCuenta } from "./sin-doble-cobro";

/** Con las filas vivas del plan ya leídas (la ruta de cuentas las lee de todos los planes a la vez). */
export async function cuentaParaLaFicha(args: {
  clinicId: string;
  plan: { id: string; name: string; status: string };
  filas: FilaDelPlan[];
  timezone: string | null;
}): Promise<PlanConCuenta | null> {
  const { clinicId, plan, filas, timezone } = args;
  if (!clinicId) return null;
  const cuenta = await leerCuentaDelPlan({ clinicId, planId: plan.id, timezone });
  if (!cuenta) return null;
  return {
    planId: plan.id,
    nombre: plan.name,
    estado: plan.status,
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
    aCuotas: cuenta.aCuotas ?? false,
    facturasDeAntes: cuenta.facturasDeAntes ?? [],
    notas: cuenta.notas.map((n) => ({
      invoiceId: n.id, invoiceNumber: n.invoiceNumber, status: n.status, total: n.total, paid: n.paid, createdAt: n.createdAt ?? "",
    })),
    filas: filas.map((f) => ({
      id: f.id, planId: f.planId, nombre: f.nombre, procedureId: f.procedureId, dientes: f.dientes, cantidad: f.cantidad,
      estado: f.estado, hechoEn: f.hechoEn ? f.hechoEn.toISOString() : null, invoiceId: f.invoiceId,
    })),
  };
}

/**
 * La cuenta de un plan recién cambiado, para la respuesta de la acción. Nunca tumba la acción (ya
 * se hizo): si algo falla, `null` y la ficha relee como siempre.
 */
export async function cuentaDeUnPlanParaLaFicha(clinicId: string, planId: string): Promise<PlanConCuenta | null> {
  if (!clinicId || !planId) return null;
  try {
    const plan = await prisma.treatmentPlan.findFirst({ where: { id: planId, clinicId }, select: { id: true, name: true, status: true } });
    if (!plan) return null;
    const filas = await repoFilas.leer(clinicId, plan.id);
    const zona = (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }).catch(() => null))?.timezone ?? null;
    return await cuentaParaLaFicha({ clinicId, plan, filas, timezone: zona });
  } catch {
    return null;
  }
}
