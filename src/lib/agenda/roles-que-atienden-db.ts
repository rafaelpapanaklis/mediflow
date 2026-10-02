// El `doctor_not_found` de la Agenda con su MOTIVO (revisión de ws1-t10). Las puertas siguen validando con
// RECIBE_CITAS_WHERE; solo cuando esa lectura no encuentra a nadie se lee la fila por `{ id, clinicId }` para
// decir por qué (cuenta inactiva, casilla apagada, rol que no atiende o de otra clínica). Una lectura más, y
// solo en el camino del error.

import { prisma } from "@/lib/prisma";
import { cuerpoDoctorNoRecibeCitas, fraseNoRecibeCitas, motivoNoRecibeCitas } from "./roles-que-atienden";

async function filaDelDoctor(clinicId: string, doctorId: string) {
  // Sin clínica o sin id no se consulta: `clinicId: undefined` no filtraría nada.
  if (!clinicId || !doctorId) return null;
  return prisma.user.findFirst({
    where: { id: doctorId, clinicId },
    select: { role: true, isActive: true, agendaActive: true },
  });
}

/** El cuerpo del 404 de las APIs de la Agenda. `clinicId` SIEMPRE de la sesión. */
export async function cuerpoDoctorNoRecibeCitasDe(clinicId: string, doctorId: string) {
  return cuerpoDoctorNoRecibeCitas(await filaDelDoctor(clinicId, doctorId));
}

/** La frase para cuando el doctor lo pone el caso de ortodoncia (acciones de Controles y retención). */
export async function fraseTratanteNoRecibeCitas(clinicId: string, doctorId: string): Promise<string> {
  const fila = await filaDelDoctor(clinicId, doctorId);
  const motivo = motivoNoRecibeCitas(fila);
  // Carrera (lo encendieron entre las dos lecturas): sin motivo, la frase de siempre.
  if (!motivo) return "El doctor tratante de este caso no pudo recibir la cita en este momento. Inténtalo de nuevo.";
  return fraseNoRecibeCitas(motivo, { role: fila?.role, tratante: true });
}
