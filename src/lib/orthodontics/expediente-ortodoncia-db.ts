import { prisma } from "@/lib/prisma";
import { cargarNombresDeTecnica } from "./tecnicas-de-la-clinica-db";
import { cargarPlanesDetalle } from "./plan-detalle-db";
import { cargarDiagnosticosDetalle, cargarDiagnosticosLegibles } from "./diagnostico-detalle-db";
import { medidaSinCapturar } from "./diagnostico-detalle";
import { listarVersionesDelCaso } from "./versiones-caso-db";
import { lineaDeTiempo } from "./versiones-caso";
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
            etiologyNotes: true,
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
    // Las medidas y el Angle guardados como relleno («sin capturar») no se imprimen como un dato real.
    const detallesDx = await cargarDiagnosticosDetalle(clinicId, planes.map((p) => p.diagnosisId));
    // ws1-t8: las reevaluaciones de cada caso (versiones anteriores y sus motivos). Uno por uno: pocos casos por
    // paciente y así no se satura el pooler. Sin la tabla (SQL sin pegar) o si falla, el caso sale sin historial.
    const versiones = new Map<string, ExpedienteOrtodoncia["versiones"]>();
    for (const p of planes) {
      const cerradas = await listarVersionesDelCaso(clinicId, p.id).catch(() => null);
      if (!cerradas || cerradas.length === 0) continue;
      const inicio = p.diagnosis?.diagnosedAt ? p.diagnosis.diagnosedAt.toISOString() : cerradas[0]!.iniciadaEl;
      const linea = lineaDeTiempo(cerradas, inicio);
      const actual = linea[linea.length - 1]!;
      const orden = [...cerradas].sort((a, b) => a.numero - b.numero);
      versiones.set(p.id, {
        actual: { etiqueta: actual.etiqueta, desde: actual.desde },
        anteriores: linea.slice(0, -1).map((v, i) => ({
          etiqueta: v.etiqueta,
          desde: v.desde,
          hasta: v.hasta ?? orden[i]!.cerradaEl,
          motivo: orden[i]?.motivo ?? null,
          cerradaPor: orden[i]?.cerradaPor ?? null,
        })),
      });
    }
    return planes.map((p) => {
      const caso = armarCasoDeOrtodoncia(
        p,
        hojas.filter((h) => h.treatmentPlanId === p.id),
        nombres.get(p.id),
        detalles.has(p.id) ? { detalle: detalles.get(p.id)!, tads: tads.get(p.id) ?? 0 } : null,
      );
      const dx = detallesDx.get(p.diagnosisId) ?? null;
      return {
        ...caso,
        overbiteMm: medidaSinCapturar(dx, "overbiteMm", p.diagnosis?.etiologyNotes) ? null : caso.overbiteMm,
        overjetMm: medidaSinCapturar(dx, "overjetMm", p.diagnosis?.etiologyNotes) ? null : caso.overjetMm,
        claseAngleDerecha: medidaSinCapturar(dx, "angleClassRight", p.diagnosis?.etiologyNotes) ? null : caso.claseAngleDerecha,
        claseAngleIzquierda: medidaSinCapturar(dx, "angleClassLeft", p.diagnosis?.etiologyNotes) ? null : caso.claseAngleIzquierda,
        diagnosticoCompleto: (diagnosticos.get(p.diagnosisId) ?? []).filter((sec) => sec.clave !== "clasificacion"),
        ...(versiones.has(p.id) ? { versiones: versiones.get(p.id) } : {}),
      };
    });
  } catch (e) {
    console.warn("[expediente-pdf] no se pudo leer la ortodoncia del paciente:", e);
    return [];
  }
}
