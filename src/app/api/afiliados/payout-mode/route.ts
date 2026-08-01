import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { getPayoutConfig, type PayoutMode } from "@/lib/affiliates/payout";

/**
 * PATCH (o POST) /api/afiliados/payout-mode
 * body: { payoutMode: "recurring" | "onetime" }
 *
 * El afiliado elige CÓMO quiere cobrar sus comisiones: un monto fijo cada mes
 * mientras la clínica pague ("recurring") o un solo pago por clínica
 * ("onetime").
 *
 * ⚠️ IMPORTANTE — el cambio SOLO afecta a las clínicas FUTURAS. La modalidad se
 * CONGELA por clínica en `affiliate_clinic_terms` (ensureClinicTerms) en el
 * momento en que se atribuye el alta, así que las clínicas ya referidas
 * conservan para siempre la modalidad con la que entraron. Este endpoint nunca
 * toca esos términos congelados: solo escribe `Affiliate.payoutMode`, que es la
 * modalidad que se le congelará al PRÓXIMO referido.
 *
 * affiliateId SIEMPRE sale de la sesión (getAffiliateContext), NUNCA del body —
 * un afiliado no puede cambiarle la modalidad a otro.
 */
async function handlePayoutMode(req: Request) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta aún no está aprobada." }, { status: 403 });
  }

  // null = sql/afiliados-comisiones.sql sin correr → el motor está inactivo y
  // no hay nada que elegir todavía.
  const cfg = await getPayoutConfig();
  if (cfg === null) {
    return NextResponse.json(
      { error: "El esquema de pago aún no está disponible." },
      { status: 503 },
    );
  }
  if (cfg.allowAffiliateChoice === false) {
    return NextResponse.json(
      { error: "El programa no permite cambiar la modalidad; escríbenos si necesitas otra." },
      { status: 403 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const raw: string = typeof body?.payoutMode === "string" ? body.payoutMode.trim() : "";
  if (raw !== "recurring" && raw !== "onetime") {
    return NextResponse.json({ error: "Modalidad inválida." }, { status: 400 });
  }
  // Ternario explícito (no un cast) para que el literal quede tipado como
  // PayoutMode sin depender del narrowing de TS sobre un string.
  const payoutMode: PayoutMode = raw === "onetime" ? "onetime" : "recurring";

  const updated = await prisma.affiliate.update({
    where: { id: ctx.affiliateId },
    data: { payoutMode },
    select: { payoutMode: true },
  });

  return NextResponse.json({ ok: true, payoutMode: updated.payoutMode });
}

export async function PATCH(req: Request) {
  return handlePayoutMode(req);
}

// Alias por comodidad de clientes que no pueden mandar PATCH.
export async function POST(req: Request) {
  return handlePayoutMode(req);
}
