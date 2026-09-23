// ¿Lleva link de Mercado Pago el correo / el WhatsApp de una factura? (ws1-t1)
//
// Rafael: «si seleccionan enviar por correo o whatsapp entonces que se le envie
// por ahí el link con un mensaje y el monto».
//
// Lo llaman las dos rutas de envío (send-email y send-whatsapp). El link va SOLO
// si quien envía lo pide (`{ linkPago: true }`): el popup de Nueva factura con
// Mercado Pago elegido, el detalle o la ficha de una factura que se cobra por
// Mercado Pago. Sin pedirlo, el mensaje sale EXACTAMENTE como hoy — así lo que
// Sabina enseña en su tarjeta antes de confirmar (sin link) es lo que llega.
//
// Crear un link es pedirle un cobro al paciente: exige `billing.charge`, el mismo
// permiso que POST /api/invoices/[id]/link-pago. Sin él, sale sin link y se dice.
//
// Nunca lanza: si el link no sale, el mensaje sale sin él y `aviso` dice por
// qué (la ruta lo devuelve y la pantalla lo enseña). Mandar el aviso de saldo
// no puede depender de que Mercado Pago conteste.

import {
  cobroMpDisponible,
  obtenerLinkDeFactura,
  TEXTO_ERROR_LINK,
  type DepsFacturaMp,
  type LinkDeFactura,
} from "./servicio.server";

export interface LinkParaEnviar {
  link: LinkDeFactura | null;
  /** Por qué no va el link cuando se pidió. null = nada que decir. */
  aviso: string | null;
}

export const SIN_PERMISO_LINK = "Tu usuario no tiene permiso para cobrar, así que no puede generar el link de Mercado Pago.";

export async function linkParaEnviar(args: {
  clinicId: string;
  invoiceId: string;
  userId: string | null;
  /** Quien envía pidió el link (`{ linkPago: true }` en el cuerpo). */
  pedido: boolean;
  /** Ya comprobado por la ruta: el usuario tiene `billing.charge`. */
  puedeCobrar: boolean;
}, over?: Partial<DepsFacturaMp>): Promise<LinkParaEnviar> {
  const { clinicId, invoiceId } = args;
  if (!args.pedido) return { link: null, aviso: null };
  if (!args.puedeCobrar) return { link: null, aviso: SIN_PERMISO_LINK };
  try {
    if (!(await cobroMpDisponible(clinicId, over))) return { link: null, aviso: TEXTO_ERROR_LINK.sin_mp };
    const r = await obtenerLinkDeFactura({ clinicId, invoiceId, userId: args.userId }, over);
    if (r.ok && r.link) return { link: r.link, aviso: null };
    // Una factura ya pagada que se manda por correo como comprobante no «pierde»
    // nada por no llevar link.
    if (r.error === "estado" || r.error === "sin_saldo") return { link: null, aviso: null };
    return { link: null, aviso: TEXTO_ERROR_LINK[r.error ?? "mp_fallo"] };
  } catch (e) {
    console.error(`[factura-mp] no se pudo preparar el link para el envío (${invoiceId}): ${(e as Error).message}`);
    return { link: null, aviso: TEXTO_ERROR_LINK.mp_fallo };
  }
}
