// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/leases/barrido → corre el barrido de la renta para LA
// CUENTA DE LA SESIÓN (el mismo que corre el cron para todas).
//
// Existe por dos razones:
//   1. El cron todavía no está dado de alta en vercel.json (ese archivo
//      está fuera del vertical y el guardia lo prohíbe). Mientras tanto,
//      este botón hace exactamente lo mismo para una cuenta.
//   2. Aunque el cron ya corra, sirve para no esperar a mañana cuando
//      alguien acaba de activar cinco contratos.
//
// 🔴 `only` sale de la sesión, NUNCA del body: sin eso, cualquiera podría
// disparar el barrido —y los correos— de otra cuenta.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  runRentSweep,
} from "@/lib/realty/leases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "payments.manage");
  } catch {
    return realtyForbidden("payments.manage");
  }

  try {
    const summary = await runRentSweep(ctx.accountId);
    console.log("[realty/barrido]", JSON.stringify({ accountId: ctx.accountId, ...summary }));
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return realtyApiError(err, "leases:sweep");
  }
}
