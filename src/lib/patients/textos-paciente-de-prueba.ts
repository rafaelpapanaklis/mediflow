// ws1-t11 (11c/11d, tercer ticket de BEVADENT) — textos de «Paciente de prueba /
// no contactar» y del interruptor «Pedir reseña al terminar la cita».
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que
// textos-salud-capturada.ts): los diccionarios los tocan a la vez otras
// pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  /** Etiqueta de la ficha (cabecera). */
  etiqueta: "Paciente de prueba · no contactar",
  /** Etiqueta corta de las listas (Pacientes). */
  etiquetaCorta: "Prueba",
  /** Lo que significa, en una línea (title de la etiqueta). */
  significado:
    "No recibe ningún mensaje (WhatsApp ni correo, automático ni manual), no genera cargos automáticos y no cuenta en reportes ni tableros.",
  menuMarcar: "Marcar como paciente de prueba",
  menuQuitar: "Quitar marca de prueba",
  menuInactivo: "Paciente de prueba (todavía no está activo)",
  tituloMarcar: "¿Marcar como paciente de prueba?",
  tituloQuitar: "¿Quitar la marca de prueba?",
  cuerpoMarcar: [
    "No le llegará ningún mensaje: ni recordatorios, recall, cumpleaños, cobranza, reseñas, encuestas ni respuestas del bot; tampoco los que alguien del equipo mande a mano por WhatsApp o correo.",
    "Firmar su control o guardar una consulta no le crea facturas automáticas. Cobrarle a mano sigue funcionando.",
    "Sus citas, facturas y pagos dejan de contar en Reportes y en los tableros de inicio.",
  ],
  cuerpoQuitar: [
    "Vuelve a recibir los mensajes de la clínica y a contar en reportes y tableros.",
    "Lo que no se le mandó mientras estuvo marcado no se envía después.",
  ],
  quedaEnMovimientos: "El cambio queda en Movimientos con tu nombre.",
  botonMarcar: "Marcar como prueba",
  botonQuitar: "Quitar marca",
  cancelar: "Cancelar",
  guardando: "Guardando…",
  okMarcado: "Marcado como paciente de prueba: no se le enviará nada.",
  okQuitado: "Se quitó la marca de prueba.",
  errorGuardar: "No se pudo guardar la marca. Inténtalo de nuevo.",
  inactivo: "Esta función todavía no está activa en tu clínica.",
  /** Bandeja: la respuesta se guardó pero no salió. */
  inboxNoSalio: "Se guardó en la conversación, pero no se envió: es un paciente de prueba / no contactar.",
  // ── 11c · Reseñas ────────────────────────────────────────────────────────
  resenaTitulo: "Pedir reseña al terminar la cita",
  resenaDescripcion:
    "Al terminar una cita, le manda al paciente el enlace para calificar su visita (WhatsApp y correo). Si también tienes encendido el seguimiento post-cita, recibe dos mensajes por la misma visita.",
  resenaError: "No se pudo guardar. Inténtalo de nuevo.",
};

const en: typeof es = {
  etiqueta: "Test patient · do not contact",
  etiquetaCorta: "Test",
  significado:
    "Receives no messages (WhatsApp or email, automatic or manual), creates no automatic charges and is left out of reports and dashboards.",
  menuMarcar: "Mark as test patient",
  menuQuitar: "Remove test mark",
  menuInactivo: "Test patient (not active yet)",
  tituloMarcar: "Mark as a test patient?",
  tituloQuitar: "Remove the test mark?",
  cuerpoMarcar: [
    "No message will reach them: no reminders, recall, birthday, collections, reviews, surveys or bot replies, and nothing a team member sends by hand over WhatsApp or email.",
    "Signing their check-up or saving a visit won't create automatic invoices. Charging them by hand still works.",
    "Their appointments, invoices and payments stop counting in Reports and on the home dashboards.",
  ],
  cuerpoQuitar: [
    "They will receive the clinic's messages again and count in reports and dashboards.",
    "Whatever wasn't sent while they were marked is not sent afterwards.",
  ],
  quedaEnMovimientos: "The change is recorded in Activity under your name.",
  botonMarcar: "Mark as test",
  botonQuitar: "Remove mark",
  cancelar: "Cancel",
  guardando: "Saving…",
  okMarcado: "Marked as a test patient: nothing will be sent to them.",
  okQuitado: "Test mark removed.",
  errorGuardar: "Couldn't save the mark. Please try again.",
  inactivo: "This feature isn't active in your clinic yet.",
  inboxNoSalio: "Saved in the conversation but not sent: this is a test / do-not-contact patient.",
  resenaTitulo: "Ask for a review when the appointment ends",
  resenaDescripcion:
    "When an appointment ends, sends the patient a link to rate their visit (WhatsApp and email). If the post-visit follow-up is also on, they get two messages for the same visit.",
  resenaError: "Couldn't save. Please try again.",
};

export type TextosPacienteDePrueba = typeof es;

export function textosPacienteDePrueba(locale: string | null | undefined): TextosPacienteDePrueba {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosPacienteDePrueba(): TextosPacienteDePrueba {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosPacienteDePrueba(locale);
}
