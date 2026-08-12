// Texto libre o plantilla: la decisión que hoy NO se toma (M-09, el P0).
//
// Regla de Meta: dentro de las 24 h siguientes al último mensaje DEL PACIENTE
// se puede responder con texto libre (y es gratis). Fuera de esa ventana solo
// entra una plantilla aprobada, que Meta le cobra a la clínica.
//
// Hoy el código manda SIEMPRE texto libre, así que fuera de ventana Meta
// responde 131047 y el mensaje no llega — pero el panel lo pinta como
// "Enviado". Esta función es el punto único donde se decide, y por eso es pura:
// se prueba entera sin BD ni red.
//
// PURO: sin Prisma ni React.

import type { WhatsAppSendKind } from "./system-message";
import type { WaTemplateConfig, WaTemplateMap } from "./template-config";
import { specForKind } from "./template-config";

export type SendModeDecision =
  /** Ventana abierta: texto libre, como hasta ahora (y sin coste). */
  | { mode: "text" }
  /** Ventana cerrada y hay plantilla registrada: se manda esa. */
  | { mode: "template"; template: WaTemplateConfig; params: string[] }
  /** No se puede enviar. `reason` va tal cual a WhatsAppReminder.errorMsg. */
  | { mode: "blocked"; reason: string };

export interface SendModeInput {
  kind: WhatsAppSendKind;
  /** ¿El paciente escribió en las últimas 24 h? (lib/inbox/send-core). */
  windowOpen: boolean;
  /** Plantillas registradas por la clínica, ya validadas. */
  templates: WaTemplateMap;
  /** Valores de {{1}}…{{n}}, en el orden de la especificación del tipo. */
  params?: string[] | null;
}

/**
 * Decide cómo sale un envío automático.
 *
 * Nunca devuelve "text" con la ventana cerrada: ese es exactamente el fallo que
 * arregla esta tarea. Cuando no se puede enviar, devuelve un motivo en español
 * pensado para leerse en el panel, no un código.
 */
export function decideSendMode(input: SendModeInput): SendModeDecision {
  // 1. Ventana abierta → texto libre. Es lo más barato y lo más natural: el
  //    paciente está en plena conversación.
  if (input.windowOpen) return { mode: "text" };

  // 2. Ventana cerrada: hace falta plantilla.
  const spec = specForKind(input.kind);
  if (!spec) {
    // Tipos que todavía no tienen plantilla definida (avisos a la propia
    // clínica, recetas…). Antes salían como texto libre y morían en silencio.
    return {
      mode: "blocked",
      reason:
        "Fuera de la ventana de 24 h: este tipo de mensaje todavía no admite plantilla, " +
        "así que WhatsApp no lo entregaría.",
    };
  }

  const template = input.templates[input.kind];
  if (!template) {
    // El texto lo reconoce describeReminderError como "templateNotConfigured";
    // cambiarlo sin tocar ese patrón dejaría el motivo sin traducir en el panel.
    return {
      mode: "blocked",
      reason:
        "Fuera de la ventana de 24 h y falta configurar la plantilla de este tipo de mensaje " +
        "en Configuración → WhatsApp → Plantillas.",
    };
  }

  // 3. Los parámetros son posicionales: Meta rechaza con 132000 si el número no
  //    coincide con el de la plantilla aprobada. Mejor no gastar el intento.
  const params = input.params ?? [];
  if (params.length !== spec.variableKeys.length) {
    return {
      mode: "blocked",
      reason:
        `Fuera de la ventana de 24 h: la plantilla espera ${spec.variableKeys.length} datos ` +
        `y se prepararon ${params.length}. No se envió para no gastar un intento rechazado.`,
    };
  }

  // Un parámetro vacío también lo rechaza Meta, y además dejaría el mensaje con
  // un hueco ("Hola , te recordamos…").
  const blankAt = params.findIndex((p) => !p || p.trim() === "");
  if (blankAt >= 0) {
    return {
      mode: "blocked",
      reason:
        `Fuera de la ventana de 24 h: falta el dato {{${blankAt + 1}}} de la plantilla ` +
        `(WhatsApp rechaza las variables vacías).`,
    };
  }

  return { mode: "template", template, params: params.map((p) => p.trim()) };
}
