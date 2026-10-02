// ═══════════════════════════════════════════════════════════════════════════
// El DÍA de vigencia de un presupuesto, el mismo en el panel y en la liga.
//
// `quotes.validUntil` es un DateTime que llega de dos sitios:
//   · el editor guarda la fecha elegida como MEDIANOCHE UTC ("2026-11-01" →
//     2026-11-01T00:00:00Z): ese instante significa «el 1 de noviembre»;
//   · «Presentar» sin vigencia pone ahora + 30 días: un instante cualquiera,
//     cuyo día es el del reloj de la CLÍNICA.
//
// Antes el panel lo pintaba en UTC y la liga con la hora del navegador del
// paciente: el mismo presupuesto decía «vence 1 nov» en la tarjeta y «Válido
// hasta 31/10» en la liga. Ahora el servidor calcula el día con la zona de la
// clínica y las dos pantallas pintan ese día, sin volver a pasar por `Date`.
// ═══════════════════════════════════════════════════════════════════════════

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const ZONA_POR_DEFECTO = "America/Mexico_City";

/** "YYYY-MM-DD" del día que significa `validUntil`, o null si no hay fecha. */
export function diaDeVigencia(valor: string | Date | null | undefined, zona: string | null | undefined): string | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return null;
  const medianocheUtc =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (medianocheUtc) return d.toISOString().slice(0, 10);
  try {
    // en-CA da justo "YYYY-MM-DD".
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zona || ZONA_POR_DEFECTO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    // Zona inválida guardada en la clínica: la de por defecto, nunca un error.
    return diaDeVigencia(d, ZONA_POR_DEFECTO);
  }
}

/** "2026-11-01" → "1 nov 2026". "—" si no es un día. */
export function fechaDeDia(dia: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia ?? "");
  if (!m) return "—";
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return "—";
  return `${Number(m[3])} ${mes} ${m[1]}`;
}

/**
 * Lo que pinta una tarjeta: el día que mandó el servidor (zona de la clínica)
 * y, si una respuesta vieja no lo trae, el cálculo con la zona por defecto.
 */
export function fechaDeVigencia(quote: { validUntil: string | null; validUntilDia?: string | null }): string {
  return fechaDeDia(quote.validUntilDia ?? diaDeVigencia(quote.validUntil, ZONA_POR_DEFECTO));
}
