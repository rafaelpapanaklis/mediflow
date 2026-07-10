import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { getCajaHistory } from "@/lib/caja";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cortes CERRADOS anteriores (historial).
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "30", 10) || 30;

  const history = await getCajaHistory(ctx.clinicId, limit);
  return NextResponse.json({ history });
}
