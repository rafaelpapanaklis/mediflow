// ─────────────────────────────────────────────────────────────────────────────
// Fechas de pantalla en la zona de la CLÍNICA (auditoría de uso C-64, vuelta 2).
//
// Pasadas las 18:00 de México convivían el 3 y el 4 de octubre: plan «Inicio 4 oct», cuestionario «llenado el 4
// de octubre», consentimiento «Creado el 04 oct» contra la carta fechada el 3, y la hoja de control contaba
// «4 semanas» desde el día 4. Unas pantallas pintaban un INSTANTE en la zona del navegador (la del auditor estaba
// en Nueva York) y otras en la de la clínica. Aquí, una sola regla: un instante se pinta en la zona de la
// clínica; un día suelto («2026-10-03») se queda como el día que es.
//
// PURO (el hook, aparte, en use-zona-de-la-clinica.ts).
// ─────────────────────────────────────────────────────────────────────────────

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `Intl.DateTimeFormat` en la zona dada; sin zona (o inválida), la del navegador. */
export function formatoEnZona(
  valor: string | Date | null | undefined,
  opciones: Intl.DateTimeFormatOptions,
  zona: string | null | undefined,
  locale = "es-MX",
): string | null {
  if (!valor) return null;
  if (typeof valor === "string") {
    const m = SOLO_FECHA.exec(valor.trim());
    // Un día sin hora no tiene huso: se pinta ese día, en UTC, sea cual sea la zona.
    if (m) return new Intl.DateTimeFormat(locale, { ...opciones, timeZone: "UTC" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)));
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  if (zona) {
    try {
      return new Intl.DateTimeFormat(locale, { ...opciones, timeZone: zona }).format(d);
    } catch {
      // zona inválida: la del navegador
    }
  }
  return new Intl.DateTimeFormat(locale, opciones).format(d);
}

/** El día ("YYYY-MM-DD") de un instante en la zona dada; sin zona, el del navegador. */
export function diaEnZona(valor: string | Date, zona: string | null | undefined): string | null {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  if (zona) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    } catch {
      // zona inválida
    }
  }
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
