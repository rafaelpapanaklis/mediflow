// Agenda — el plazo de una cita apartada por anticipo, dicho con su DÍA (H4 de
// la revisión final, ws1-t4). Puro.
//
// EL FALLO. El chip decía «Apartada · paga antes de 19:00» cuando el límite
// era MAÑANA a las 19:00 (plazo de 24 h): recepción entendía «hoy».
//
// LA REGLA. Mismo día que hoy (en la zona de la clínica): «las 19:00». Día
// siguiente: «mañana a las 19:00». Más adelante: «el mié 30 sep a las 19:00».
import { formatTimeInTz } from "@/lib/agenda/date-ranges";

function diaEnZona(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}

function diasEntre(desde: string, hasta: string): number {
  const leer = (f: string) => {
    const [a, m, d] = f.split("-").map((x) => parseInt(x, 10));
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((leer(hasta) - leer(desde)) / 86_400_000);
}

/** «las 19:00», «mañana a las 19:00» o «el mié 30 sep a las 19:00». */
export function plazoApartadoEnPalabras(hasta: string | Date, ahora: Date, zona: string | null | undefined): string {
  const tz = zona || "America/Mexico_City";
  const limite = typeof hasta === "string" ? new Date(hasta) : hasta;
  const hora = formatTimeInTz(limite.toISOString(), tz);
  const dias = diasEntre(diaEnZona(ahora, tz), diaEnZona(limite, tz));
  if (dias <= 0) return `las ${hora}`;
  if (dias === 1) return `mañana a las ${hora}`;
  const fecha = new Intl.DateTimeFormat("es-MX", { timeZone: tz, weekday: "short", day: "numeric", month: "short" })
    .format(limite)
    .replace(/\./g, "")
    .replace(",", "");
  return `el ${fecha} a las ${hora}`;
}
