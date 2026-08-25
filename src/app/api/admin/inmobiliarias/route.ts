import { NextResponse, type NextRequest } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  EMPTY_REALTY_METRICS,
  getRealtyVerticalMetrics,
  listRealtyAccountsForAdmin,
} from "@/lib/realty/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/inmobiliarias — listado + métricas del vertical INMUEBLES.
 *
 * ⚠️ `isAdminAuthed()` es ASÍNCRONA: olvidar el `await` deja pasar una Promise
 * (siempre truthy) y abre el endpoint. Siempre `if (!(await isAdminAuthed()))`.
 *
 * 🔴 Las métricas de aquí son SOLO de inmuebles. Nunca se suman con las del
 * dental (/api/admin/billing) ni con las de barber (/api/admin/barberias):
 * cada vertical tiene su propio MRR porque cada uno tiene sus propias tablas.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const wantMetrics = searchParams.get("metrics") === "1";

  try {
    const [accounts, metrics] = await Promise.all([
      listRealtyAccountsForAdmin({
        q: searchParams.get("q") ?? undefined,
        plan: searchParams.get("plan") ?? undefined,
        mode: searchParams.get("mode") ?? undefined,
        status: searchParams.get("status") ?? undefined,
      }),
      wantMetrics ? getRealtyVerticalMetrics() : Promise.resolve(EMPTY_REALTY_METRICS),
    ]);
    return NextResponse.json({ accounts, metrics: wantMetrics ? metrics : null });
  } catch (err) {
    console.error("GET /api/admin/inmobiliarias error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
