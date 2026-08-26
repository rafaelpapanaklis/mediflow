// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/affiliates/attribute → colgar esta cuenta de su padrino
//
// Lee la cookie `dci_aff` y la ata a la cuenta de quien está en sesión.
//
// 🔴 EL accountId SALE DE LA SESIÓN, NUNCA DEL BODY. Si viniera del body,
// cualquiera podría colgarse cuentas ajenas y cobrar sus comisiones.
//
// IDEMPOTENTE Y DE UNA SOLA VEZ: el único de la tabla es por cuenta
// referida. Se puede llamar en cada carga sin miedo — el segundo intento
// devuelve `alreadyAttributed` y no cambia nada. Por eso NO pide permiso ni
// feature del plan: es la cuenta REFERIDA la que llama, y ella no tiene por
// qué tener la feature `affiliates` (la tiene el socio que la recomendó).
//
// ── DÓNDE SE ENGANCHA ────────────────────────────────────────────────
// El sitio correcto es el alta: `POST /api/realty/auth/register`, que es de
// la Ola 0 y esta terminal no toca. La línea que falta ahí, justo después
// de crear la cuenta, es UNA:
//
//     await attributeRealtyReferral({
//       code: cookies().get("dci_aff")?.value ?? "",
//       referredAccountId: account.id,
//     });
//
// Mientras esa línea no exista, esta ruta es el camino: la llama el panel
// del socio y cualquier pantalla que quiera cerrar el círculo. Va dicho en
// el reporte para que nadie crea que la atribución ya está cableada sola.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { attributeRealtyReferral } from "@/lib/realty/affiliates";
import { REALTY_AFF_COOKIE } from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const code = req.cookies.get(REALTY_AFF_COOKIE)?.value ?? "";
  if (!code) return NextResponse.json({ outcome: "unknownCode" });

  const outcome = await attributeRealtyReferral({
    code,
    referredAccountId: ctx.accountId,
  });

  const res = NextResponse.json({ outcome });
  // Atribuida (o ya tenía padrino, o es ella misma): la cookie ya no sirve
  // para nada y quedarse guardada solo alarga un rastro innecesario.
  if (outcome === "attributed" || outcome === "alreadyAttributed" || outcome === "selfReferral") {
    res.cookies.set(REALTY_AFF_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
