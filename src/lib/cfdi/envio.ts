// Mandarle el CFDI al paciente (ws1-t8, auditoría CFDI F-17).
//
// Antes solo había descarga: recepción bajaba el PDF y el XML y los mandaba a mano. Ahora:
//   · por CORREO: Facturapi lo manda (PDF + XML adjuntos) con POST /invoices/{id}/email;
//   · por WHATSAPP: un mensaje con el PDF adjunto y un enlace de descarga firmado y con
//     caducidad para el PDF y el XML. Solo con la ventana de 24 h abierta: fuera de ella
//     WhatsApp exige una plantilla aprobada y la del CFDI todavía no existe en el catálogo
//     (su definición propuesta va en el reporte de ws1-t8). No se disfraza con otra plantilla:
//     dc_factura_lista dice «Puedes pagarla…», que para un CFDI ya pagado sería falso.
//
// PURO: sin Prisma ni red. Textos es/en aquí mismo.

export type Idioma = "es" | "en";

function en(locale?: string | null): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en");
}

/** Cuántos correos se aceptan en un envío (el del paciente y, si acaso, su contador). */
export const MAX_CORREOS = 3;

/** Días que vale el enlace de descarga que va por WhatsApp. */
export const DIAS_VIGENCIA_ENLACE = 7;

const CORREO = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

// Los dos campos en las dos formas: con "strict": false, TypeScript no estrecha por `ok`.
export type CorreosNormalizados =
  | { ok: true; correos: string[]; error?: undefined }
  | { ok: false; error: string; correos?: undefined };

/** Acepta un texto con uno o varios correos (coma, punto y coma o espacio) o una lista. */
export function normalizarCorreos(entrada: unknown, locale?: string | null): CorreosNormalizados {
  const crudos = Array.isArray(entrada)
    ? entrada.flatMap((e) => (typeof e === "string" ? e.split(/[,;\s]+/) : []))
    : typeof entrada === "string" ? entrada.split(/[,;\s]+/) : [];
  const vistos = new Set<string>();
  const correos: string[] = [];
  for (const c of crudos) {
    const t = c.trim().toLowerCase();
    if (!t || vistos.has(t)) continue;
    if (!CORREO.test(t) || t.length > 254) {
      return { ok: false, error: en(locale) ? `«${c.trim()}» is not a valid email address.` : `«${c.trim()}» no es un correo válido.` };
    }
    vistos.add(t);
    correos.push(t);
  }
  if (correos.length === 0) {
    return { ok: false, error: en(locale) ? "Write the email address to send the invoice to." : "Escribe el correo al que se manda la factura." };
  }
  if (correos.length > MAX_CORREOS) {
    return { ok: false, error: en(locale) ? `At most ${MAX_CORREOS} email addresses per send.` : `Máximo ${MAX_CORREOS} correos por envío.` };
  }
  return { ok: true, correos };
}

/** «maria.lopez@gmail.com» → «m***@gmail.com». Para la bitácora: sin el correo completo. */
export function enmascararCorreo(correo: string): string {
  const [usuario, dominio] = correo.split("@");
  if (!dominio) return "***";
  return `${(usuario ?? "").slice(0, 1)}***@${dominio}`;
}

/** «+52 55 1234 5678» → «•••• 5678». */
export function enmascararTelefono(tel: string | null | undefined): string {
  const d = String(tel ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : "••••";
}

function pesos(n: number, locale?: string | null): string {
  return `$${n.toLocaleString(en(locale) ? "en-US" : "es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

export interface DatosMensajeCfdi {
  nombre: string;
  clinica: string;
  folio: string | null;
  total: number;
  uuid: string;
  linkPdf: string;
  linkXml: string;
  locale?: string | null;
}

/** El texto del WhatsApp (ventana abierta). El PDF va además adjunto en el mismo mensaje. */
export function mensajeWhatsAppCfdi(d: DatosMensajeCfdi): string {
  const nombre = d.nombre.trim().split(/\s+/)[0] || (en(d.locale) ? "there" : "");
  const folio = d.folio ? (en(d.locale) ? ` (receipt ${d.folio})` : ` (nota ${d.folio})`) : "";
  if (en(d.locale)) {
    return [
      `Hi ${nombre}, ${d.clinica} sends you your tax invoice (CFDI) for ${pesos(d.total, d.locale)}${folio}.`,
      `Fiscal folio (UUID): ${d.uuid}`,
      `PDF: ${d.linkPdf}`,
      `XML: ${d.linkXml}`,
      `The links work for ${DIAS_VIGENCIA_ENLACE} days. If you have questions, reply to this message.`,
    ].join("\n");
  }
  return [
    `Hola ${nombre}, ${d.clinica} te comparte tu factura (CFDI) por ${pesos(d.total, d.locale)}${folio}.`,
    `Folio fiscal (UUID): ${d.uuid}`,
    `PDF: ${d.linkPdf}`,
    `XML: ${d.linkXml}`,
    `Los enlaces sirven ${DIAS_VIGENCIA_ENLACE} días. Si tienes dudas, responde este mensaje.`,
  ].join("\n");
}

export const MOTIVO_FUERA_DE_VENTANA_ES =
  "El paciente no ha escrito en las últimas 24 h y WhatsApp solo deja mandarle una plantilla aprobada por Meta; la de la factura (CFDI) todavía no existe. Mándala por correo.";
export const MOTIVO_FUERA_DE_VENTANA_EN =
  "The patient hasn't written in the last 24 h and WhatsApp only allows a Meta-approved template; there is no template for the tax invoice (CFDI) yet. Send it by email.";

export function motivoFueraDeVentana(locale?: string | null): string {
  return en(locale) ? MOTIVO_FUERA_DE_VENTANA_EN : MOTIVO_FUERA_DE_VENTANA_ES;
}

/** Un CFDI cancelado (o en cancelación) no se le manda al paciente como si siguiera vigente. */
export function cfdiSePuedeEnviar(status: string | null | undefined): boolean {
  return status === "valid";
}

/** Texto de la bitácora del envío. */
export function textoBitacoraEnvio(canal: "correo" | "whatsapp", destino: string): string {
  return canal === "correo"
    ? `Envió el CFDI al paciente por correo (${destino})`
    : `Envió el CFDI al paciente por WhatsApp (${destino})`;
}
