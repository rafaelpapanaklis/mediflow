// Las marcas de las notas de una factura, para PERSONAS (segunda auditoría de
// uso, N-13, 4-oct-2026). Puro, client-safe.
//
// El panel deja marcas en `invoices.notes` que otras piezas leen (ultimaMarca,
// bajasDeLaFactura…): «[CITA CANCELADA CON DINERO PAGADO · A FAVOR DEL PACIENTE
// · $500.00 · Cuenta de Prueba · 2026-10-04 09:35 UTC]». Se guardan tal cual;
// aquí solo se ENSEÑAN legibles: sin corchetes, en minúsculas y con la hora en
// la zona de quien mira, no en UTC.

const RE_FECHA_UTC = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC/g;
const RE_MARCA = /\[([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{3,}?)(?::\s*| · )([^\]]*)\]/g;

function frase(t: string): string {
  const l = t.toLowerCase().trim();
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** `fmt` pinta un instante (p. ej. «4 oct 2026, 3:35 a. m.» en la zona del navegador o de la clínica). */
export function notasLegibles(notas: string | null | undefined, fmt: (d: Date) => string): string {
  if (typeof notas !== "string" || !notas.trim()) return "";
  return notas
    .replace(RE_FECHA_UTC, (_m, dia: string, hora: string) => {
      const d = new Date(`${dia}T${hora}:00Z`);
      return isNaN(d.getTime()) ? `${dia} ${hora}` : fmt(d);
    })
    .replace(RE_MARCA, (_m, etiqueta: string, resto: string) => {
      const partes = resto.split(" · ").map((x) => x.trim()).filter(Boolean);
      // «A FAVOR DEL PACIENTE» y demás decisiones vienen en mayúsculas: también en frase.
      const legibles = partes.map((p) => (/^[A-ZÁÉÍÓÚÑ ]{4,}$/.test(p) ? p.toLowerCase() : p));
      return `${frase(etiqueta)}: ${legibles.join(", ")}`;
    });
}
