// ═══════════════════════════════════════════════════════════════════
// BAJAS DEL TOTAL que NO son descuento comercial (segunda auditoría de uso,
// C-17 a medias, 4-oct-2026). Puro, client-safe.
//
// Desde C-02/C-03 una factura puede bajar su total por un reembolso «le cobré
// de más» o por «dar de baja el resto» de un tratamiento que no siguió. Para
// que el CFDI siga cuadrando por conceptos, esa baja se escribe en
// `Invoice.discount` (lib/invoices/reajustar-total.ts) y deja una marca en las
// notas: «[BAJA DEL TOTAL: $X …]» o «[RESTO DADO DE BAJA: $X …]». Aquí se lee
// esa marca para separar lo que de verdad fue DESCUENTO comercial de lo que
// fue una baja: Caja › «Descuentos» decía $2,525 cuando
// solo $300 eran descuento.
// ═══════════════════════════════════════════════════════════════════

const RE_BAJA = /\[(?:BAJA DEL TOTAL|RESTO DADO DE BAJA):\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/g;

/** Suma de las bajas marcadas en las notas de la factura (en pesos). */
export function bajasDeLaFactura(notas: string | null | undefined): number {
  if (typeof notas !== "string" || !notas) return 0;
  let c = 0;
  for (const m of notas.matchAll(RE_BAJA)) c += Math.round(Number(m[1].replace(/,/g, "")) * 100) || 0;
  return c / 100;
}

/**
 * El descuento de una factura partido en lo COMERCIAL y lo que fue una baja.
 * Nunca negativo, y la baja nunca pasa del descuento guardado.
 */
export function partirDescuento(inv: { discount?: number | null; notes?: string | null } | null | undefined): { comercial: number; bajas: number } {
  const total = Math.max(0, Math.round((Number(inv?.discount) || 0) * 100));
  const bajas = Math.min(total, Math.round(bajasDeLaFactura(inv?.notes) * 100));
  return { comercial: (total - bajas) / 100, bajas: bajas / 100 };
}

/** «2026-10-04 09:35:12 UTC»: el sello de las demás marcas, con segundos (notasLegibles lo pinta en hora local). */
export function selloUtc(cuando: Date): string {
  return `${cuando.toISOString().slice(0, 10)} ${cuando.toISOString().slice(11, 19)} UTC`;
}

/**
 * La línea que se agrega a las notas cuando un reembolso baja el total.
 * F2 (tercera auditoría): lleva la fecha, para que Caja cuente la baja ENTERA en
 * el turno en que se hizo (antes se prorrateaba con los cobros como el descuento).
 */
export function lineaDeBaja(monto: number, motivo: string, cuando: Date = new Date()): string {
  const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(monto);
  return `[BAJA DEL TOTAL: ${pesos} · ${motivo} · ${selloUtc(cuando)}]`;
}

const RE_MARCA_COMPLETA = /\[(?:BAJA DEL TOTAL|RESTO DADO DE BAJA):\s*\$?\s*([\d,]+(?:\.\d{1,2})?)([^\]]*)\]/g;
const RE_SELLO = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?) UTC/;

/** Cada baja marcada, con su fecha si la trae (las de antes del 4-oct-2026 no la traen). */
export function marcasDeBaja(notas: string | null | undefined): Array<{ monto: number; cuando: Date | null }> {
  if (typeof notas !== "string" || !notas) return [];
  const out: Array<{ monto: number; cuando: Date | null }> = [];
  for (const m of notas.matchAll(RE_MARCA_COMPLETA)) {
    const monto = Math.round(Number(m[1].replace(/,/g, "")) * 100) / 100 || 0;
    const f = RE_SELLO.exec(m[2] ?? "");
    const cuando = f ? new Date(`${f[1]}T${f[2].length === 5 ? `${f[2]}:00` : f[2]}Z`) : null;
    out.push({ monto, cuando: cuando && !isNaN(cuando.getTime()) ? cuando : null });
  }
  return out;
}

/** Suma de las bajas FECHADAS dentro de [desde, hasta] (la baja entera, sin prorrateo). */
export function bajasEnVentana(notas: string | null | undefined, desde: Date, hasta: Date): number {
  // El sello va a segundos y la ventana se compara al segundo: dos turnos seguidos no cuentan la misma baja.
  const d = Math.floor(desde.getTime() / 1000) * 1000;
  const h = hasta.getTime();
  const c = marcasDeBaja(notas)
    .filter((b) => b.cuando && b.cuando.getTime() >= d && b.cuando.getTime() <= h)
    .reduce((acc, b) => acc + Math.round(b.monto * 100), 0);
  return c / 100;
}

/** Suma de las bajas SIN fecha (marcas viejas): esas siguen prorrateándose con los cobros. */
export function bajasSinFecha(notas: string | null | undefined): number {
  return marcasDeBaja(notas).filter((b) => !b.cuando).reduce((acc, b) => acc + Math.round(b.monto * 100), 0) / 100;
}
