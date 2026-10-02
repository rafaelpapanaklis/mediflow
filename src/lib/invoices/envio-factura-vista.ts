// ws1-t6 (punto 8 del tercer ticket) — ANTES de guardar una factura nueva con «Enviar por
// WhatsApp», el popup enseña qué va a recibir el paciente y por qué canal. Antes no lo
// decía y, con la ventana de 24 h cerrada, salía la plantilla de saldo («Tienes un saldo
// pendiente de…») en vez de la nota.
//
// Aquí se decide el CANAL con las mismas piezas que el envío (`decideSendMode` sobre
// `invoice_ready`, la ventana medida con `lastInboundAtForPhone` y el tope de un aviso de
// cobro al día). El TEXTO lo arma el popup con `buildMensajeFactura`, el mismo que usa la
// ruta: el folio aún no existe y el link de Mercado Pago se crea al guardar.
//
// Las dependencias entran por parámetro para probarlo sin base.

import { decideSendMode } from "@/lib/whatsapp/send-mode";
import { parseWaTemplates } from "@/lib/whatsapp/template-config";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { fraseAvisoYaEnviado } from "@/lib/whatsapp/aviso-cobro-tope";

/** Lo que el popup necesita para pintar el aviso «Lo que recibirá el paciente». */
export interface VistaEnvioWhatsApp {
  /** text = mensaje normal con el PDF; template = plantilla dc_factura_lista (sin PDF); blocked = no sale. */
  modo: "text" | "template" | "blocked";
  /** Por qué no sale (solo con `blocked`), en español. */
  motivo: string | null;
  clinica: string;
  telefonoClinica: string;
  paciente: { firstName: string; lastName: string };
}

export interface DatosVistaEnvio {
  clinica: {
    name: string | null;
    phone: string | null;
    timezone: string | null;
    waConnected: boolean | null;
    waPhoneNumberId: string | null;
    /** Solo si existe; el token no se lee. */
    conToken: boolean;
    waTemplates: unknown;
  };
  paciente: { firstName: string | null; lastName: string | null; phone: string | null };
  /** Último mensaje del paciente (ventana de 24 h). */
  ultimoEntrante: Date | null;
  /** Último aviso de cobro a ese teléfono en 24 h (tope). */
  ultimoCobro: Date | null;
  ahora: Date;
}

export const MOTIVO_SIN_PLANTILLA_FACTURA =
  "El paciente no ha escrito en las últimas 24 h y WhatsApp solo deja mandarle una plantilla aprobada por Meta. " +
  "La de la nota todavía no se puede usar";

/** PURO: el canal por el que saldría la nota, o por qué no sale. */
export function vistaEnvioFactura(d: DatosVistaEnvio): VistaEnvioWhatsApp {
  const base = {
    clinica: (d.clinica.name ?? "").trim(),
    telefonoClinica: (d.clinica.phone ?? "").trim(),
    paciente: { firstName: d.paciente.firstName ?? "", lastName: d.paciente.lastName ?? "" },
  };
  const no = (motivo: string): VistaEnvioWhatsApp => ({ ...base, modo: "blocked", motivo });
  if (!d.clinica.waConnected || !d.clinica.waPhoneNumberId || !d.clinica.conToken) {
    return no("WhatsApp no está conectado en esta clínica (Configuración → WhatsApp).");
  }
  if (!base.telefonoClinica) return no("Falta el teléfono de la clínica (Configuración → Clínica): el mensaje lo necesita para decir dónde pagar.");
  if (!(d.paciente.phone ?? "").trim()) return no("El paciente no tiene teléfono registrado.");
  if (d.ultimoCobro) return no(fraseAvisoYaEnviado(d.ultimoCobro, d.clinica.timezone));
  const decision = decideSendMode({
    kind: "invoice_ready",
    windowOpen: isWithin24hWindow(d.ultimoEntrante, d.ahora),
    templates: parseWaTemplates(d.clinica.waTemplates ?? null),
    // Solo cuenta cuántos son y que no vayan vacíos: el texto real lo arma la ruta.
    params: ["x", "x", "x", "x", "x"],
  });
  if (decision.mode === "blocked") {
    // «falta configurar» / «en revisión» / «rechazada»: lo que dice decideSendMode, tras el porqué.
    const detalle = decision.reason.replace(/^Fuera de la ventana de 24 h:?\s*/i, "");
    return no(`${MOTIVO_SIN_PLANTILLA_FACTURA} (${detalle.replace(/\.$/, "")}). Mándala por correo o compártele el link.`);
  }
  return { ...base, modo: decision.mode, motivo: null };
}
