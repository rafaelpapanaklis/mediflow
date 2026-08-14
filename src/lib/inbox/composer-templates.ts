// Plantillas aprobadas de WhatsApp DENTRO del composer del Inbox.
//
// EL FALLO QUE ARREGLA: con la ventana de 24 h cerrada, los chips de plantillas
// del Inbox estaban `disabled`. La lógica estaba justo al revés — fuera de esa
// ventana una plantilla aprobada es lo ÚNICO que Meta entrega, y era exactamente
// cuando el código las apagaba, dejando a la clínica sin ninguna forma de
// escribirle al paciente.
//
// Y encima no eran plantillas: los chips pegaban TEXTO LIBRE en el recuadro
// (`insertTemplate`), que fuera de ventana Meta rechaza con 131047. Ahora hay
// dos cosas distintas y se llaman distinto:
//
//   · ATAJOS DE TEXTO (los tres de siempre) — dentro de ventana, gratis, texto
//     libre. Se siguen pegando en el recuadro; no cambian.
//   · PLANTILLAS DE META — las del catálogo (lib/whatsapp/templates-catalog),
//     dadas de alta en la WABA de la clínica. Salen como `type: "template"` por
//     `sendWhatsAppTemplate`, se las cobra Meta a la clínica, y son las únicas
//     que llegan con la ventana cerrada.
//
// PURO: sin Prisma, sin red y sin React. Lo importan la ruta del servidor que
// arma las opciones y el cliente del Inbox que las pinta.

import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";
import type { WaTemplateConfig } from "@/lib/whatsapp/template-config";
// templateUiState y WaTemplateUiState viven en el CATÁLOGO, no en template-config
// (que solo re-exporta los validadores de nombre e idioma).
import {
  templateUiState,
  type WaCatalogEntry,
  type WaTemplateUiState,
} from "@/lib/whatsapp/templates-catalog";

/**
 * Qué plantillas del catálogo tiene sentido mandar A MANO desde el Inbox.
 *
 * El filtro no es caprichoso: solo entran las que se pueden RELLENAR con lo que
 * el Inbox sabe del paciente (su nombre, su clínica, su próxima cita, su saldo).
 * Las demás del catálogo cuelgan de un documento concreto —la receta de una
 * consulta, la liga de un presupuesto, la de un consentimiento— y se mandan
 * desde su propia pantalla, que es la que tiene ese dato. Ofrecerlas aquí sin
 * poder llenarlas sería otro chip muerto.
 *
 * El ORDEN es el de la lista: es el que se pinta.
 */
export const INBOX_COMPOSER_KINDS: readonly WhatsAppSendKind[] = [
  "manual_api",      // "te escribimos sobre tu cita del …" — el genérico
  "reminder",        // recordatorio de la próxima cita
  "booking",         // confirmación de la próxima cita
  "payment_notice",  // aviso de saldo pendiente
  "review",          // invitación a reseña (MARKETING, casi nunca dada de alta)
];

/** Una plantilla tal como la ve el composer. */
export interface InboxTemplateOption {
  kind: WhatsAppSendKind;
  /** Clave i18n del nombre humano (la traduce el cliente, como el resto). */
  labelKey: string;
  /** Cómo la tiene Meta hoy: aprobada / en revisión / rechazada / sin dar de alta. */
  state: WaTemplateUiState;
  /**
   * Motivo EN ESPAÑOL por el que hoy no se puede enviar, o null si sí se puede.
   * Nunca un código de Meta: esto se lee en el panel.
   */
  blockedReason: string | null;
  /**
   * El texto EXACTO que recibiría el paciente, con las variables ya sustituidas.
   * null cuando faltan datos para rellenarla (y entonces hay blockedReason).
   */
  preview: string | null;
}

/**
 * Por qué no se puede usar una plantilla por su ESTADO en Meta.
 *
 * Una entrada sin `status` cuenta como aprobada — son las que la clínica
 * registró a mano cuando la pantalla solo pedía el nombre, y si las escribió ahí
 * era porque ya se las habían aprobado (mismo criterio que `templateUiState` y
 * que `decideSendMode`, para que la interfaz y el envío nunca discrepen).
 */
export function describeTemplateState(
  state: WaTemplateUiState,
  cfg?: WaTemplateConfig | null,
): string | null {
  if (state === "approved") return null;
  if (state === "missing") {
    return "Esta clínica todavía no tiene esta plantilla dada de alta en Meta.";
  }
  if (state === "pending") {
    return "Meta todavía la está revisando. En cuanto la apruebe se podrá enviar.";
  }
  const motivo = cfg?.reason ? ` Motivo: ${cfg.reason}` : "";
  return `Meta rechazó esta plantilla, así que no la entregaría.${motivo}`;
}

/**
 * Arma la opción que ve el composer combinando las TRES cosas que la pueden
 * dejar fuera, en este orden de prioridad:
 *
 *   1. el estado en Meta (sin dar de alta / en revisión / rechazada);
 *   2. los datos del paciente (sin cita futura no hay fecha que anunciar);
 *   3. nada — se puede enviar.
 *
 * El estado va PRIMERO a propósito: si la plantilla ni existe, decir "el
 * paciente no tiene citas" mandaría a la clínica a arreglar lo que no está roto.
 */
export function buildInboxTemplateOption(args: {
  entry: WaCatalogEntry;
  cfg?: WaTemplateConfig | null;
  /** Valores de {{1}}…{{n}} EN ORDEN, o null si no se pudieron armar. */
  params: string[] | null;
  /** Por qué no se pudieron armar (solo se usa si `params` es null). */
  missingDataReason?: string | null;
}): InboxTemplateOption {
  const { entry, cfg, params } = args;
  const state = templateUiState(cfg);
  const stateReason = describeTemplateState(state, cfg);

  if (stateReason) {
    return { kind: entry.kind, labelKey: entry.labelKey, state, blockedReason: stateReason, preview: null };
  }
  if (!params || params.length !== entry.variableKeys.length || params.some((p) => !p || !p.trim())) {
    return {
      kind: entry.kind,
      labelKey: entry.labelKey,
      state,
      blockedReason:
        args.missingDataReason ??
        "Faltan datos del paciente para rellenar esta plantilla, así que WhatsApp la rechazaría.",
      preview: null,
    };
  }
  return {
    kind: entry.kind,
    labelKey: entry.labelKey,
    state,
    blockedReason: null,
    preview: renderPreview(entry.body, params),
  };
}

/**
 * Sustituye {{1}}…{{n}} POSICIONALMENTE, igual que hace Meta al entregar. Es la
 * misma regla que `renderTemplateBody` usa para dejar en el hilo lo que de
 * verdad recibió el paciente; se repite aquí para que el módulo siga puro y sin
 * el `fallback` que allí hace falta.
 */
function renderPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => params[Number(n) - 1] ?? match);
}

/**
 * Qué decirle a la clínica cuando NINGUNA plantilla se puede enviar. Devuelve
 * null si al menos una sirve (y entonces no hay nada que explicar).
 *
 * ORDEN DE LAS RAMAS — importa, y no es el obvio:
 *
 *   1. `waConnected` primero: sin conexión no hay nada que discutir.
 *   2. El ESTADO de las plantillas ANTES que `billingOk`. Parece al revés
 *      (el método de pago es más "de raíz"), pero `Clinic.waBillingOk` es
 *      `@default(false)` y solo pasa a true cuando un envío de plantilla SALE
 *      bien. O sea: toda clínica que aún no ha mandado ninguna —hoy, todas—
 *      lo tiene en false sin que eso signifique nada. Ponerlo antes hacía que
 *      la clínica sin plantillas leyera "revisa tu tarjeta en Meta" y se fuera
 *      a la pantalla equivocada… para volver a false, porque para levantar la
 *      bandera hay que enviar una plantilla, que es justo lo que le faltaba.
 *   3. `billingOk` al final: ahí sí es la explicación que queda cuando las
 *      plantillas están aprobadas y aun así no sale nada.
 */
export function describeNoTemplatesAvailable(args: {
  options: InboxTemplateOption[];
  waConnected: boolean;
  billingOk: boolean;
}): string | null {
  if (args.options.some((o) => o.blockedReason === null)) return null;
  if (!args.waConnected) {
    return "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp.";
  }
  if (args.options.length === 0 || args.options.every((o) => o.state === "missing")) {
    return (
      "Esta clínica todavía no tiene plantillas aprobadas por Meta. " +
      "Créalas en Configuración → WhatsApp → Plantillas: mientras tanto, fuera de la " +
      "ventana de 24 h WhatsApp no entrega ningún mensaje."
    );
  }
  if (args.options.every((o) => o.state === "pending" || o.state === "missing")) {
    return (
      "Meta todavía está revisando las plantillas de esta clínica. " +
      "Suele tardar unos minutos; en cuanto apruebe alguna aparecerá aquí."
    );
  }
  if (!args.billingOk) {
    return (
      "La cuenta de WhatsApp de la clínica no tiene método de pago válido en Meta: " +
      "las plantillas se cobran y sin tarjeta Meta las rechaza."
    );
  }
  // Aprobadas pero sin datos que meterles (paciente sin citas ni saldo).
  return (
    "Ninguna plantilla se puede rellenar con los datos de este paciente todavía " +
    "(hace falta una cita agendada o un saldo pendiente)."
  );
}
