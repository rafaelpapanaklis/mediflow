import { prisma } from "@/lib/prisma";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { cargarPlanesDetalle } from "./plan-detalle-db";
import { contarControlesHechos } from "./controles-hechos";

// Ortodoncia — «Control X de N» para las pantallas del módulo (Tablero y Controles), en LOTE (ws1-t12).
// Solo se calcula para los casos cuyo plan dice cuántos controles prevé (`planDetalle.controlesPrevistos`):
// sin ese dato no hay «de N» que decir y no se gasta ni una consulta más. `clinicId` de la sesión; nunca lanza.

export interface CasoParaProgreso {
  planId: string;
  patientId: string;
  /** Colocación, o inicio planeado, o apertura del caso. */
  inicio: Date | null;
}

export interface ProgresoDelCaso {
  hechos: number;
  previstos: number;
}

export async function cargarProgresoDeControles(
  clinicId: string,
  zona: string,
  casos: readonly CasoParaProgreso[],
  ahora: Date = new Date(),
): Promise<Map<string, ProgresoDelCaso>> {
  const salida = new Map<string, ProgresoDelCaso>();
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId || casos.length === 0) return salida;
  try {
    const planes = await cargarPlanesDetalle(clinicId, casos.map((c) => c.planId));
    const conPrevistos = casos.filter((c) => (planes.get(c.planId)?.controlesPrevistos ?? 0) > 0);
    if (conPrevistos.length === 0) return salida;

    const inicios = conPrevistos.map((c) => c.inicio?.getTime()).filter((t): t is number => typeof t === "number");
    const desde = new Date((inicios.length > 0 ? Math.min(...inicios) : ahora.getTime()) - 2 * 86_400_000);
    const pacientes = [...new Set(conPrevistos.map((c) => c.patientId))];
    const planIds = conPrevistos.map((c) => c.planId);

    const [citas, hojas] = await Promise.all([
      prisma.appointment.findMany({
        where: { clinicId, patientId: { in: pacientes }, type: TIPO_CITA_CONTROL_ORTO, startsAt: { gte: desde, lte: new Date(ahora.getTime() + 86_400_000) } },
        select: { id: true, patientId: true, startsAt: true, endsAt: true, status: true },
        orderBy: { startsAt: "asc" },
        take: 20_000,
      }),
      prisma.orthoTreatmentCard
        .findMany({
          where: { clinicId, treatmentPlanId: { in: planIds }, deletedAt: null },
          select: { treatmentPlanId: true, appointmentId: true, visitDate: true },
          take: 20_000,
        })
        .catch((e: unknown) => {
          const code = (e as { code?: string } | null)?.code;
          if (code === "P2021" || code === "P2022") return [] as { treatmentPlanId: string; appointmentId: string | null; visitDate: Date }[];
          throw e;
        }),
    ]);

    for (const c of conPrevistos) {
      const hechos = contarControlesHechos({
        citas: citas.filter((x) => x.patientId === c.patientId),
        hojas: hojas.filter((h) => h.treatmentPlanId === c.planId).map((h) => ({ appointmentId: h.appointmentId, visitDate: h.visitDate })),
        inicio: c.inicio,
        ahora,
        zona,
      });
      salida.set(c.planId, { hechos, previstos: planes.get(c.planId)!.controlesPrevistos! });
    }
  } catch (e) {
    console.warn("[ortodoncia:progreso] no se pudo calcular «Control X de N»:", e);
  }
  return salida;
}

const EN_CURSO = ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"];
const TERMINADAS = ["COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"];

/**
 * El número de control que lleva cada cita POR ATENDER de un paciente: hechos + 1, +2… en orden de fecha.
 * Una cita que ya cuenta entre los `hechos` (el paciente ya llegó, o su hoja ya está registrada: la misma regla
 * de `visitasDelCaso`) lleva el número que ya tiene, hechos, no uno más. `cuentaYa` decide lo segundo.
 */
export function numerarCitasPorAtender<T extends { patientId: string; startsAt: Date; status: string }>(
  citas: readonly T[],
  progresoPorPaciente: ReadonlyMap<string, ProgresoDelCaso>,
  cuentaYa: (c: T) => boolean = () => false,
): Map<T, { numero: number; previstos: number }> {
  const porAtender = citas
    .filter((c) => !TERMINADAS.includes(c.status))
    .slice()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const vistas = new Map<string, number>();
  const salida = new Map<T, { numero: number; previstos: number }>();
  for (const c of porAtender) {
    const p = progresoPorPaciente.get(c.patientId);
    if (!p) continue;
    if (EN_CURSO.includes(c.status) || cuentaYa(c)) {
      salida.set(c, { numero: Math.max(1, p.hechos), previstos: p.previstos });
      continue;
    }
    const n = (vistas.get(c.patientId) ?? 0) + 1;
    vistas.set(c.patientId, n);
    salida.set(c, { numero: p.hechos + n, previstos: p.previstos });
  }
  return salida;
}
