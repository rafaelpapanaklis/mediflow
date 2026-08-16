/**
 * Teléfono mexicano a 10 dígitos: la regla ÚNICA que comparten el formulario de
 * registro (navegador) y los endpoints de alta (servidor). Si los dos no validan
 * igual, el usuario ve el botón "Continuar" en verde y se estrella con un error
 * hasta el final del registro.
 *
 * Tolera lo que la gente escribe de verdad: espacios, guiones, paréntesis y la
 * lada +52 / +521 puesta de más delante de los 10 dígitos — se LIMPIA, no se
 * rechaza. Devuelve null si no quedan exactamente 10 dígitos.
 *
 * Las reglas de recorte son las mismas de normalizeMxWhatsAppPhone
 * (@/lib/whatsapp), que es quien vuelve a poner el 52 al mandar el mensaje. Esta
 * copia existe porque aquélla vive en un módulo de servidor (descifra tokens) y
 * este archivo lo importa también un componente cliente.
 */
export function mxTenDigits(input: string | null | undefined): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  const local =
    digits.length === 13 && digits.startsWith("521")
      ? digits.slice(3)
      : digits.length === 12 && digits.startsWith("52")
        ? digits.slice(2)
        : digits;
  return local.length === 10 ? local : null;
}

/** Mensaje único de error — mismo texto en el formulario y en los endpoints. */
export const MX_PHONE_ERROR = "Escribe tu WhatsApp a 10 dígitos";
