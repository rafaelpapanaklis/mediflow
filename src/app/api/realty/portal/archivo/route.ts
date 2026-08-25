import { NextResponse, type NextRequest } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import {
  getOwnerScope,
  getTenantScope,
  portalUnauthorized,
  resolveOwnerExpenseReceipt,
  resolveTenantFile,
} from "@/lib/realty/portal-auth";

/**
 * GET /api/realty/portal/archivo?tipo=<contrato|recibo|gasto>&id=<id>
 *
 * La ÚNICA puerta a un archivo del bucket privado realty-files desde el
 * portal. Devuelve un 302 a una liga firmada de 5 minutos.
 *
 * 🔴 ESTE ES EL ENDPOINT QUE UN ATACANTE INTENTARÍA PRIMERO: cambiar el
 * `id` por el de otro contrato. Por eso el id NUNCA se consulta a secas —
 * se resuelve dentro de resolveTenantFile / resolveOwnerExpenseReceipt,
 * cuyo `where` lleva accountId Y el conjunto de contratos o inmuebles del
 * cerco de la sesión. Un id ajeno no devuelve el archivo ajeno: devuelve
 * 404, exactamente igual que un id inventado.
 *
 * `tipo` decide qué cara hace falta. Un inquilino pidiendo tipo=gasto se
 * topa con getOwnerScope() → null → 401: no hay forma de que el papel de
 * uno abra la puerta del otro.
 *
 * Nunca se guarda la liga firmada: se genera fresca en cada visita. Una
 * liga vieja pegada en un chat caduca sola.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_ESTA = "Ese documento ya no está disponible.";

export async function GET(req: NextRequest) {
  const limited = await persistentRateLimit(req, {
    limit: 60,
    windowSec: 600,
    scope: "realty-portal-archivo",
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo");
  const id = url.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: NO_ESTA }, { status: 404 });

  try {
    let firmada: string | null = null;

    if (tipo === "contrato" || tipo === "recibo") {
      const scope = await getTenantScope();
      if (!scope) return portalUnauthorized();
      firmada = await resolveTenantFile(scope, tipo, id);
    } else if (tipo === "gasto") {
      const scope = await getOwnerScope();
      if (!scope) return portalUnauthorized();
      firmada = await resolveOwnerExpenseReceipt(scope, id);
    } else {
      return NextResponse.json({ error: NO_ESTA }, { status: 400 });
    }

    if (!firmada) return NextResponse.json({ error: NO_ESTA }, { status: 404 });

    const res = NextResponse.redirect(firmada, 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    console.error("[realty/portal/archivo] error:", err);
    return NextResponse.json({ error: NO_ESTA }, { status: 404 });
  }
}
