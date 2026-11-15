// ═══════════════════════════════════════════════════════════════════════
// ¿A dónde lleva el botón «WhatsApp» de un cliente en el panel? (ws6-t8)
//
// Regla ÚNICA, pura (la usa el layout en el servidor y los botones en el
// navegador, y la fija su prueba):
//
//   · La barbería tiene WhatsApp conectado Y el rol puede ver Mensajes
//     → /barber/mensajes?tel=<10 dígitos> (la conversación DENTRO del panel,
//       exista o no todavía).
//   · Si no → wa.me como siempre (nunca un botón muerto).
//
// Con un texto ya escrito (ticket de Caja, pedido de la tienda) Mensajes
// solo sirve si ese texto se puede mandar tal cual: el rol puede contestar
// y la ventana de 24 h está abierta. Fuera de ella WhatsApp solo deja
// escribir primero con una plantilla aprobada y el texto se perdería: ahí
// se queda wa.me, que sí lo lleva.
// ═══════════════════════════════════════════════════════════════════════

import { mxTenDigits } from "@/lib/phone-mx";

export const BARBER_MENSAJES_PATH = "/barber/mensajes";

/** Lo que el panel sabe de la sesión, resuelto en el servidor. */
export interface BarberWaChatAcceso {
  /** WhatsApp conectado + plan con bandeja + permiso whatsapp.view + al corriente. */
  inbox: boolean;
  /** Además puede contestar (whatsapp.send). */
  send: boolean;
}

export const BARBER_WA_CHAT_SIN_ACCESO: BarberWaChatAcceso = { inbox: false, send: false };

export function barberWaChatAcceso(i: {
  /** Suscripción al corriente (sin ella /barber/mensajes no abre). */
  paid: boolean;
  /** El plan trae la bandeja (feature whatsappInbox). */
  planInbox: boolean;
  canView: boolean;
  canSend: boolean;
  /**
   * La barbería tiene número y llave guardados (lo mismo que mira
   * getBarberWaConnection para decir «conectado»). Si la llave no se puede
   * leer, Mensajes lo dice («vuelve a conectar») sin tronar.
   */
  credenciales: boolean;
}): BarberWaChatAcceso {
  const inbox = i.paid && i.planInbox && i.canView && i.credenciales;
  return { inbox, send: inbox && i.canSend };
}

/** wa.me con lada 52 (o el número tal cual si ya la trae); sin número, WhatsApp pregunta a quién. */
export function barberWaMeHref(phone: string | null | undefined, texto?: string | null): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const diez = mxTenDigits(digits);
  const to = diez ? `52${diez}` : digits;
  const q = texto ? `?text=${encodeURIComponent(texto)}` : "";
  return `https://wa.me/${to}${q}`;
}

export function barberMensajesHref(phone10: string, texto?: string | null): string {
  const q = new URLSearchParams({ tel: phone10 });
  if (texto) q.set("texto", texto);
  return `${BARBER_MENSAJES_PATH}?${q.toString()}`;
}

export interface BarberWaChatDestino {
  href: string;
  /** true = página del panel (misma pestaña); false = wa.me (pestaña nueva). */
  interno: boolean;
}

export function barberWaChatDestino(i: {
  acceso: BarberWaChatAcceso;
  phone: string | null | undefined;
  /** Texto ya escrito que debe llegar al cliente. */
  texto?: string | null;
  /** ¿Ventana de 24 h abierta con ese teléfono? null = no se sabe (todavía). */
  ventanaAbierta?: boolean | null;
}): BarberWaChatDestino {
  const tel = mxTenDigits(i.phone);
  const fuera = { href: barberWaMeHref(i.phone, i.texto), interno: false };
  if (!tel || !i.acceso.inbox) return fuera;
  if (!i.texto) return { href: barberMensajesHref(tel), interno: true };
  if (i.acceso.send && i.ventanaAbierta === true) {
    return { href: barberMensajesHref(tel, i.texto), interno: true };
  }
  return fuera;
}

/** Texto que llega a Mensajes por la dirección (?texto=), acotado al límite del redactor. */
export function barberMensajesTextoInicial(raw: unknown, limite = 4000): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, limite);
}
