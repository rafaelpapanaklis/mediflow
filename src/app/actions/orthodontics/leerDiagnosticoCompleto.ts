"use server";
// Ortodoncia — el «Diagnóstico» completo de un caso (ws1-t8), para el resumen de la pestaña y para el paso
// «Diagnóstico» (Editar diagnóstico / ventana «Abrir caso» de ws1-t12). Solo lectura: permiso clínico de ver
// (`medicalRecord.view`); `clinicId` de la sesión y el paciente se comprueba contra su visibilidad.
//
// Lee lo de siempre (columnas) + lo nuevo (`diagnosticoDetalle`, SQL crudo con sonda) + los REGISTROS
// INICIALES: el PDF del trazado cefalométrico (el ligado al diagnóstico; si no, el último trazado del caso;
// si no, el último PDF de cefalometría del paciente) y el escaneo, con su enlace firmado.

import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { signMaybeUrls } from "@/lib/storage";
import type { DiagnosticoDetalle } from "@/lib/orthodontics/diagnostico-detalle";
import type { DiagnosticoParaFormulario } from "@/lib/orthodontics/diagnostico-formulario";
import { cargarDiagnosticoDetalle, columnaDeDiagnosticoDetalleExiste } from "@/lib/orthodontics/diagnostico-detalle-db";
import { getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface ArchivoDelDiagnostico {
  id: string;
  nombre: string;
  fecha: string | null;
  url: string | null;
}

export interface DiagnosticoCompleto {
  diagnosisId: string;
  diagnosticadoEl: string;
  base: DiagnosticoParaFormulario & { initialPhotoSetId: string | null };
  detalle: DiagnosticoDetalle | null;
  /** false = falta pegar sql/ortodoncia-diagnostico-completo.sql: lo nuevo no se puede guardar. */
  columna: boolean;
  registros: {
    trazado: ArchivoDelDiagnostico | null;
    /** El trazado viene del diagnóstico (ligado) o se encontró en el caso/expediente. */
    trazadoLigado: boolean;
    escaneo: ArchivoDelDiagnostico | null;
    fotosIniciales: boolean;
    /** ANB medido en el trazado del caso, si lo hay (se ofrece como referencia, no se copia solo). */
    anbDelTrazado: number | null;
  };
  /** Para elegir en el paso: PDFs de cefalometría y escaneos del paciente (los más recientes primero). */
  archivos: { trazados: ArchivoDelDiagnostico[]; escaneos: ArchivoDelDiagnostico[] };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function leerDiagnosticoCompleto(diagnosisId: string): Promise<ActionResult<DiagnosticoCompleto>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");
  if (typeof diagnosisId !== "string" || !diagnosisId) return fail("Falta el diagnóstico");

  const d = await prisma.orthodonticDiagnosis.findFirst({
    where: { id: diagnosisId, clinicId: ctx.clinicId, deletedAt: null },
    include: {
      patient: { select: { visibleUserIds: true } },
      treatmentPlan: { select: { id: true } },
    },
  });
  if (!d) return fail("Diagnóstico no encontrado");
  if (!canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, d.patient?.visibleUserIds)) {
    return fail("Diagnóstico no encontrado");
  }

  const [detalle, columna, archivosCrudos] = await Promise.all([
    cargarDiagnosticoDetalle(ctx.clinicId, d.id),
    columnaDeDiagnosticoDetalleExiste(),
    prisma.patientFile
      .findMany({
        where: { clinicId: ctx.clinicId, patientId: d.patientId, deletedAt: null, category: { in: ["CEPH_ANALYSIS_PDF", "SCAN_STL"] } },
        select: { id: true, name: true, url: true, category: true, takenAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 40,
      })
      .catch(() => []),
  ]);

  // El último trazado del caso (Imagen y análisis), si la tabla existe.
  let trazadoDelCaso: { file: { id: string; name: string; url: string; createdAt: Date } | null; anb: number | null } | null = null;
  if (d.treatmentPlan?.id) {
    try {
      const t = await prisma.orthodonticCephalometryAnalysis.findFirst({
        where: { treatmentPlanId: d.treatmentPlan.id, clinicId: ctx.clinicId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { measurements: true, tracingPdfFile: { select: { id: true, name: true, url: true, createdAt: true } } },
      });
      if (t) {
        const anb = num((t.measurements as Record<string, unknown> | null)?.ANB);
        trazadoDelCaso = { file: t.tracingPdfFile, anb: anb !== null && Number.isFinite(anb) ? Math.round(anb * 10) / 10 : null };
      }
    } catch {
      /* sin la tabla de cefalometría: se sigue sin ella */
    }
  }

  const trazados = archivosCrudos.filter((a) => a.category === "CEPH_ANALYSIS_PDF");
  const escaneos = archivosCrudos.filter((a) => a.category === "SCAN_STL");
  const ligado = d.initialCephFileId ? archivosCrudos.find((a) => a.id === d.initialCephFileId) ?? null : null;
  const trazado = ligado ?? trazadoDelCaso?.file ?? trazados[0] ?? null;
  const escaneo = d.initialScanFileId ? escaneos.find((a) => a.id === d.initialScanFileId) ?? null : null;

  const [urlTrazado, urlEscaneo] = await signMaybeUrls([trazado?.url ?? null, escaneo?.url ?? null]).catch(() => ["", ""]);
  const aArchivo = (a: { id: string; name: string; takenAt?: Date | null; createdAt: Date }, url: string | null = null): ArchivoDelDiagnostico => ({
    id: a.id,
    nombre: a.name,
    fecha: (a.takenAt ?? a.createdAt).toISOString(),
    url,
  });

  return ok({
    diagnosisId: d.id,
    diagnosticadoEl: d.diagnosedAt.toISOString(),
    base: {
      angleClassRight: d.angleClassRight,
      angleClassLeft: d.angleClassLeft,
      overbiteMm: num(d.overbiteMm),
      overbitePercentage: d.overbitePercentage,
      overjetMm: num(d.overjetMm),
      midlineDeviationMm: num(d.midlineDeviationMm),
      crowdingUpperMm: num(d.crowdingUpperMm),
      crowdingLowerMm: num(d.crowdingLowerMm),
      crossbite: d.crossbite,
      crossbiteDetails: d.crossbiteDetails,
      openBite: d.openBite,
      openBiteDetails: d.openBiteDetails,
      etiologySkeletal: d.etiologySkeletal,
      etiologyDental: d.etiologyDental,
      etiologyFunctional: d.etiologyFunctional,
      etiologyNotes: d.etiologyNotes,
      habits: d.habits as unknown as string[],
      habitsDescription: d.habitsDescription,
      dentalPhase: d.dentalPhase,
      skeletalPattern: d.skeletalPattern ?? null,
      tmjPainPresent: d.tmjPainPresent,
      tmjClickingPresent: d.tmjClickingPresent,
      tmjNotes: d.tmjNotes,
      clinicalSummary: d.clinicalSummary,
      initialCephFileId: d.initialCephFileId,
      initialScanFileId: d.initialScanFileId,
      initialPhotoSetId: d.initialPhotoSetId,
    },
    detalle,
    columna,
    registros: {
      trazado: trazado ? aArchivo(trazado, urlTrazado || null) : null,
      trazadoLigado: Boolean(ligado),
      escaneo: escaneo ? aArchivo(escaneo, urlEscaneo || null) : null,
      fotosIniciales: Boolean(d.initialPhotoSetId),
      anbDelTrazado: trazadoDelCaso?.anb ?? null,
    },
    archivos: {
      trazados: trazados.map((a) => aArchivo(a)),
      escaneos: escaneos.map((a) => aArchivo(a)),
    },
  });
}
