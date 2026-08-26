// ═══════════════════════════════════════════════════════════════════════
// GET   /api/realty/affiliates/config → la config del programa
// PATCH /api/realty/affiliates/config → cambiarla
//
// 🔴 ESTA RUTA ES DE PLATAFORMA, NO DE UNA CUENTA. Se autentica con
// `getAdminSession()` (el admin de DaleControl) y NO con la sesión de
// inmuebles: el porcentaje de comisión lo fija Rafael, no cada inmobiliaria.
//
// Es lo que hace verdad la regla del vertical: cambiar cuánto se paga es
// EDITAR UNA FILA, no tocar código ni volver a desplegar. Por eso no hay
// ningún porcentaje escrito en el código fuera del respaldo que se usa
// cuando la tabla todavía no existe.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import {
  RealtyAffiliateError,
  getRealtyAffiliateConfig,
  saveRealtyAffiliateConfig,
  type RealtyAffiliateConfigPatch,
} from "@/lib/realty/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await getRealtyAffiliateConfig();
  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  // LISTA BLANCA de campos. Nunca un spread del body: un `id` colado ahí
  // rompería el CHECK de fila única y un campo desconocido sería una
  // columna que nadie revisó.
  const patch: RealtyAffiliateConfigPatch = {};
  if (body.enabled !== undefined) patch.enabled = body.enabled === true;
  if (body.commissionPct !== undefined) patch.commissionPct = Number(body.commissionPct);
  if (body.commissionMonths !== undefined) patch.commissionMonths = Number(body.commissionMonths);
  if (body.cookieDays !== undefined) patch.cookieDays = Number(body.cookieDays);
  if (body.payoutMinMxn !== undefined) patch.payoutMinMxn = Number(body.payoutMinMxn);
  if (body.terms !== undefined) patch.terms = body.terms === null ? null : String(body.terms);

  const before = await getRealtyAffiliateConfig();

  try {
    const config = await saveRealtyAffiliateConfig(patch);
    // La auditoría va por `logAdminGlobalEvent` y no por RealtyAdminAction
    // porque esto es configuración de PLATAFORMA: no tiene accountId, y esa
    // tabla lo exige como FK. Mismo criterio que la edición de planes.
    logAdminGlobalEvent({
      req,
      admin: { id: session.user.id, email: session.user.email },
      entity: "realty-affiliate-config",
      entityId: "default",
      action: "update",
      before,
      after: config,
    });
    return NextResponse.json({ config });
  } catch (err) {
    if (err instanceof RealtyAffiliateError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.code === "STORAGE" ? 503 : 400 },
      );
    }
    console.error("[api/realty/affiliates/config] PATCH:", err);
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
}
