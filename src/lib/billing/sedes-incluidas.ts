import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { findBranchMothers } from "@/lib/admin/mrr-core";
import type { PlanId } from "@/lib/billing/plans";
import {
  bloqueoDowngradePorSedes,
  datosDeSedeDesdeMadre,
  grupoDePago,
  type GrupoDePago,
} from "@/lib/billing/sedes-incluidas-core";

/**
 * SEDES INCLUIDAS — acceso a datos (ws1-t5). El criterio vive en `sedes-incluidas-core.ts`.
 * `clinicId` SIEMPRE sale de la sesión o de un registro de Stripe/BD, nunca del cliente.
 */

export interface GrupoDePagoConNombre extends GrupoDePago {
  /** Nombre de la clínica que paga (para los avisos). */
  pagadoraNombre: string | null;
}

const CAMPOS_FACTURACION = {
  id: true,
  name: true,
  createdAt: true,
  subscriptionStatus: true,
  monthlyPrice: true,
  stripeSubscriptionId: true,
  paypalSubscriptionId: true,
  subscriptionId: true,
  nextBillingDate: true,
} as const;

/** Quién paga por `clinicId` y qué sedes comparten ese pago. Sin dueño localizable: la clínica sola. */
export async function leerGrupoDePago(clinicId: string): Promise<GrupoDePagoConNombre> {
  if (!clinicId) throw new Error("leerGrupoDePago: falta clinicId");
  const solo: GrupoDePagoConNombre = { pagadoraId: clinicId, miembros: [clinicId], esSedeIncluida: false, pagadoraNombre: null };

  const propio = await prisma.user.findFirst({
    where: { clinicId, role: "SUPER_ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { supabaseId: true },
  });
  if (!propio) return solo;

  const duenos = await prisma.user.findMany({
    where: { supabaseId: propio.supabaseId, role: "SUPER_ADMIN", isActive: true },
    select: { supabaseId: true, clinicId: true },
  });
  if (duenos.length < 2) return solo;

  const clinicas = await prisma.clinic.findMany({
    where: { id: { in: duenos.map((d) => d.clinicId) } },
    select: CAMPOS_FACTURACION,
  });
  const grupo = grupoDePago(clinicId, clinicas, duenos);
  const pagadora = clinicas.find((c) => c.id === grupo.pagadoraId);
  return { ...grupo, pagadoraNombre: pagadora?.name ?? null };
}

/**
 * A1 — copia el estado de la MADRE a sus sedes incluidas (past_due / cancelled / suspendida / vencida y
 * también la reactivación). Idempotente: se llama DESPUÉS de cada escritura del estado de cobro de la madre
 * (webhook de Stripe, /admin, cron de caducidad, change-plan…). Si `clinicId` es una sede, o no tiene
 * sedes, no hace nada. NUNCA lanza: un fallo aquí no puede tumbar el webhook que lo llamó (se registra).
 */
export async function sincronizarSedesIncluidas(clinicId: string): Promise<number> {
  try {
    const grupo = await leerGrupoDePago(clinicId);
    if (grupo.esSedeIncluida || grupo.miembros.length < 2) return 0;
    const madre = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
    });
    if (!madre) return 0;
    const datos = datosDeSedeDesdeMadre(madre);
    if (!datos) return 0;
    const sedes = grupo.miembros.filter((id) => id !== clinicId);
    const r = await prisma.clinic.updateMany({
      where: { id: { in: sedes } },
      data: { ...datos, plan: datos.plan as never },
    });
    return r.count;
  } catch (err) {
    console.error("[sedes-incluidas] no se pudo sincronizar el estado de las sedes de", clinicId, err);
    return 0;
  }
}

/**
 * A2 — ¿puede esta clínica pasar a `planDestino` teniendo sedes incluidas? Devuelve el mensaje claro si NO
 * (el plan destino admite menos sedes de las que cuelgan de su pago), o null si puede. Lo usan change-plan,
 * el checkout de reactivación y el webhook de Stripe. Si no se puede leer, no bloquea (fallar abierto aquí
 * solo deja pasar lo que hoy ya pasa; el webhook y change-plan lo vuelven a comprobar).
 */
export async function bloqueoDeSedesParaPlan(clinicId: string, planDestino: PlanId): Promise<string | null> {
  try {
    const grupo = await leerGrupoDePago(clinicId);
    const { maxClinics } = await getPlanLimits(planDestino);
    const r = bloqueoDowngradePorSedes({ sedes: grupo.miembros.length, maxClinicsDestino: maxClinics ?? null });
    return r.bloqueado ? r.mensaje : null;
  } catch (err) {
    console.error("[sedes-incluidas] no se pudo comprobar el tope de sedes de", clinicId, err);
    return null;
  }
}

/**
 * Para un lote de clínicas: sede incluida → su madre (solo las que son sede incluida). Tres consultas en
 * total sin importar cuántas clínicas lleguen (lo usa el cron de excedente CFDI, que recorre muchas).
 */
export async function madresDeSedes(clinicIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (clinicIds.length === 0) return out;
  const propios = await prisma.user.findMany({
    where: { clinicId: { in: clinicIds }, role: "SUPER_ADMIN", isActive: true },
    select: { supabaseId: true },
  });
  const supabaseIds = Array.from(new Set(propios.map((u) => u.supabaseId)));
  if (supabaseIds.length === 0) return out;
  const duenos = await prisma.user.findMany({
    where: { supabaseId: { in: supabaseIds }, role: "SUPER_ADMIN", isActive: true },
    select: { supabaseId: true, clinicId: true },
  });
  const clinicas = await prisma.clinic.findMany({
    where: { id: { in: Array.from(new Set(duenos.map((d) => d.clinicId))) } },
    select: CAMPOS_FACTURACION,
  });
  const porDueno = new Map<string, typeof duenos>();
  for (const d of duenos) {
    const l = porDueno.get(d.supabaseId);
    if (l) l.push(d);
    else porDueno.set(d.supabaseId, [d]);
  }
  porDueno.forEach((filas) => {
    if (filas.length < 2) return;
    findBranchMothers(clinicas, filas).forEach((madre, sede) => out.set(sede, madre));
  });
  return out;
}

/** M5 — timbrados del periodo de TODO el grupo de pago de `clinicId` (la suya incluida). */
export async function cfdiTimbradosDelGrupo(clinicId: string, period: string, propios: number): Promise<number> {
  try {
    const grupo = await leerGrupoDePago(clinicId);
    if (grupo.miembros.length < 2) return propios;
    const filas = await prisma.cfdiUsage.findMany({
      where: { clinicId: { in: grupo.miembros }, period },
      select: { clinicId: true, stamped: true },
    });
    return filas.reduce((a, f) => a + (f.clinicId === clinicId ? 0 : Math.max(0, f.stamped)), Math.max(0, propios));
  } catch (err) {
    console.error("[sedes-incluidas] no se pudo sumar el CFDI del grupo de", clinicId, err);
    return propios;
  }
}
