import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { guardarPrecioModulo, moduloEnVenta, validarPrecioModulo } from "@/lib/marketplace/module-price-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/admin/module-price/[moduleKey]
 *
 * Precio de un módulo (mensual y anual), editable desde /admin/settings →
 * Planes sin pegar SQL ni redeploy (ws1-t5). La página de contratar y el
 * checkout leen la tabla `modules` en cada petición: el cambio aplica al
 * guardar, a quien contrate a partir de ahora. Quien ya lo paga conserva su
 * importe (Stripe lo fijó al comprar).
 *
 * Protegido por la sesión de admin (cookie admin_token → AdminSession viva +
 * AdminUser activo), igual que /api/admin/plan-config. `modules` es catálogo
 * global (sin clínica): el rastro va como evento estructurado en logs.
 */
export async function PATCH(req: NextRequest, { params }: { params: { moduleKey: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const moduleKey = params.moduleKey;
  if (!moduloEnVenta(moduleKey)) {
    return NextResponse.json({ error: "Este módulo no está a la venta: no tiene precio que editar." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const validado = validarPrecioModulo(body);
  if (validado.ok === false) return NextResponse.json({ error: validado.error }, { status: 400 });

  try {
    const guardado = await guardarPrecioModulo(moduleKey, validado.precio);
    if (guardado.ok === false) return NextResponse.json({ error: guardado.error }, { status: guardado.status });

    logAdminGlobalEvent({
      req,
      admin: admin.user,
      entity: "module-price",
      entityId: moduleKey,
      action: "update",
      before: guardado.antes,
      after: guardado.despues,
    });
    return NextResponse.json({ key: moduleKey, name: guardado.name, ...guardado.despues });
  } catch (err) {
    console.error("[admin/module-price PATCH]", err);
    return NextResponse.json({ error: "No se pudo guardar el precio. No se cambió nada." }, { status: 500 });
  }
}
