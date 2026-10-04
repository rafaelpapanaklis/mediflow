// La puerta del servidor del tope de descuento (ws1-t5, punto 7). La usan
// POST /api/invoices, PATCH /api/invoices/[id] y /edit-price: un 403 con
// `code: "DESCUENTO_REQUIERE_DUENO"` si el descuento total pasa del % de la
// clínica y quien lo aplica no es el dueño. Sin sql/ws1-t5-dinero-caja.sql el
// tope es el de fábrica (20 %).
import { NextResponse } from "next/server";
import { leerAjustesDinero } from "./ajustes.server";
import { mensajeDescuentoRequiereDueno, porcentajeDeDescuento, revisarDescuento } from "./descuento-autorizacion";

export async function denegarDescuentoSobreTope(args: {
  clinicId: string;
  role: string | null | undefined;
  items: unknown;
  discount: number;
  /** Al editar: la factura como estaba (bajar o dejar igual un descuento nunca se bloquea). */
  antes?: { items: unknown; discount: number | null } | null;
}): Promise<NextResponse | null> {
  const pct = porcentajeDeDescuento(args.items, args.discount);
  if (pct <= 0) return null;
  const { descuentoMaxPct } = await leerAjustesDinero(args.clinicId);
  const antes = args.antes ? porcentajeDeDescuento(args.antes.items, args.antes.discount ?? 0) : null;
  const r = revisarDescuento({ pct, limite: descuentoMaxPct, role: args.role, antes });
  if (!r.error) return null;
  return NextResponse.json(
    { error: mensajeDescuentoRequiereDueno(r.error.pct, r.error.limite), code: r.error.code, pct: r.error.pct, limite: r.error.limite },
    { status: 403 },
  );
}
