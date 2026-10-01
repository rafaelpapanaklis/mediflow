import { getTzParts } from "@/lib/agenda/time-utils";

/**
 * Fecha y hora reales para el bot de WhatsApp (ticket BEVADENT, ws1-t5).
 *
 * El modelo no sabe qué día es: sin este bloque contestaba «no tengo acceso a
 * la fecha del sistema», confundía el día de la semana con la fecha y ofrecía
 * días de otro mes. Aquí se calcula EN CADA TURNO, en el servidor y en la zona
 * de la clínica (`Clinic.timezone`), nunca un texto fijo.
 *
 * Puro (sin BD ni `server-only`): lo usan ai-prompt.ts y sus pruebas, que
 * pasan un `now` fijo.
 */

export const ZONA_POR_DEFECTO = "America/Mexico_City";

/** La zona de la clínica si Intl la reconoce; si no (vacía o inventada), CDMX. */
export function zonaValida(timezone: string | null | undefined): string {
  const tz = timezone?.trim();
  if (!tz) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "YYYY-MM-DD" de `now` en la zona dada. */
export function fechaISOEnZona(now: Date, timezone: string): string {
  const p = getTzParts(now, zonaValida(timezone));
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function sumarDiasISO(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// La fecha ISO ya es la fecha civil de la clínica: se formatea en UTC a
// mediodía para que ninguna zona la corra de día.
const FMT_DIA = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "jueves 1 de octubre de 2026" (sin la coma que mete Intl tras el día). */
export function diaLargo(iso: string): string {
  return FMT_DIA.format(new Date(`${iso}T12:00:00Z`)).replace(",", "");
}

/** "UTC-6" a partir del desfase real de la zona en ese instante. */
function desfaseUTC(now: Date, timezone: string): string {
  try {
    const parte = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!parte) return "";
    return parte === "GMT" ? "UTC" : parte.replace("GMT", "UTC");
  } catch {
    return "";
  }
}

/**
 * Bloque de texto para el system prompt: hoy (día de la semana, fecha, hora,
 * zona) y la tabla de los próximos `dias` días. Con la tabla el modelo no
 * tiene que calcular «el martes» ni «el 15»: lo lee.
 */
export function bloqueFechaActual(now: Date, timezone: string | null | undefined, dias = 14): string {
  const tz = zonaValida(timezone);
  const p = getTzParts(now, tz);
  const hoy = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const hora = `${pad2(p.hour === 24 ? 0 : p.hour)}:${pad2(p.minute)}`;
  const desfase = desfaseUTC(now, tz);

  const filas: string[] = [];
  for (let i = 0; i < dias; i++) {
    const iso = sumarDiasISO(hoy, i);
    const etiqueta = i === 0 ? " (hoy)" : i === 1 ? " (mañana)" : "";
    filas.push(`- ${diaLargo(iso)}${etiqueta}`);
  }

  return [
    `FECHA Y HORA ACTUALES (dato real del sistema, zona ${tz}${desfase ? `, ${desfase}` : ""}):`,
    `Hoy es ${diaLargo(hoy)} y son las ${hora}.`,
    `Próximos ${dias} días (usa esta tabla para saber qué fecha es «el martes», «mañana» o «el 15»):`,
    ...filas,
  ].join("\n");
}
