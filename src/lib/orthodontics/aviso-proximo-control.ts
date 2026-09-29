// Ortodoncia — «Avisar próximo control»: a quién va y qué dice (ws1-t8, punto 2 de la
// auditoría de conexiones). Puro, sin I/O. Misma regla que la mensualidad y la cobranza:
// si el caso tiene responsable de pago (tutor) con teléfono, el aviso va a ÉL, no al niño.

export interface DestinoAviso {
  telefono: string;
  /** El teléfono es el del responsable de pago del caso. */
  esResponsable: boolean;
}

export type ResultadoDestino = { ok: true; destino: DestinoAviso } | { ok: false; motivo: string };

export const MOTIVO_SIN_TELEFONO_PACIENTE = "El paciente no tiene teléfono registrado.";
export const MOTIVO_SIN_TELEFONO_NINGUNO = "Ni el paciente ni su responsable de pago tienen teléfono registrado.";

export function destinoDelAviso(args: {
  responsablePhone?: string | null;
  /** El caso tiene responsable de pago (aunque no tenga teléfono). */
  hayResponsable?: boolean;
  pacientePhone?: string | null;
}): ResultadoDestino {
  const tutor = args.responsablePhone?.trim();
  if (tutor) return { ok: true, destino: { telefono: tutor, esResponsable: true } };
  const paciente = args.pacientePhone?.trim();
  if (paciente) return { ok: true, destino: { telefono: paciente, esResponsable: false } };
  return { ok: false, motivo: args.hayResponsable ? MOTIVO_SIN_TELEFONO_NINGUNO : MOTIVO_SIN_TELEFONO_PACIENTE };
}

export function textoAvisoProximoControl(args: {
  paciente: string;
  clinica: string;
  fechaTexto: string;
  horaTexto: string;
  paraResponsable: boolean;
}): string {
  const cambio = "Si necesitas cambiarlo, escríbenos por aquí.";
  if (args.paraResponsable) {
    return `Hola, el próximo control de ortodoncia de ${args.paciente} en ${args.clinica} quedó para el ${args.fechaTexto} a las ${args.horaTexto}. ${cambio}`;
  }
  return `Hola ${args.paciente}, tu próximo control de ortodoncia en ${args.clinica} quedó para el ${args.fechaTexto} a las ${args.horaTexto}. ${cambio}`;
}
