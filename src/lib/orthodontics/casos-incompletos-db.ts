import { prisma } from "@/lib/prisma";
import { cargarModosDeCobro } from "./billing-mode-db";
import { normalizarOrthoBillingMode } from "./billing-mode";
import { cargarPlanesDetalle } from "./plan-detalle-db";
import { cargarDiagnosticosDetalle } from "./diagnostico-detalle-db";
import { datoDelPlanSinCapturar, pasoQueFalta, piezasQueFaltan, type PasoDelCaso, type PiezaFaltante } from "./plan-detalle";
import { ACTIVE_PLAN_STATUSES } from "./specialty-kpis";
import { esCasoMigrado, estaColocado } from "./completar-casos";

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

/**
 * ws1-t8 (F11/M8): el caso incompleto con lo que necesita «Completar varios a la vez». `cargarCasosIncompletos` (Tablero
 * y Alertas) devuelve la parte de `CasoIncompleto`; la tabla, todo.
 */
export interface CasoIncompletoDetallado extends Omit<CasoIncompleto, "paso"> {
  /** null = ya no le falta nada (solo sale con `incluirMarcados`: la marca M8 lo sacó de la lista). */
  paso: PasoDelCaso | null;
  migrado: boolean;
  sinDiagnosticoMarcado: boolean;
  doctorId: string | null;
  /** `estimatedDurationMonths`, o null si es el relleno neutro («sin capturar»). */
  duracionMeses: number | null;
  controlesPrevistos: number | null;
}

interface FilaDelCaso {
  id: string;
  diagnosisId: string;
  treatingDoctorId?: string | null;
  invoiceId?: string | null;
  installedAt: Date | null;
  estimatedDurationMonths: number;
  retentionPlanText: string | null;
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
  const detallados = await cargarCasosIncompletosDetallados(clinicId, cases);
  const salida: CasoIncompleto[] = [];
  for (const { planId, patientId, patientName, faltan, paso } of detallados) {
    if (paso) salida.push({ planId, patientId, patientName, faltan, paso });
  }
  return salida;
}

/** Lo mismo que `cargarCasosIncompletos`, con los datos que edita «Completar varios a la vez». Nunca lanza. */
export async function cargarCasosIncompletosDetallados(
  clinicId: string,
  cases: ReadonlyArray<{ planId: string; patientId: string; patientName: string; status: string }>,
  /** También los casos ya completos que llevan la marca «migrado, sin datos de diagnóstico» (para poder quitarla). */
  opciones: { incluirMarcados?: boolean } = {},
): Promise<CasoIncompletoDetallado[]> {
  if (!clinicId) return [];
  const activos = cases.filter((c) => (ACTIVE_PLAN_STATUSES as string[]).includes(c.status));
  if (activos.length === 0) return [];
  const ids = activos.map((c) => c.planId);
  try {
    const seleccion = {
      id: true,
      diagnosisId: true,
      installedAt: true,
      estimatedDurationMonths: true,
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
    const [detalles, modos, diagnosticos] = await Promise.all([
      cargarPlanesDetalle(clinicId, ids),
      cargarModosDeCobro(clinicId, ids),
      cargarDiagnosticosDetalle(clinicId, filas.map((f) => f.diagnosisId)),
    ]);
    const porId = new Map(filas.map((f) => [f.id, f]));
    const salida: CasoIncompletoDetallado[] = [];
    for (const c of activos) {
      const f = porId.get(c.planId);
      if (!f) continue;
      const detalle = detalles.get(c.planId) ?? null;
      const marcado = detalle?.migradoSinDiagnostico === true;
      const migrado = esCasoMigrado({
        etiologyNotes: f.diagnosis?.etiologyNotes,
        clinicalSummary: f.diagnosis?.clinicalSummary,
        retentionPlanText: f.retentionPlanText,
        migradoSinDiagnostico: marcado,
      });
      const faltan = piezasQueFaltan({
        diagnosticoMigrado: esDiagnosticoMigrado(f.diagnosis?.etiologyNotes),
        sinCapturar: diagnosticos.get(f.diagnosisId)?.sinCapturar ?? [],
        doctorId: f.treatingDoctorId,
        detalle,
        billingMode: normalizarOrthoBillingMode(modos.get(c.planId)),
        tieneFactura: Boolean(f.invoiceId),
        // F11: un caso migrado y ya colocado no pide «factura de colocación».
        casoMigrado: migrado,
        colocado: estaColocado({ installedAt: f.installedAt, status: c.status }),
      });
      const paso = pasoQueFalta(faltan);
      if (!paso && !(opciones.incluirMarcados && marcado)) continue;
      salida.push({
        planId: c.planId,
        patientId: c.patientId,
        patientName: c.patientName,
        faltan,
        paso,
        migrado,
        sinDiagnosticoMarcado: marcado,
        doctorId: f.treatingDoctorId ?? null,
        duracionMeses: datoDelPlanSinCapturar(detalle, "duracion") ? null : f.estimatedDurationMonths,
        controlesPrevistos: detalle?.controlesPrevistos ?? null,
      });
    }
    return salida.sort((a, b) => b.faltan.length - a.faltan.length || a.patientName.localeCompare(b.patientName, "es"));
  } catch (e) {
    console.warn("[ortodoncia:incompletos] no se pudieron calcular los casos incompletos:", e);
    return [];
  }
}
