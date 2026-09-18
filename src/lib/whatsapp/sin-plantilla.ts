// Cumpleaños, reactivación (recall) y seguimientos fuera de la ventana de 24 h:
// que el bloqueo DIGA LA VERDAD. Hallazgo H-7 de la auditoría WhatsApp/SAT.
//
// Estos recordatorios no cuelgan de una cita, así que el worker no puede armar
// los datos de la plantilla de recordatorio ({{3}} fecha, {{4}} hora…): todas
// las plantillas del catálogo hablan de una cita. Fuera de la ventana de 24 h
// `decideSendMode` los bloquea — que es lo correcto, Meta no los entregaría —,
// pero el motivo que quedaba guardado era el de OTRO problema:
//   · «…la plantilla espera 5 datos y se prepararon 0…» (clínica con plantilla), o
//   · «…falta configurar la plantilla… en Configuración → WhatsApp → Plantillas»,
//     que manda a la clínica a configurar algo que no existe.
// Aquí se cambia por el motivo real. NO cambia qué se envía ni cuándo: solo el
// texto que se guarda en `WhatsAppReminder.errorMsg`.
//
// PURO: sin Prisma ni React.

/** Todos los motivos de `decideSendMode` empiezan así; es lo que se reconoce. */
const PREFIJO_VENTANA = /^fuera de la ventana de 24 h/i;

/**
 * El texto lo reconoce `describeReminderError` como "noTemplateForKind";
 * cambiarlo sin tocar ese patrón dejaría el motivo sin traducir en el panel.
 */
export const MOTIVO_SIN_PLANTILLA_PARA_TIPO =
  "Fuera de la ventana de 24 h: este tipo de mensaje (cumpleaños, reactivación o seguimiento) " +
  "todavía no tiene plantilla aprobada por Meta, así que solo se entrega a pacientes que " +
  "escribieron a la clínica en las últimas 24 h. No se envió.";

/**
 * Motivo que se guarda cuando `sendWhatsAppLogged` bloqueó un recordatorio.
 *
 * Con cita, el motivo de `decideSendMode` ya es el correcto y pasa tal cual.
 * Sin cita no había datos de plantilla que mandar, así que cualquier bloqueo
 * por ventana es en realidad «para este tipo no hay plantilla».
 */
export function motivoDeBloqueo(args: { reason: string; cuelgaDeCita: boolean }): string {
  if (args.cuelgaDeCita) return args.reason;
  return PREFIJO_VENTANA.test(args.reason) ? MOTIVO_SIN_PLANTILLA_PARA_TIPO : args.reason;
}

/**
 * Fragmentos de `errorMsg` que identifican este caso, para CONTARLO en la
 * pantalla de WhatsApp: el texto nuevo y el que dejaban las filas anteriores a
 * este arreglo (cero datos preparados = no había cita de la que sacarlos).
 */
export const FRAGMENTOS_SIN_PLANTILLA: readonly string[] = [
  "todavía no tiene plantilla aprobada por Meta",
  "se prepararon 0",
];
