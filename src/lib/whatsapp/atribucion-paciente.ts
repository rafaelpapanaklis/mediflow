// Teléfonos compartidos en el Inbox (ws1-t4, ticket 3 de BEVADENT, 11.3).
//
// Hay UN solo hilo de WhatsApp por teléfono (`@@unique [clinicId, channel,
// externalId]`), pero dos pacientes pueden compartirlo (hermanos con el celular
// de la mamá, un paciente de prueba con el número de otro). Un aviso automático
// de B que cae en el hilo ligado a A parecía una conversación con A.
//
// El hilo no se puede partir sin tocar el esquema, así que el aviso se atribuye
// DENTRO del mensaje: la copia que guarda el Inbox empieza con «Para <nombre>:».
// Es solo la copia del equipo; lo que recibe el paciente no cambia.
//
// PURO: sin Prisma ni React.

export interface EntradaEtiqueta {
  /** Paciente que el caller declaró (el aviso trata de él). Null = no se sabe. */
  patientId: string | null | undefined;
  /** Paciente al que está ligado el hilo ANTES de este mensaje. */
  hiloPatientId: string | null | undefined;
  /** Cuántos pacientes de la clínica tienen ese teléfono. */
  pacientesConElTelefono: number;
}

/**
 * ¿Hay que decir en el mensaje de quién es? Sí cuando el caller sabe el
 * paciente Y el hilo puede ser de otro: el teléfono lo comparten varios o el
 * hilo ya está ligado a alguien distinto. Con un único dueño y el hilo suyo (o
 * huérfano) no hace falta: sería ruido en cada recordatorio.
 */
export function debeEtiquetarPaciente(e: EntradaEtiqueta): boolean {
  if (!e.patientId) return false;
  if (e.pacientesConElTelefono > 1) return true;
  return !!e.hiloPatientId && e.hiloPatientId !== e.patientId;
}

/** Antepone «Para <nombre>:» a la copia que se guarda en el Inbox. */
export function conEtiquetaDePaciente(cuerpo: string, nombre: string): string {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  return limpio ? `Para ${limpio}: ${cuerpo}` : cuerpo;
}
