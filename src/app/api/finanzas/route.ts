import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { expenseWindowEnd, resolveFinanzasWindow } from "@/lib/finanzas-periodo";
import { calcularResumenFinanzas } from "@/lib/finanzas-resumen.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// FINANZAS — resumen financiero de la clínica (dirección financiera).
// Solo LEE payments/invoices/appointments (la Caja NO se toca) y suma los
// gastos del módulo (tabla expenses — ver sql/expenses.sql).
//
// GET /api/finanzas?period=hoy|mes|mes_anterior|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]
// (default: mes). Ventanas ancladas al día natural de México (UTC-6 fijo,
// misma lógica que src/lib/caja.ts y src/lib/analytics/query.ts).
//
// Payment NO tiene clinicId: SIEMPRE se aísla vía invoice.clinicId, y el
// clinicId sale de la sesión (jamás de query). El contrato JSON está
// acordado con el equipo de UI — NO renombrar claves.
// ═══════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Finanzas = dirección financiera (utilidad, nómina): mismo permiso que
  // Analytics (solo admin/owner), NO billing.view (la recepción opera Caja).
  const denied = denyIfMissingPermission(ctx, "analytics.view");
  if (denied) return denied;
  const { clinicId } = ctx;

  const win = resolveFinanzasWindow(new URL(req.url).searchParams);
  if ("error" in win) return NextResponse.json({ error: win.error }, { status: 400 });
  const { from, to } = win;
  // Los gastos de «este mes» llegan al FIN del mes, no a ahora: un gasto con
  // fecha futura (la renta del 30 registrada el 5) tiene que verse y restar.
  // Cobros, ventas y citas siguen cortando en `to` (ver finanzas-periodo.ts).
  const expenseTo = expenseWindowEnd(new URL(req.url).searchParams.get("period"), new Date(), to);

  try {
    // El cálculo vive en @/lib/finanzas-resumen.server (movido tal cual, sin
    // tocar una consulta ni una cuenta): lo lee también Sabina, así que la
    // pantalla y ella dicen siempre las mismas cifras.
    return NextResponse.json(await calcularResumenFinanzas({ clinicId, from, to, expenseTo }));
  } catch (err: any) {
    console.error("[finanzas] GET error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al calcular el resumen de finanzas." }, { status: 500 });
  }
}
