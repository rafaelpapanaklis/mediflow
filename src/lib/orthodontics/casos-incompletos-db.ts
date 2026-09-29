import { prisma } from "@/lib/prisma";
import { cargarModosDeCobro } from "./billing-mode-db";
import { normalizarOrthoBillingMode } from "./billing-mode";
import { cargarPlanesDetalle } from "./plan-detalle-db";
import { pasoQueFalta, piezasQueFaltan, type PasoDelCaso, type PiezaFaltante } from "./plan-detalle";
import { ACTIVE_PLAN_STATUSES } from "./specialty-kpis";

export { enlaceParaCompletar } from "./casos-incompletos-ruta";

// Ortodoncia — «Casos con diagnóstico o plan incompleto» (ws1-t12): la cuenta y la lista de Tablero y Alertas.
// Útil sobre todo para los casos migrados de Dentalink, que entran casi vacíos. Solo casos ACTIVOS (por colocar,
// en curso, en pausa, en retención). `clinicId` de la sesión; los casos ya vienen filtrados por la visibilidad del
// paciente (`loadOrthoCases`). Nunca lanza: sin dato, ninguno.

export interface CasoIncompleto {
  planId: string;
  patientId: string;
  patientName: string;
  /** Lo que falta, por paso. */
  faltan: PiezaFaltante[];
  /** A qué paso lleva el acceso directo: el diagnóstico va antes que el plan. */
  paso: PasoDelCaso;
}

interface FilaDelCaso {
  id: string;
  treatingDoctorId?: string | null;
  retentionPlanText: string | null;
  invoiceId?: string | null;
  diagnosis: { etiologyNotes: string | null; clinicalSummary: string | null } | null;
}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/** El diagnóstico lleva la marca que le pone la migración (valores neutros, no mediciones). */
export function esDiagnosticoMigrado(etiologyNotes: string | null | undefined): boolean {
  return /migrado de dentalink/i.test(etiologyNotes ?? "");
}

export async function cargarCasosIncompletos(
  clinicId: string,
  cases: ReadonlyArray<{ planId: string; patientId: string; patientName: string; status: string }>,
): Promise<CasoIncompleto[]> {
  if (!clinicId) return [];
  const activos = cases.filter((c) => (ACTIVE_PLAN_STATUSES as string[]).includes(c.status));
  if (activos.length === 0) return [];
  const ids = activos.map((c) => c.planId);
  try {
    const seleccion = {
      id: true,
      retentionPlanText: true,
      diagnosis: { select: { etiologyNotes: true, clinicalSummary: true } },
    } as const;
    const donde = { clinicId, id: { in: ids }, deletedAt: null };
    let filas: FilaDelCaso[];
    try {
      filas = await prisma.orthodonticTreatmentPlan.findMany({ where: donde, select: { ...seleccion, treatingDoctorId: true, invoiceId: true } });
    } catch (e) {
      if (!esRelacionAusente(e)) throw e;
      // Sin las columnas de doctor / factura (SQL sin pegar): se dice lo demás.
      filas = await prisma.orthodonticTreatmentPlan.findMany({ where: donde, select: seleccion });
    }
    const [detalles, modos] = await Promise.all([cargarPlanesDetalle(clinicId, ids), cargarModosDeCobro(clinicId, ids)]);
    const porId = new Map(filas.map((f) => [f.id, f]));
    const salida: CasoIncompleto[] = [];
    for (const c of activos) {
      const f = porId.get(c.planId);
      if (!f) continue;
      const faltan = piezasQueFaltan({
        diagnosticoMigrado: esDiagnosticoMigrado(f.diagnosis?.etiologyNotes),
        resumenClinico: f.diagnosis?.clinicalSummary,
        doctorId: f.treatingDoctorId,
        detalle: detalles.get(c.planId) ?? null,
        retencion: f.retentionPlanText,
        billingMode: normalizarOrthoBillingMode(modos.get(c.planId)),
        tieneFactura: Boolean(f.invoiceId),
      });
      const paso = pasoQueFalta(faltan);
      if (paso) salida.push({ planId: c.planId, patientId: c.patientId, patientName: c.patientName, faltan, paso });
    }
    return salida.sort((a, b) => b.faltan.length - a.faltan.length || a.patientName.localeCompare(b.patientName, "es"));
  } catch (e) {
    console.warn("[ortodoncia:incompletos] no se pudieron calcular los casos incompletos:", e);
    return [];
  }
}
