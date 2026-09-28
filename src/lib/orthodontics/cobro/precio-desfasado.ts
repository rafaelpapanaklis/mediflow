// Ortodoncia — F «Cambio de técnica o de precio» (ws1-t10). Al pasar de brackets
// a alineadores, o al renegociar el precio, el «costo total» del caso cambia pero
// la FACTURA del tratamiento sigue en el monto de antes: dos números que ya no
// dicen lo mismo. Reestructurar el saldo (factura por la diferencia, nota de
// crédito, cambio de plan) es una decisión de dinero de la clínica, así que aquí
// solo se AVISA con claridad qué pasó y qué opciones hay. Puro.

const fmt = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(n);

export function avisoDePrecioDesfasado(args: {
  totalFactura: number;
  precioDelCaso: number;
  cambioTecnica: boolean;
}): string | undefined {
  const dif = Math.round((args.precioDelCaso - args.totalFactura) * 100) / 100;
  if (Math.abs(dif) <= 0.5) return undefined;
  const que = args.cambioTecnica ? "El cambio de técnica dejó" : "El cambio de precio dejó";
  const opcion = dif > 0
    ? `Faltan ${fmt(dif)}: cóbralos como un extra («Cobrar extra») o sube el precio de la factura.`
    : `Sobran ${fmt(-dif)} en la factura: baja su precio (Facturación → Editar precio) o devuélvelos/abónalos según lo acordado.`;
  return `${que} el precio del caso en ${fmt(args.precioDelCaso)} y la factura del tratamiento sigue en ${fmt(args.totalFactura)}. ${opcion}`;
}
