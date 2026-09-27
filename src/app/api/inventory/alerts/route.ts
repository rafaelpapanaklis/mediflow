// Inventario B (WS1-T5) — avisos de caducidad (Inventario y "Hoy" del
// admin) y su configuración (días de anticipo, default 30).
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { esErrorDeLotesNoAplicados, getAlertDaysAhead, getExpiryAlerts, setAlertDaysAhead } from "@/lib/inventory/lots.server";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "inventory.view");
  if (denied) return denied;

  const [alertDaysAhead, alerts] = await Promise.all([
    getAlertDaysAhead(ctx.clinicId),
    getExpiryAlerts(ctx.clinicId),
  ]);
  return NextResponse.json({ alertDaysAhead, ...alerts });
}

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const body = await req.json();
  const days = Number(body.alertDaysAhead);
  if (!Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: "Los días de anticipo deben ser un número mayor a 0" }, { status: 400 });
  }

  try {
    const applied = await setAlertDaysAhead(ctx.clinicId, days);
    return NextResponse.json({ alertDaysAhead: applied });
  } catch (err: any) {
    if (esErrorDeLotesNoAplicados(err)) {
      return NextResponse.json({ error: "El SQL de lotes todavía no está aplicado en esta base (sql/inventario-lotes-caducidad-t5.sql)" }, { status: 503 });
    }
    console.error("Set alert days error:", err);
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
