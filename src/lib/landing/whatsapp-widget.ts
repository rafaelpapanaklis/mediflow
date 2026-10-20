/**
 * Botón de WhatsApp de la portada y el blog (reemplaza al chat de LiveChat).
 * Lógica PURA —validación del número, mensaje y aviso al equipo—, aparte del
 * componente y de la ruta para probarla sin navegador ni base.
 */

/** Origen con el que el equipo reconoce estos avisos. */
export const ORIGEN_WIDGET_WHATSAPP = "whatsapp-widget";

/** Texto precargado de «Iniciar conversación» (pedido de Rafael). */
export const MENSAJE_INICIAR_CONVERSACION = "Hola, me interesa DaleControl!";

export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 80;

export type ResultadoNumero =
  | { ok: true; e164: string; legible: string }
  | { ok: false; error: string };

const ERROR_NUMERO =
  "Escribe tu número de WhatsApp a 10 dígitos (por ejemplo 999 123 4567) o con lada de tu país (+57 300 123 4567).";

/**
 * Número de WhatsApp → E.164 sin «+».
 *  · 10 dígitos → México (52 + 10).
 *  · 52 + 10 dígitos, o 521 + 10 (formato móvil viejo) → 52 + 10.
 *  · Con «+» (o 00) y otro país: de 8 a 15 dígitos, sin cero inicial.
 */
export function normalizarNumeroWhatsapp(crudo: string): ResultadoNumero {
  const texto = String(crudo ?? "").trim();
  if (!texto) return { ok: false, error: "Escribe tu número de WhatsApp." };
  if (/[^\d\s()+\-.]/.test(texto)) {
    return { ok: false, error: "El número solo puede llevar dígitos, espacios, guiones y el signo +." };
  }
  const conMas = texto.startsWith("+") || texto.replace(/\D/g, "").startsWith("00");
  let d = texto.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);

  if (!conMas && d.length === 10) d = `52${d}`;
  else if (d.length === 13 && d.startsWith("521")) d = `52${d.slice(3)}`;
  else if (!conMas && d.length === 12 && d.startsWith("52")) {
    /* ya es México */
  } else if (!conMas) {
    return { ok: false, error: ERROR_NUMERO };
  }

  if (d.length < 8 || d.length > 15 || d.startsWith("0")) return { ok: false, error: ERROR_NUMERO };
  if (d.startsWith("52")) {
    const local = d.slice(2);
    // México: 10 dígitos, y la lada no empieza en 0 ni en 1.
    if (local.length !== 10 || /^[01]/.test(local)) return { ok: false, error: ERROR_NUMERO };
    return { ok: true, e164: d, legible: `+52 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` };
  }
  return { ok: true, e164: d, legible: `+${d}` };
}

export type ResultadoNombre = { ok: true; nombre: string } | { ok: false; error: string };

export function normalizarNombre(crudo: string): ResultadoNombre {
  // Sin saltos de línea ni caracteres de control: el nombre viaja en un asunto de correo.
  const nombre = String(crudo ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (nombre.length < NOMBRE_MIN) return { ok: false, error: "Escribe tu nombre." };
  if (nombre.length > NOMBRE_MAX) return { ok: false, error: `El nombre no puede pasar de ${NOMBRE_MAX} caracteres.` };
  if (/https?:|www\.|@|<|>/i.test(nombre)) return { ok: false, error: "Escribe solo tu nombre, sin enlaces ni correos." };
  return { ok: true, nombre };
}

/** wa.me del número de DaleControl con el mensaje de «Iniciar conversación». */
export function enlaceIniciarConversacion(numeroE164: string): string {
  return `https://wa.me/${numeroE164}?text=${encodeURIComponent(MENSAJE_INICIAR_CONVERSACION)}`;
}

/** Aviso al equipo (mismo buzón que los demás avisos de plataforma: ADMIN_NOTIFY_EMAIL). */
export function avisoLeadWhatsapp(l: { nombre: string; e164: string; legible: string; pagina?: string }) {
  return {
    asunto: `Nuevo contacto por WhatsApp (portada): ${l.nombre}`,
    lineas: [
      "Alguien pidió que le escribamos por WhatsApp desde el botón de la portada.",
      `Nombre: ${l.nombre}`,
      `WhatsApp: ${l.legible}`,
      `Escribirle ahora: https://wa.me/${l.e164}`,
      `Origen: ${ORIGEN_WIDGET_WHATSAPP}${l.pagina ? ` · página: ${l.pagina}` : ""}`,
    ],
  };
}
