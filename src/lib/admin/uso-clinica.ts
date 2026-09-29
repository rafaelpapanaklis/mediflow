import "server-only";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import type { PlanLimits } from "@/lib/plan-shared";
import { medirAlmacenamiento } from "@/lib/storage-usage";
import { desgloseVacio, totalDesglose } from "@/lib/storage-usage-core";
import { cfdiPeriodFor } from "@/lib/cfdi-quota";
import { tokensVigentes, USO_VACIO, type UsoClinica } from "./uso-core";

/**
 * Lo MEDIDO de cada clínica para /admin (almacenamiento, CFDI del mes, usuarios,
 * sedes, saldo IA), en consultas AGREGADAS: son las mismas con 9 clínicas o
 * con 500, en tandas (el pooler se satura por encima de 7 por Promise.all).
 *
 * Cada consulta lleva su `.catch`: un timeout no puede tumbar la página, y
 * lo que no se pudo medir sale como `null` («sin dato»), nunca como 0. Qué
 * mide cada cosa está documentado en `./uso-core`.
 *
 * /admin es la vista del dueño de la plataforma: las consultas son
 * deliberadamente cross-tenant y lo que las protege es el gate de sesión del
 * layout de /admin.
 */

export interface ClinicaParaUso {
  id: string;
  plan: string;
  timezone?: string | null;
  aiTokensUsed?: number | null;
  aiTokensLimit?: number | null;
  /** Para poner el contador a 0 si es de un mes anterior (ver `tokensVigentes`). */
  aiLastResetAt?: Date | string | null;
}

export interface UsoMedido {
  porClinica: Map<string, UsoClinica>;
  limites: Record<string, PlanLimits>;
  /** Qué no se pudo medir, para decirlo en pantalla. */
  avisos: string[];
}

/** Los límites de cada plan desde plan_configs (con caché), una lectura por plan. */
export async function cargarLimitesPorPlan(): Promise<Record<string, PlanLimits>> {
  const out: Record<string, PlanLimits> = {};
  // En serie: getPlanLimits ya cachea y son 3 planes; no vale la pena abrir 3 conexiones.
  for (const id of PLAN_IDS) out[id] = await getPlanLimits(id);
  return out;
}

/**
 * Una consulta que no puede tumbar la página: si falla, devuelve null y se
 * apunta qué fue. Envoltorio y no `.catch` encadenado a propósito: con el
 * `.catch` TypeScript perdía el tipo del groupBy (`_sum`, `_count`).
 */
async function seguro<T>(p: Promise<T>, que: string, avisos: string[]): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.error(`[admin/uso] ${que}:`, e);
    avisos.push(que);
    return null;
  }
}

export async function medirUsoClinicas(clinicas: ClinicaParaUso[], ahora = new Date()): Promise<UsoMedido> {
  const avisos: string[] = [];
  const limites = await cargarLimitesPorPlan();
  const ids = clinicas.map((c) => c.id);
  if (ids.length === 0) return { porClinica: new Map(), limites, avisos };
  const en = { clinicId: { in: ids } };

  // Periodo CFDI de cada clínica en SU zona (cfdi_usage se indexa así). Son una
  // o dos claves distintas para todo el país.
  const periodoDe = new Map(clinicas.map((c) => [c.id, cfdiPeriodFor(ahora, c.timezone)]));
  const periodos = Array.from(new Set(periodoDe.values()));

  // ── Tanda 1 (2): almacenamiento (LA MISMA función que la cuota de subida y la
  //    tarjeta de Suscripción: @/lib/storage-usage) y CFDI del mes ─────────────
  const [almacen, cfdi] = await Promise.all([
    seguro(medirAlmacenamiento(ids), "almacenamiento", avisos),
    seguro(prisma.cfdiUsage.findMany({ where: { ...en, period: { in: periodos } }, select: { clinicId: true, period: true, stamped: true } }), "CFDI del mes", avisos),
  ]);
  for (const a of almacen?.avisos ?? []) avisos.push(a);

  // ── Tanda 2 (3): usuarios activos, dueños (sedes) y saldo IA ─────────────
  const [usuarios, duenos, monederos] = await Promise.all([
    seguro(prisma.user.groupBy({ by: ["clinicId"], where: { ...en, isActive: true }, _count: { _all: true } }), "usuarios", avisos),
    // Dueño = SUPER_ADMIN activo, el mismo criterio que countOwnedClinics. Se
    // cargan TODOS (no sólo los de estas clínicas): la sede de un dueño puede
    // estar fuera de la lista y sigue contando en su tope.
    seguro(prisma.user.findMany({ where: { role: "SUPER_ADMIN", isActive: true }, select: { supabaseId: true, clinicId: true } }), "sedes por dueño", avisos),
    seguro(prisma.aiWallet.findMany({ where: en, select: { clinicId: true, balanceCents: true, status: true } }), "saldo IA", avisos),
  ]);

  const mUsuarios = new Map<string, number>();
  for (const f of usuarios ?? []) mUsuarios.set(f.clinicId, f._count._all);
  const mCfdi = new Map<string, number>();
  for (const f of cfdi ?? []) if (periodoDe.get(f.clinicId) === f.period) mCfdi.set(f.clinicId, f.stamped);
  const sedesPorDueno = new Map<string, number>();
  const duenoDeClinica = new Map<string, string>();
  for (const d of duenos ?? []) {
    sedesPorDueno.set(d.supabaseId, (sedesPorDueno.get(d.supabaseId) ?? 0) + 1);
    if (!duenoDeClinica.has(d.clinicId)) duenoDeClinica.set(d.clinicId, d.supabaseId);
  }
  const mMonedero = new Map<string, { balanceCents: number; status: string }>();
  for (const w of monederos ?? []) mMonedero.set(w.clinicId, { balanceCents: w.balanceCents, status: String(w.status) });

  const porClinica = new Map<string, UsoClinica>();
  for (const c of clinicas) {
    const lim = limites[c.plan as PlanId] ?? null;
    const dueno = duenoDeClinica.get(c.id);
    const w = mMonedero.get(c.id);
    porClinica.set(c.id, {
      ...USO_VACIO,
      storageUsado: almacen ? totalDesglose(almacen.porClinica.get(c.id) ?? desgloseVacio()) : null,
      storageTope: lim?.storageBytes ?? null,
      tokensUsados: tokensVigentes(c.aiTokensUsed ?? 0, c.aiLastResetAt, ahora),
      tokensTope: c.aiTokensLimit ?? 0,
      cfdiUsados: cfdi === null ? null : (mCfdi.get(c.id) ?? 0),
      cfdiIncluidos: lim?.cfdiMonthly ?? 0,
      usuarios: usuarios === null ? null : (mUsuarios.get(c.id) ?? 0),
      usuariosTope: lim?.maxUsers ?? null,
      sedes: duenos === null ? null : dueno ? (sedesPorDueno.get(dueno) ?? 1) : null,
      sedesTope: lim?.maxClinics ?? null,
      saldoIaCents: monederos === null ? null : (w?.balanceCents ?? null),
      saldoIaStatus: monederos === null ? "SIN_DATO" : (w?.status ?? null),
    });
  }

  return { porClinica, limites, avisos };
}
