// Ortodoncia — cargador de «Pacientes en tratamiento» (ws1-t4 ronda 6). El
// I/O de `pacientes-modulo.ts`, que es puro y tiene los tests.
//
// Los casos salen de `loadOrthoCases`, la misma base que el Tablero, Alertas,
// Cobranza y Controles (ya filtrada por clínica y por visibilidad de
// paciente). Aquí se añade lo clínico: la técnica y las fases de cada caso, y
// cuándo fue y cuándo es su control.
//
// `clinicId` y `zonaHoraria` SIEMPRE de la sesión. Tres consultas en un
// `Promise.all` (menos de 7, regla del pooler), todas por clínica y acotadas
// a los casos y pacientes que esta persona puede ver.

import { prisma } from "@/lib/prisma";
import type { VisibilityViewer } from "@/lib/patient-visibility";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { loadOrthoCases } from "./tablero-data";
import { deudaDelCaso } from "./cobranza-caso";
import { cargarNombresDeTecnica } from "./tecnicas-de-la-clinica-db";
import { existeColumnaDeFacturasDelCaso } from "./cobro/extras-db";
import { leerHistorialDeCasos } from "./eliminar-caso-db";
import {
  controlesPorPaciente,
  filaDeCaso,
  type FilaDeCaso,
  type LoClinicoDelCaso,
} from "./pacientes-modulo";

/** Hasta dónde se mira hacia atrás y hacia adelante: igual que la pantalla Controles. */
const DIAS_DE_HISTORIAL = 365;
const DIAS_DE_FUTURO = 180;

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function cargarFilasDeCasos(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
  /** ws1-t8: leer también qué tiene cada caso (para ofrecer «Eliminar»). Solo lo pide quien puede editar el expediente. */
  opciones: { conHistorial?: boolean } = {},
): Promise<FilaDeCaso[]> {
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId) return [];

  const { cases, invoiceIdByPlanId, invoicesById } = await loadOrthoCases(clinicId, zonaHoraria, viewer, ahora);
  if (cases.length === 0) return [];

  const planIds = cases.map((c) => c.planId);
  const pacientes = Array.from(new Set(cases.map((c) => c.patientId)));

  const [planes, citas, hojas, nombresDeTecnica] = await Promise.all([
    prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, id: { in: planIds } },
      select: { id: true, technique: true, createdAt: true, phases: { select: { status: true, phaseKey: true } } },
    }),
    prisma.appointment.findMany({
      where: {
        clinicId,
        type: TIPO_CITA_CONTROL_ORTO,
        patientId: { in: pacientes },
        startsAt: {
          gte: new Date(ahora.getTime() - DIAS_DE_HISTORIAL * 86_400_000),
          lte: new Date(ahora.getTime() + DIAS_DE_FUTURO * 86_400_000),
        },
      },
      select: { patientId: true, startsAt: true, status: true },
      take: 5000,
    }),
    // Si la tabla de hojas todavía no existe en esta base, la pantalla sale
    // igual: el último control se lee solo de las citas atendidas.
    prisma.orthoTreatmentCard
      .groupBy({
        by: ["patientId"],
        where: { clinicId, patientId: { in: pacientes }, visitDate: { lte: ahora } },
        _max: { visitDate: true },
      })
      .catch((e: unknown) => {
        if (!esRelacionAusente(e)) throw e;
        return [];
      }),
    // ws1-t10: nombre propio de la técnica de cada caso (sin la columna: mapa vacío).
    cargarNombresDeTecnica(clinicId, planIds),
  ]);

  // ws1-t8: qué tiene cada caso, en tandas propias (menos de 7 consultas cada una).
  const historiales = opciones.conHistorial
    ? await leerHistorialDeCasos(
        prisma,
        clinicId,
        cases.flatMap((c) => {
          const creado = planes.find((p) => p.id === c.planId)?.createdAt;
          return creado
            ? [{ id: c.planId, patientId: c.patientId, createdAt: creado, invoiceId: invoiceIdByPlanId.get(c.planId) ?? null }]
            : [];
        }),
        { tolerante: true, columnaDeFacturas: await existeColumnaDeFacturasDelCaso() },
      ).catch((e: unknown) => {
        // Sin saber qué tiene cada caso, «Eliminar» no se ofrece; la lista sale igual.
        console.warn("[ortodoncia:casos] no se pudo leer el historial de los casos:", e);
        return null;
      })
    : null;
  // ws1-t4 (revisión final, fallo 1): el saldo de la fila es LO QUE DEBE EL CASO
  // (`deudaDelCaso`: plan o colocación + controles + extras), el mismo número de
  // Cobranza y de la ficha — antes solo la factura principal. Sin factura
  // principal y sin nada que deber, «sin plan» (null) como antes.
  const saldoDe = (c: (typeof cases)[number]): number | null => {
    const factura = invoicesById.get(invoiceIdByPlanId.get(c.planId) ?? "");
    const vigente = factura && factura.status !== "CANCELLED";
    const deuda = deudaDelCaso(c.cobranza, c.extrasPendientes).porCobrar;
    return vigente || deuda > 0 ? deuda : null;
  };

  const clinico = new Map<string, LoClinicoDelCaso>(
    planes.map((p) => [p.id, { technique: p.technique, techniqueLabel: nombresDeTecnica.get(p.id) ?? null, phases: p.phases }]),
  );
  const controles = controlesPorPaciente(
    citas,
    hojas.flatMap((h) => (h._max.visitDate ? [{ patientId: h.patientId, visitDate: h._max.visitDate }] : [])),
    ahora,
  );

  return cases
    .map((c) =>
      filaDeCaso(c, clinico.get(c.planId), controles.get(c.patientId), ahora, {
        saldoMxn: saldoDe(c),
        historial: historiales?.get(c.planId),
      }),
    )
    .filter((f): f is FilaDeCaso => f !== null)
    .sort((a, b) => a.patientName.localeCompare(b.patientName, "es"));
}
