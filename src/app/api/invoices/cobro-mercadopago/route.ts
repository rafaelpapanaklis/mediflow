// GET /api/invoices/cobro-mercadopago — ¿esta clínica puede cobrar facturas con
// Mercado Pago? (ws1-t1)
//
// → 200 { disponible: boolean }
//
// Lo preguntan el popup «Nueva factura» y el cobro de una factura ANTES de
// enseñar el método: sin cuenta conectada (o sin el SQL de la rama), el botón
// de Mercado Pago ni se pinta. Solo un booleano: nada de la cuenta sale de aquí.
// La clínica sale de la sesión, nunca del cliente.

import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { cobroMpDisponible } from "@/lib/factura-mp/servicio.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  try {
    return NextResponse.json({ disponible: await cobroMpDisponible(ctx.clinicId) });
  } catch (e) {
    // Sin respuesta de la base no se ofrece: el lado seguro es no enseñarlo.
    console.error("[invoices/cobro-mercadopago] no se pudo leer la cuenta:", (e as Error).message);
    return NextResponse.json({ disponible: false });
  }
}
