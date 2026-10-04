// «Cancelar cita» con su aviso al paciente (ws1-t1, ronda de arreglos tras la auditoría de uso — C-86 y C-101).
//
// EL FALLO QUE CIERRA: desde la ficha, «Cancelar cita» era un `confirm()` del navegador («Quedara en estado
// CANCELLED…»), sin casilla «Avisar al paciente», y al terminar decía solo «Cita cancelada» aunque el servidor
// contestara `whatsapp: { enviado: false, motivo: "apagadoPorClinica" }`. Nadie se enteraba de que al paciente
// no le llegó nada. La Agenda tampoco lo decía: `apagadoPorClinica` era un motivo «callado».
//
// Las reglas viven aquí, sin React, para que las tres puertas de cancelar (panel de la Agenda, pestaña Citas de
// la ficha y la ventana «Editar cita» del expediente) pregunten y digan lo mismo:
//   · con WhatsApp conectado y «Al cancelar» encendido, la casilla sale MARCADA; desmarcada viaja
//     `notifyPatient: false` (PATCH /status lo respeta igual que el DELETE);
//   · con el aviso apagado o sin WhatsApp, en lugar de la casilla se dice «al paciente no le llega nada»;
//   · al terminar, un solo mensaje que dice qué pasó con la cita, con el dinero y con el aviso.

export type EstadoAvisoCancelar = "encendido" | "apagado" | "sinWhatsApp" | null;

/** Lee la respuesta de `GET /api/clinic/me`. `null` = no se sabe (servidor viejo o error): no se pinta nada. */
export function estadoDelAvisoCancelar(cuerpo: unknown): EstadoAvisoCancelar {
  const clinic = (cuerpo as { clinic?: Record<string, unknown> } | null)?.clinic;
  if (!clinic || typeof clinic !== "object") return null;
  if (typeof clinic.waNotifyOnCancel !== "boolean") return null;
  if (!clinic.waConnected) return "sinWhatsApp";
  return clinic.waNotifyOnCancel ? "encendido" : "apagado";
}

/** Solo `{ notifyPatient: false }` cuando la casilla se ofreció y la desmarcaron. */
export function campoDelAvisoCancelar(estado: EstadoAvisoCancelar, marcada: boolean): { notifyPatient?: false } {
  return estado === "encendido" && !marcada ? { notifyPatient: false } : {};
}

export const TEXTO_CASILLA_CANCELAR = "Avisar al paciente por WhatsApp que se canceló";

/** La línea que va donde iría la casilla cuando el aviso no puede salir. */
export function lineaSinAvisoAlCancelar(estado: EstadoAvisoCancelar): string | null {
  if (estado === "apagado") {
    return "El aviso de «cita cancelada» está apagado en WhatsApp y recordatorios: al paciente no le llega nada. Avísale por otro medio.";
  }
  if (estado === "sinWhatsApp") {
    return "La clínica no tiene WhatsApp conectado: al paciente no le llega nada. Avísale por otro medio.";
  }
  return null;
}

/** Por qué no salió un aviso, en palabras. Las claves son las de `AvisoCitaMotivo`. */
export const MOTIVO_AVISO_NO_SALIO: Record<string, string> = {
  outside24h:
    "el paciente no ha escrito en las últimas 24 h y no hay plantilla aprobada para este aviso",
  templateNotConfigured: "falta la plantilla de este aviso (WhatsApp → Plantillas)",
  templatePending: "Meta todavía no aprueba la plantilla de este aviso",
  templateRejected: "Meta rechazó la plantilla de este aviso",
  billingRequired: "la cuenta de WhatsApp de la clínica no tiene método de pago en Meta",
  tokenExpired: "la conexión de WhatsApp caducó: hay que reconectar",
  notConnected: "la clínica no tiene WhatsApp conectado",
  noPhone: "el paciente no tiene un teléfono válido",
  undeliverable: "ese número no puede recibir WhatsApp",
  rateLimited: "WhatsApp está limitando los envíos de la clínica",
};

export type Tono = "ok" | "info" | "error";

export interface ResumenCancelacion {
  tono: Tono;
  texto: string;
}

type ResultadoWhatsApp = { enviado: true } | { enviado: false; motivo: string } | null | undefined;
type DineroRespuesta = { decision: string | null; monto: number; motivo: string | null } | null | undefined;

function pesos(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

/**
 * El mensaje tras cancelar. `cuerpo` es la respuesta de PATCH /status (o del DELETE); `avisoCallado` = quien
 * canceló desmarcó «Avisar al paciente» (el servidor contesta `whatsapp: null`).
 */
export function resumenTrasCancelar(
  cuerpo: { whatsapp?: ResultadoWhatsApp; dineroCita?: DineroRespuesta } | null | undefined,
  avisoCallado: boolean,
  /** ws1-t1 (N-51): lo que el diálogo ya le dijo; el mensaje final da la MISMA razón. */
  estadoAviso?: EstadoAvisoCancelar,
): ResumenCancelacion {
  const partes: string[] = ["Cita cancelada."];
  let tono: Tono = "ok";

  const d = cuerpo?.dineroCita;
  if (d && d.monto > 0) {
    if (d.decision === "a_favor") partes.push(`${pesos(d.monto)} quedaron a favor del paciente.`);
    else if (d.decision === "reembolso") {
      partes.push(`${pesos(d.monto)} marcados para reembolso: devuélvelos fuera y regístralo con «Reembolsar».`);
      tono = "info";
    } else {
      partes.push(`${pesos(d.monto)} quedaron pendientes de decidir en la factura.${d.motivo ? ` ${d.motivo}` : ""}`);
      tono = "info";
    }
  }

  const w = cuerpo?.whatsapp;
  if (w && w.enviado === true) {
    partes.push("Se le avisó al paciente por WhatsApp.");
  } else if (w && w.enviado === false) {
    if (w.motivo === "apagadoPorClinica" && estadoAviso === "sinWhatsApp") {
      // El servidor mira primero el interruptor; si además no hay WhatsApp, la razón que se dio es esa.
      partes.push("No se le avisó al paciente: la clínica no tiene WhatsApp conectado. Avísale por otro medio.");
      if (tono === "ok") tono = "info";
    } else if (w.motivo === "apagadoPorClinica") {
      partes.push("No se le avisó al paciente: el aviso de cancelación está apagado. Avísale por otro medio.");
      if (tono === "ok") tono = "info";
    } else if (w.motivo === "citaPasada") {
      // Una cita que ya pasó no se le anuncia a nadie: no es noticia.
    } else {
      const porque = MOTIVO_AVISO_NO_SALIO[w.motivo] ?? "no sabemos el motivo (revisa WhatsApp → Recordatorios recientes)";
      partes.push(`El aviso por WhatsApp al paciente NO salió: ${porque}. Avísale por otro medio.`);
      tono = "error";
    }
  } else if (avisoCallado) {
    partes.push("No se le avisó al paciente (así lo elegiste).");
  }

  return { tono, texto: partes.join(" ") };
}
