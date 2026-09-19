// De la nota guardada a los datos planos del PDF y de los envíos. PURO (sin
// Prisma ni Next) para que la prueba lo use tal cual.

import { formatConsentDateTime } from "@/lib/consent/dates";
import type { DocumentoParaPdf } from "@/lib/patient-documents/pdf";
import type { NotaCompleta } from "./service";

export const TIPO_NOTA = "Nota de evolución";

/** Pura: de la nota guardada a lo que imprime el PDF y mandan los envíos. */
export function notaParaPdf(nota: NotaCompleta, timezone: string | null): DocumentoParaPdf {
  const e = nota.encabezado;
  const firmado = nota.status === "SIGNED";
  return {
    id: nota.id,
    tipo: TIPO_NOTA,
    titulo: nota.title,
    fecha: e.fecha,
    clinicaNombre: e.clinicaNombre,
    clinicaDireccion: e.clinicaDireccion,
    clinicaTelefono: e.clinicaTelefono,
    logoUrl: e.logoUrl,
    pacienteNombre: e.pacienteNombre,
    pacienteNumero: e.pacienteNumero,
    pacienteCurp: e.pacienteCurp,
    pacienteSinCurp: e.pacienteSinCurp,
    doctorNombre: e.doctorNombre,
    cedula: e.cedula,
    doctorCedulaEspecialidad: e.doctorCedulaEspecialidad,
    doctorEspecialidad: e.doctorEspecialidad,
    cuerpoHtml: nota.body,
    firmado,
    firmadoEl: firmado && nota.signedAt ? formatConsentDateTime(nota.signedAt, timezone) : null,
  };
}
