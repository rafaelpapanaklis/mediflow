// GET /api/clinic/zona — la zona horaria de la clínica de la sesión, para que las
// fechas POR DEFECTO de cobros y facturas sean el «hoy» de la clínica y no el de la
// computadora (auditoría de uso C-33, 4-oct-2026). Solo la zona: nada más de la clínica.

import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { DEFAULT_INVOICE_TZ } from "@/lib/invoices/due-date";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const tz = (ctx.clinic?.timezone as string | null | undefined) || DEFAULT_INVOICE_TZ;
  return NextResponse.json({ timezone: tz }, { headers: { "Cache-Control": "private, max-age=300" } });
}
