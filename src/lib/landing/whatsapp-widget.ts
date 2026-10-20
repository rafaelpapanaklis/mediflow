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

/** Ladas de país (UIT E.164) de 2 dígitos; +1 y +7 son de 1, el resto de 3. */
const LADAS_2 = new Set(("20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 " +
  "60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98").split(" "));
const LADAS_3 = new Set(("211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 " +
  "240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 " +
  "290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 " +
  "420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 " +
  "670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 " +
  "960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998").split(" "));

/** Lada de país con la que empiezan estos dígitos, o null si no existe. */
export function ladaDePais(digitos: string): string | null {
  if (digitos.startsWith("1") || digitos.startsWith("7")) return digitos[0];
  if (LADAS_2.has(digitos.slice(0, 2))) return digitos.slice(0, 2);
  if (LADAS_3.has(digitos.slice(0, 3))) return digitos.slice(0, 3);
  return null;
}

export type ResultadoNumero =
  | { ok: true; e164: string; legible: string }
  | { ok: false; error: string };

const ERROR_NUMERO = "Escribe tu número de WhatsApp a 10 dígitos, sin la lada del país (por ejemplo 999 123 4567).";
const ERROR_OTRO_PAIS =
  "Ese número parece de otro país. Toca «¿Otro país?» para escribirlo con el signo + y la lada de tu país.";
const ERROR_INTL = "Escribe el número con el signo + y la lada de tu país (por ejemplo +57 300 123 4567).";

/** «mx»: el campo trae fijo +52 y se piden 10 dígitos. «intl»: número internacional con «+» y lada. */
export type ModoNumero = "mx" | "intl";

/**
 * Número de WhatsApp → E.164 sin «+».
 *  · modo «mx» (el de siempre): 10 dígitos → 52 + 10. Se tolera que peguen +52…, 52… o 521… (móvil viejo);
 *    cualquier otro «+lada» se rechaza: un mexicano nunca queda tomado por Brasil o Francia.
 *  · modo «intl» (tras «¿Otro país?»): obligatorio «+» (o 00) y lada de país que exista, 8 a 15 dígitos;
 *    +1 pide 11 y +52 se valida como México.
 */
export function normalizarNumeroWhatsapp(crudo: string, modo: ModoNumero = "mx"): ResultadoNumero {
  const texto = String(crudo ?? "").trim();
  if (!texto) return { ok: false, error: "Escribe tu número de WhatsApp." };
  if (/[^\d\s()+\-.]/.test(texto)) {
    return { ok: false, error: "El número solo puede llevar dígitos, espacios, guiones y el signo +." };
  }
  // El «+» solo va una vez y al principio.
  if (texto.lastIndexOf("+") > 0 || (texto.match(/\+/g) ?? []).length > 1) {
    return { ok: false, error: modo === "mx" ? ERROR_NUMERO : ERROR_INTL };
  }
  let d = texto.replace(/\D/g, "");
  const conMas = texto.startsWith("+") || d.startsWith("00");
  if (d.startsWith("00")) d = d.slice(2);
  const falla = (error: string): ResultadoNumero => ({ ok: false, error });

  const mexicano = (): ResultadoNumero => {
    const local = d.slice(2);
    // México: 10 dígitos, y la lada no empieza en 0 ni en 1.
    if (local.length !== 10 || /^[01]/.test(local)) return falla(ERROR_NUMERO);
    return { ok: true, e164: d, legible: `+52 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` };
  };

  if (modo === "mx") {
    if (conMas && !d.startsWith("52")) return falla(ERROR_OTRO_PAIS);
    if (d.length === 10) d = `52${d}`;
    else if (d.length === 13 && d.startsWith("521")) d = `52${d.slice(3)}`;
    else if (!(d.length === 12 && d.startsWith("52"))) return falla(d.length > 10 ? ERROR_OTRO_PAIS : ERROR_NUMERO);
    return mexicano();
  }

  if (!conMas) return falla(ERROR_INTL);
  if (d.length < 8 || d.length > 15 || d.startsWith("0")) return falla(ERROR_INTL);
  if (d.startsWith("52")) {
    if (d.length === 13 && d.startsWith("521")) d = `52${d.slice(3)}`;
    return mexicano();
  }
  const cc = ladaDePais(d);
  if (!cc) {
    return falla(`La lada «+${d.slice(0, 3)}» no corresponde a ningún país. Revisa el número que escribiste.`);
  }
  // Norteamérica (+1): lada + 10 dígitos.
  if (cc === "1" && d.length !== 11) return falla(ERROR_INTL);
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

/** Línea de log cuando el aviso no salió: el contacto no se pierde (nombre y número quedan en el log del servidor). */
export function registroLeadNoEnviado(l: { nombre: string; e164: string; legible: string; pagina?: string }): string {
  return `[whatsapp-lead] AVISO NO ENVIADO — contacto por recuperar: ${JSON.stringify({
    origen: ORIGEN_WIDGET_WHATSAPP, nombre: l.nombre, whatsapp: l.legible, e164: l.e164, pagina: l.pagina ?? null,
  })}`;
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
