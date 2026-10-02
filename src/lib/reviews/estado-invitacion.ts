// Estado de una invitación de reseña según la entrega REAL (ws1-t4, 11.4).
//
// Antes `invitedChannels = ["whatsapp"]` se escribía en cuanto la API de Meta
// ACEPTABA el envío; el rechazo (131026, «el número no existe en WhatsApp») llega
// después por el webhook y nadie lo cruzaba: la reseña figuraba «invitada por
// WhatsApp» aunque jamás se entregó.
//
// PURO: sin Prisma ni React. Lo alimenta `getInvitacionesRecientes` (service.ts)
// con el `deliveryStatus` del mensaje del Inbox y lo pinta Reseñas.

import { describeReminderErrorCode } from "@/lib/whatsapp/reminder-error";
import type { EstadoInvitacion } from "./types";

export interface EntregaWhatsApp {
  /** SENT | DELIVERED | READ | FAILED | null (Meta aún no reporta). */
  deliveryStatus: string | null;
  errorCode: number | null;
}

export interface ResultadoInvitacion {
  estado: EstadoInvitacion;
  /** Clave del motivo (ReminderErrorKey) o "generic"; null si no falló. */
  motivo: string | null;
  porCorreo: boolean;
}

export function estadoDeInvitacion(args: {
  canales: readonly string[] | null | undefined;
  entrega: EntregaWhatsApp | null;
}): ResultadoInvitacion {
  const canales = args.canales ?? [];
  const wa = canales.includes("whatsapp");
  const porCorreo = canales.includes("email");
  if (!wa && !porCorreo) return { estado: "sin_enviar", motivo: null, porCorreo: false };
  if (!wa) return { estado: "enviada", motivo: null, porCorreo };

  const st = (args.entrega?.deliveryStatus ?? "").toUpperCase();
  if (st === "FAILED") {
    return {
      estado: "fallo",
      motivo: describeReminderErrorCode(args.entrega?.errorCode) ?? "generic",
      porCorreo,
    };
  }
  if (st === "READ") return { estado: "vista", motivo: null, porCorreo };
  if (st === "DELIVERED") return { estado: "entregada", motivo: null, porCorreo };
  return { estado: "enviada", motivo: null, porCorreo };
}
