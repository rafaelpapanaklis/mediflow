import { prisma } from "@/lib/prisma";
import { cargarNombresDeTecnica } from "./tecnicas-de-la-clinica-db";
import { cargarPlanesDetalle } from "./plan-detalle-db";
import { cargarDiagnosticosLegibles } from "./diagnostico-detalle-db";
import { armarCasoDeOrtodoncia, type ExpedienteOrtodoncia } from "./expediente-ortodoncia";

/**
 * Los casos de ortodoncia de UN paciente y sus hojas de control firmadas, para el
 * expediente PDF. `clinicId` y `patientId` salen de la sesión / del paciente ya
 * resuelto contra ella; sin alguno de los dos no se consulta (`clinicId:
 * undefined` no filtra nada en Prisma). Nunca lanza: tabla ausente o fallo → [].
 */
export async function leerOrtodonciaDelExpediente(clinicId: string, patientId: string): Promise<ExpedienteOrtodoncia[]> {
  if (!clinicId || !patientId) return [];
  try {
    const planes = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, patientId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        id: true,
        technique: true,
        status: true,
        startDate: true,
        installedAt: true,
        estimatedDurationMonths: true,
        droppedOutReason: true,
        diagnosisId: true,
        anchorageType: true,
        extractionsRequired: true,
        extractionsTeethFdi: true,
        treatingDoctor: { select: { firstName: true, lastName: true } },
        diagnosis: {
          select: {
            diagnosedAt: true,
            angleClassRight: true,
            angleClassLeft: true,
            overbiteMm: true,
            overjetMm: true,
            clinicalSummary: true,
          },
        },
      },
    });
    if (planes.length === 0) return [];
    const hojas = await prisma.orthoTreatmentCard.findMany({
      where: { clinicId, patientId, treatmentPlanId: { in: planes.map((p) => p.id) }, status: "SIGNED", deletedAt: null },
      orderBy: [{ visitDate: "asc" }, { cardNumber: "asc" }],
      take: 1000,
      select: { treatmentPlanId: true, cardNumber: true, visitDate: true, phaseKey: true, monthAt: true, soapP: true, indications: true, signedAt: true },
    }).catch(async (e: unknown) => {
      // `indications` es una columna de una ronda posterior: sin ella, lo demás sale igual.
      const code = (e as { code?: string } | null)?.code;
      if (code !== "P2022" && code !== "P2021") throw e;
      return (await prisma.orthoTreatmentCard.findMany({
        where: { clinicId, patientId, treatmentPlanId: { in: planes.map((p) => p.id) }, status: "SIGNED", deletedAt: null },
        orderBy: [{ visitDate: "asc" }, { cardNumber: "asc" }],
        take: 1000,
        select: { treatmentPlanId: true, cardNumber: true, visitDate: true, phaseKey: true, monthAt: true, soapP: true, signedAt: true },
      })).map((h) => ({ ...h, indications: null as string | null }));
    });
    const nombres = await cargarNombresDeTecnica(clinicId, planes.map((p) => p.id));
    // ws1-t12: el plan de tratamiento completo de cada caso (sin la columna, ninguno: el expediente sale como siempre).
    const detalles = await cargarPlanesDetalle(clinicId, planes.map((p) => p.id));
    const tads = new Map<string, number>();
    if (detalles.size > 0) {
      try {
        const grupos = await prisma.orthoTAD.groupBy({
          by: ["treatmentPlanId"],
          where: { clinicId, patientId, treatmentPlanId: { in: planes.map((p) => p.id) }, deletedAt: null },
          _count: { _all: true },
        });
        for (const g of grupos) tads.set(g.treatmentPlanId, g._count._all);
      } catch {
        /* sin la tabla de TAD: se dice el plan sin ese renglón */
      }
    }
    // ws1-t8: el diagnóstico completo de cada caso, ya redactado (sin la columna nueva, lo de siempre).
    const diagnosticos = await cargarDiagnosticosLegibles(clinicId, planes.map((p) => p.diagnosisId));
    return planes.map((p) => ({
      ...armarCasoDeOrtodoncia(
        p,
        hojas.filter((h) => h.treatmentPlanId === p.id),
        nombres.get(p.id),
        detalles.has(p.id) ? { detalle: detalles.get(p.id)!, tads: tads.get(p.id) ?? 0 } : null,
      ),
      diagnosticoCompleto: (diagnosticos.get(p.diagnosisId) ?? []).filter((sec) => sec.clave !== "clasificacion"),
    }));
  } catch (e) {
    console.warn("[expediente-pdf] no se pudo leer la ortodoncia del paciente:", e);
    return [];
  }
}
