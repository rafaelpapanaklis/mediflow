// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — formato de fechas y tamaños.
//
// Módulo PURO y client-safe: no importa prisma, no importa "server-only".
// Lo cargan los componentes "use client" del módulo.
//
// ── 🔴 LAS FECHAS SE PINTAN EN LA ZONA DE LA CUENTA, NO EN LA DEL EQUIPO ─
// Todas las fechas del módulo viajan como ISO (UTC) y se formatean con la
// `timeZone` de la inmobiliaria, que es la misma con la que el servidor
// decidió a qué PERIODO cae cada operación. Dejar que el navegador use su
// zona parece inofensivo hasta que un asesor en Tijuana ve "31 de marzo"
// donde el aviso dice "1 de abril" — y el aviso es el que manda.
//
// ── POR QUÉ NO SE REUSA formatRealtyBytes ─────────────────────────────
// Vive en src/lib/realty/properties-shared.ts, que es de otra terminal de
// la ola. Son seis líneas: copiarlas cuesta menos que acoplar dos módulos
// que se despliegan por separado, y mucho menos que arrastrar sin querer un
// import de servidor hasta un componente de cliente.
// ═══════════════════════════════════════════════════════════════════════

const ZONA_POR_OMISION = "America/Mexico_City";

function intl(locale: string): string {
  return locale === "en" ? "en-US" : "es-MX";
}

/** "25 ago 2026". Cadena vacía si no hay fecha (nunca "Invalid Date"). */
export function fmtFecha(iso: string | null | undefined, timeZone?: string, locale = "es"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intl(locale), {
      timeZone: timeZone || ZONA_POR_OMISION,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    // Zona horaria inválida guardada en la cuenta: mejor la fecha cruda que
    // una pantalla en blanco.
    return iso.slice(0, 10);
  }
}

/** "25 ago 2026, 14:32" — la bitácora necesita la hora. */
export function fmtFechaHora(
  iso: string | null | undefined,
  timeZone?: string,
  locale = "es",
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intl(locale), {
      timeZone: timeZone || ZONA_POR_OMISION,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

/**
 * ISO → "AAAA-MM-DD" para un <input type="date">, EN LA ZONA DE LA CUENTA.
 *
 * `iso.slice(0, 10)` sería la fecha en UTC: una fecha de nacimiento
 * capturada como 1990-05-14 y guardada a medianoche UTC vuelve como
 * 1990-05-13 en México, y cada ida y vuelta por el formulario le resta otro
 * día. `en-CA` da justo "AAAA-MM-DD" sin tener que armar la cadena.
 */
export function isoAInputFecha(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || ZONA_POR_OMISION,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

/** "1.4 MB". Sin decimales para bytes y kilobytes. */
export function fmtBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
