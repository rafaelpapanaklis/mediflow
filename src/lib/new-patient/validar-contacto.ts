// Teléfono y correo del alta de paciente (ws1-t1, ronda de arreglos de la auditoría de uso — C-88 y C-95).
//
// EL FALLO QUE CIERRA: la ventana «Nuevo paciente» aceptaba el teléfono «123» y el servidor «abcdefghij»: con
// ese número los recordatorios y avisos nunca llegan y nadie se entera. Un correo inválido se guardaba sin
// decir nada, y el aviso de obligatorios decía «marcados en rojo» sin nombrar el campo.
//
// Lo usan la ventana (para avisar antes de enviar) y `validatePatientCreateBody` (el servidor, la regla que no
// se puede saltar). Sin React ni Prisma.
//
// Decisión 8 de Rafael (ronda de arreglos): el teléfono, como hoy — la ventana lo pide, el servidor no lo exige
// (otras entradas crean pacientes sin teléfono). Aquí solo se valida su FORMA cuando viene.

/**
 * ¿Parece un teléfono al que se puede llamar o escribir? Lo mínimo para México: 10 dígitos (11–15 con lada
 * internacional, +52…), y solo dígitos, espacios, guiones, puntos, paréntesis y un «+» al principio.
 */
export function telefonoValido(raw: string): boolean {
  const t = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(t)) return false;
  const digitos = t.replace(/\D/g, "").length;
  return digitos >= 10 && digitos <= 15;
}

/** Un correo con forma de correo: algo@dominio.ext. */
export function correoValido(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export const TEXTOS_CONTACTO = {
  es: {
    telefono: "El teléfono no es válido: escribe 10 dígitos (o con lada internacional, +52…), sin letras.",
    correo: "El correo no es válido: revisa que tenga la forma nombre@dominio.com.",
    fechaFutura: "La fecha de nacimiento no puede estar en el futuro.",
    telefonoEmergencia: "El teléfono de emergencia no es válido: escribe 10 dígitos (o con lada internacional), sin letras.",
  },
  en: {
    telefono: "The phone number isn't valid: type 10 digits (or with the country code, +52…), no letters.",
    correo: "The email isn't valid: check it looks like name@domain.com.",
    fechaFutura: "The date of birth can't be in the future.",
    telefonoEmergencia: "The emergency phone isn't valid: type 10 digits (or with the country code), no letters.",
  },
} as const;

/** Quita la ayuda entre paréntesis de una etiqueta: «Alergias (separadas por coma)» → «Alergias». */
function etiquetaCorta(etiqueta: string): string {
  return etiqueta.replace(/\s*\(.*\)\s*$/, "").trim();
}

/**
 * El aviso de obligatorios NOMBRANDO los campos (antes: «Completa los campos obligatorios marcados en rojo»).
 * `etiquetas` = las etiquetas ya traducidas de los campos que faltan, en el orden de la ventana.
 */
export function textoFaltanCampos(etiquetas: string[], locale: string | null | undefined): string {
  const en = (locale ?? "es").toLowerCase().startsWith("en");
  const nombres = etiquetas.map(etiquetaCorta).filter(Boolean);
  const y = en ? "and" : "y";
  const lista =
    nombres.length <= 1 ? (nombres[0] ?? "") : `${nombres.slice(0, -1).join(", ")} ${y} ${nombres[nombres.length - 1]}`;
  if (en) return `Missing: ${lista} (marked in red).`;
  return nombres.length === 1 ? `Falta: ${lista} (marcado en rojo).` : `Faltan: ${lista} (marcados en rojo).`;
}

/** El aviso de «paciente creado» con nombre COMPLETO y folio (antes: «Paciente Audit creado»). */
export function nombreParaAvisoDeAlta(p: { firstName?: string | null; lastName?: string | null; patientNumber?: string | null }): string {
  const nombre = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return p.patientNumber ? `${nombre} (${p.patientNumber})` : nombre;
}
