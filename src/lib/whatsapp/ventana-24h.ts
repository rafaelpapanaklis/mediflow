// Avisos de «fuera de la ventana de 24 h no sale» que DICEN LA VERDAD —
// ws1-t4 (auditoría BEVADENT, F5 y F4/M7).
//
// F5: la pantalla de WhatsApp decía SIEMPRE «Los recordatorios solo salen dentro
// de la ventana de 24 h… la plantilla todavía no está disponible en DaleControl».
// Falso desde que DaleControl crea las plantillas en la cuenta de la clínica: con
// dc_recordatorio_cita aprobada, el recordatorio sí sale a cualquiera. Ahora la
// nota solo aparece si esa plantilla NO está aprobada, y dice por qué (falta, en
// revisión o rechazada).
//
// PURO: sin Prisma ni React.

import type { WaTemplateUiState } from "./templates-catalog";
import { PLANTILLAS_MARKETING_AUTOMATICAS_ENCENDIDAS } from "./templates-catalog";

/**
 * Clave i18n del cuerpo de la nota según el estado de la plantilla de
 * recordatorio, o null si está aprobada (no hay nada que advertir).
 */
export function cuerpoNotaVentana24(estado: WaTemplateUiState): string | null {
  if (estado === "approved") return null;
  if (estado === "pending") return "inbox.whatsapp.window24BodyPending";
  if (estado === "rejected") return "inbox.whatsapp.window24BodyRejected";
  return "inbox.whatsapp.window24BodyMissing";
}

/**
 * Aviso de Configuración → Reactivación cuando el canal incluye WhatsApp: el
 * recall no tiene plantilla (la de MARKETING está apagada por bandera), así que
 * por WhatsApp solo le llega a quien escribió en las últimas 24 h. null si el
 * canal no usa WhatsApp o si la bandera ya se encendió (entonces depende de que
 * la clínica active la plantilla, y este texto quedaría viejo: revisarlo).
 */
export function avisoRecallSinPlantilla(canal: "whatsapp" | "email" | "both"): string | null {
  if (canal === "email") return null;
  if (PLANTILLAS_MARKETING_AUTOMATICAS_ENCENDIDAS) return null;
  const correo =
    canal === "both"
      ? " Por correo sí le llega a todos los que tengan email."
      : " Si quieres llegar a todos, elige «WhatsApp y email».";
  return (
    "Por WhatsApp, la reactivación solo le llega a pacientes que le escribieron a la clínica " +
    "en las últimas 24 horas. Es una regla de Meta: fuera de esa ventana hace falta una " +
    "plantilla aprobada, y la de reactivación todavía no está disponible. A los demás no se " +
    "les envía (lo verás como «No llegó» en WhatsApp → Últimos recordatorios)." +
    correo
  );
}
