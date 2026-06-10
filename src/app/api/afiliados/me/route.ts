import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";

const VALID_PAYOUT_METHODS = new Set(["SPEI", "PAYPAL", "OTHER"]);

// PATCH /api/afiliados/me  body: { payoutMethod?, payoutDetails?,
//   notifySignup?, notifyConversion?, notifyPayout? }
// El afiliado edita SUS datos de pago y preferencias de notificación.
// affiliateId SIEMPRE sale de la sesión (getAffiliateContext), NUNCA del
// body — un afiliado no puede tocar a otro.
export async function PATCH(req: Request) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta aún no está aprobada." }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const methodRaw = typeof body?.payoutMethod === "string" ? body.payoutMethod.trim().toUpperCase() : "";
  const payoutMethod = methodRaw === "" ? null : VALID_PAYOUT_METHODS.has(methodRaw) ? methodRaw : null;
  const detailsRaw = typeof body?.payoutDetails === "string" ? body.payoutDetails.trim().slice(0, 300) : "";
  const payoutDetails = detailsRaw === "" ? null : detailsRaw;

  const updated = await prisma.affiliate.update({
    where: { id: ctx.affiliateId },
    data: { payoutMethod, payoutDetails },
    select: { payoutMethod: true, payoutDetails: true },
  });

  // Preferencias de notificación (opcionales) — solo booleans explícitos.
  const prefPatch: { notifySignup?: boolean; notifyConversion?: boolean; notifyPayout?: boolean } = {};
  if (typeof body?.notifySignup === "boolean") prefPatch.notifySignup = body.notifySignup;
  if (typeof body?.notifyConversion === "boolean") prefPatch.notifyConversion = body.notifyConversion;
  if (typeof body?.notifyPayout === "boolean") prefPatch.notifyPayout = body.notifyPayout;

  if (Object.keys(prefPatch).length > 0) {
    try {
      await prisma.affiliatePrefs.upsert({
        where: { affiliateId: ctx.affiliateId },
        update: prefPatch,
        create: {
          affiliateId: ctx.affiliateId,
          notifySignup: true,
          notifyConversion: true,
          notifyPayout: true,
          ...prefPatch,
        },
      });
    } catch (err) {
      // La tabla affiliate_prefs puede no existir aún en Supabase — degradar
      // sin romper la respuesta de los datos de pago.
      console.warn("[afiliados/me] no se pudieron guardar las preferencias:", err);
      return NextResponse.json({ ...updated, prefsSaved: false });
    }
  }

  return NextResponse.json(updated);
}
