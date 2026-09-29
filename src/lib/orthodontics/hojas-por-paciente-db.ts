// Ortodoncia — la última hoja de control de cada paciente (cualquier estado, con
// fecha de visita ya pasada). UNA sola lectura para Controles y para Alertas: así
// «Vino hoy» significa lo mismo en las dos pantallas (una hoja registrada también
// es un control hecho, aunque no tenga cita). `clinicId` de la sesión.

import { prisma } from "@/lib/prisma";

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function cargarUltimasHojasPorPaciente(
  clinicId: string,
  pacientes: readonly string[],
  ahora: Date,
): Promise<{ patientId: string; visitDate: Date }[]> {
  const salida: { patientId: string; visitDate: Date }[] = [];
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId || pacientes.length === 0) return salida;
  try {
    const grupos = await prisma.orthoTreatmentCard.groupBy({
      by: ["patientId"],
      where: { clinicId, patientId: { in: [...pacientes] }, visitDate: { lte: ahora } },
      _max: { visitDate: true },
    });
    for (const g of grupos) {
      if (g._max.visitDate) salida.push({ patientId: g.patientId, visitDate: g._max.visitDate });
    }
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
  }
  return salida;
}
