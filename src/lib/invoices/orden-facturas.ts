// El orden de las facturas en la ficha del paciente (QA de Rafael, 5-oct-2026,
// #11): la más reciente primero y, a igual fecha, el folio más alto primero
// (MF-0181 antes que MF-0179). Estable: no cambia entre pantallas ni al
// actualizar una factura en su sitio. Puro, client-safe.

const numeroDeFolio = (folio: unknown): number => {
  const m = String(folio ?? "").match(/(\d+)\s*$/);
  return m ? Number(m[1]) : -1;
};

const instante = (f: unknown): number => {
  const d = f instanceof Date ? f : new Date(String(f ?? ""));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

export function ordenarFacturas<F extends { id: string; createdAt?: unknown; invoiceNumber?: unknown }>(facturas: readonly F[]): F[] {
  return [...facturas].sort((a, b) =>
    instante(b.createdAt) - instante(a.createdAt)
    || numeroDeFolio(b.invoiceNumber) - numeroDeFolio(a.invoiceNumber)
    || String(b.invoiceNumber ?? "").localeCompare(String(a.invoiceNumber ?? ""))
    || a.id.localeCompare(b.id));
}

/**
 * La lista que llega del servidor (al refrescar la página) MEZCLADA con la que
 * ya tiene la ficha (QA de Rafael, 5-oct-2026, #1): por factura, gana la copia
 * MÁS NUEVA (`updatedAt`). Antes la lista del servidor reemplazaba a la local: si
 * llegaba un refresco viejo después de que el detalle subiera la factura recién
 * cobrada, la tarjeta volvía a «Pagado $0 · Saldo $700» hasta recargar.
 */
export function fusionarFacturas<F extends { id: string; updatedAt?: unknown }>(servidor: readonly F[], locales: readonly F[]): F[] {
  const local = new Map(locales.map((f) => [f.id, f]));
  return servidor.map((s) => {
    const l = local.get(s.id);
    if (!l) return s;
    return instante(l.updatedAt) > instante(s.updatedAt) ? { ...s, ...l } : s;
  });
}
