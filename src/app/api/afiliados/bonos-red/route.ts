export const dynamic = "force-dynamic";

/**
 * POST /api/afiliados/bonos-red
 * body: { awardId: string, choice: "once" | "monthly" }
 *
 * El afiliado elige CÓMO cobra UN escalón del "Bono por tu equipo": una sola
 * comisión ahora, o una comisión al mes mientras sostenga el número.
 *
 * ⚠️ LA ELECCIÓN ES DEFINITIVA. Solo se acepta sobre un award en
 * `pending_choice`; en cuanto se registra, el escalón queda cerrado en esa
 * modalidad y un segundo intento choca con el 409. No hay endpoint para
 * cambiarla: por eso el panel pide una confirmación explícita antes de llamar
 * aquí, y por eso el aviso de "no se puede cambiar" va ANTES de los botones.
 *
 * PROPIEDAD DEL BONO — `affiliateId` sale SIEMPRE de la sesión
 * (getAffiliateContext) y viaja dentro del WHERE de `chooseNetworkBonus`, no
 * como una comprobación posterior: el award de otro afiliado sencillamente no
 * existe para esa consulta, así que un `awardId` adivinado devuelve 404 y no
 * hay ninguna ventana entre "leer el dueño" y "escribir la elección". El body
 * NUNCA aporta el afiliado.
 *
 * Los códigos de error los decide la capa de datos y se devuelven tal cual
 * (400 body inválido · 404 no es suyo o no existe · 409 ya elegido · 503 SQL
 * sin correr), con el mensaje en español que ya trae.
 */

import { NextResponse } from "next/server";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { chooseNetworkBonus, normalizeChoice } from "@/lib/affiliates/network-bonus";

export async function POST(req: Request) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta aún no está aprobada." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const awardId = typeof body?.awardId === "string" ? body.awardId.trim() : "";
  if (!awardId) {
    return NextResponse.json({ error: "Falta indicar de qué bono se trata." }, { status: 400 });
  }

  // `normalizeChoice` es la MISMA función que usa el resto del módulo: aquí no
  // se reinventa qué es una modalidad válida.
  const choice = normalizeChoice(typeof body?.choice === "string" ? body.choice.trim() : body?.choice);
  if (choice === null) {
    return NextResponse.json(
      { error: "Elige cómo quieres cobrar el bono: un solo pago o una cantidad cada mes." },
      { status: 400 },
    );
  }

  const result = await chooseNetworkBonus(ctx.affiliateId, awardId, choice);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.code });
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    commissionMxn: result.commissionMxn,
  });
}
