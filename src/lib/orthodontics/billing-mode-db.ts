// ═══════════════════════════════════════════════════════════════════════════
// Lectura/escritura en LOTE de `orthodontic_treatment_plans.billingMode`
// (ws1-t1, Ola 2 · sql/ortodoncia-modo-cobro.sql) — SQL CRUDO a propósito,
// NUNCA declarado en prisma/schema.prisma: `orthodonticTreatmentPlan` se lee
// sin `select` explícito en más de 40 sitios fuera de esta parte (grep
// medido); declararlo ahí revienta con P2022 CUALQUIERA de esos mientras
// Rafael no pegue el SQL — es EXACTAMENTE lo que le pasó en vivo a
// `procedure_catalog` con `orthoIncludedInTreatment` (ver catalog-procedures.ts)
// antes de este arreglo. Mismo patrón que `orthodontic_billing_configs`
// (cobro/config-db.ts) e `invoices.orthodonticTreatmentPlanId`
// (cobro/extras-db.ts): sonda de columna + SQL crudo, EN SU PROPIA sonda,
// aparte de treatingDoctorId/invoiceId (alta-caso.sql/nucleo.sql).
//
// La usan tablero-data.ts, listarMensualidadesPorCobrar.ts, agenda/server.ts,
// cargarPanelDeCobro.ts, cobranza-db.ts y signTreatmentCard.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

let columna: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function columnaExiste(): Promise<boolean> {
  const t = Date.now();
  if (columna && (columna.existe || t - columna.at < TTL_MS)) return columna.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'orthodontic_treatment_plans' AND column_name = 'billingMode'
      ) AS existe`;
    columna = { existe: filas[0]?.existe === true, at: t };
    return columna.existe;
  } catch (e) {
    console.warn("[ortodoncia:modo-cobro] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la columna. */
export function _olvidarColumnaModoCobro(): void {
  columna = null;
}

/** `planIds` vacío = mapa vacío, sin consultar. Sin la columna (o sin filas), también mapa vacío: `normalizarOrthoBillingMode(undefined)` ya da PRECIO_TOTAL. */
export async function cargarModosDeCobro(clinicId: string, planIds: string[]): Promise<Map<string, string | null>> {
  const salida = new Map<string, string | null>();
  if (!clinicId || planIds.length === 0) return salida;
  if (!(await columnaExiste())) return salida;
  try {
    const filas = await prisma.$queryRaw<{ id: string; billingMode: string | null }[]>`
      SELECT "id", "billingMode"
        FROM "orthodontic_treatment_plans"
       WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(planIds)})`;
    for (const f of filas) salida.set(f.id, f.billingMode);
    return salida;
  } catch (e) {
    console.warn("[ortodoncia:modo-cobro] no se pudieron leer:", e);
    return salida;
  }
}

/** Mismo lector, para UN solo caso. `null` = PRECIO_TOTAL (default/legacy). */
export async function cargarModoDeCobro(clinicId: string, planId: string): Promise<string | null> {
  const mapa = await cargarModosDeCobro(clinicId, [planId]);
  return mapa.get(planId) ?? null;
}

/** Snapshot del modo AL NACER el caso (createTreatmentPlan.ts). No lanza si falta la columna: el caso queda en null = PRECIO_TOTAL, que es el default correcto de todas formas. */
export async function guardarModoDeCobroDelCaso(clinicId: string, planId: string, billingMode: string): Promise<void> {
  if (!(await columnaExiste())) {
    console.warn("[ortodoncia:modo-cobro] columna billingMode aún sin aplicar (sql/ortodoncia-modo-cobro.sql) — caso creado sin ella (PRECIO_TOTAL por default)");
    return;
  }
  try {
    await prisma.$executeRaw`
      UPDATE "orthodontic_treatment_plans"
         SET "billingMode" = ${billingMode}
       WHERE "id" = ${planId} AND "clinicId" = ${clinicId}`;
  } catch (e) {
    console.warn("[ortodoncia:modo-cobro] no se pudo guardar el modo del caso:", e);
  }
}
