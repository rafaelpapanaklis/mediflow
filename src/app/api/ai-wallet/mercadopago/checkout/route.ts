import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { env } from "@/env";
import { createPreference } from "@/lib/mercadopago";
import { buildMpTopupRef } from "@/lib/ai-wallet/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Topes de recarga del monedero de IA (centavos MXN). Evitan typos y abuso.
const MIN_TOPUP_CENTS = 5_000; // $50.00 MXN
const MAX_TOPUP_CENTS = 5_000_000; // $50,000.00 MXN

// POST /api/ai-wallet/mercadopago/checkout  { amountCents }
// Inicia una recarga ONE-SHOT del monedero de IA vía MercadoPago. A diferencia de
// las órdenes B2B (que cobran a la cuenta del vendedor), MediFlow cobra ESTA
// recarga con su token de PLATAFORMA. Crea primero un AiTopup(PENDING) y ancla el
// external_reference/notification_url a él; el webhook acredita al aprobarse.
// clinicId SIEMPRE de la sesión: una clínica jamás recarga el monedero de otra.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  let body: { amountCents?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const cents = Math.round(Number(body?.amountCents));
  if (!Number.isFinite(cents) || cents < MIN_TOPUP_CENTS || cents > MAX_TOPUP_CENTS) {
    return NextResponse.json(
      {
        error: `El monto debe estar entre $${MIN_TOPUP_CENTS / 100} y $${MAX_TOPUP_CENTS / 100} MXN.`,
      },
      { status: 400 },
    );
  }

  const token = env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "MercadoPago no está configurado." }, { status: 500 });
  }

  // MercadoPago exige back_urls/notification_url absolutas (auto_return=approved).
  // Sin base configurada produciríamos URLs relativas y MP rechazaría la
  // preferencia con un error opaco; mejor fallar claro acá.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return NextResponse.json({ error: "La URL base de la app no está configurada." }, { status: 500 });
  }

  // 1. Registro de la recarga ANTES de la preferencia: su id ancla el pago.
  const topup = await prisma.aiTopup.create({
    data: {
      clinicId: ctx.clinicId,
      amountCents: cents,
      method: "MERCADOPAGO",
      status: "PENDING",
    },
  });

  const ref = buildMpTopupRef(topup.id); // "aitopup:<id>"

  try {
    // 2. Preferencia de checkout. unit_price va en PESOS (MP usa unidades mayores),
    //    pero el saldo se acredita con los centavos exactos del AiTopup (sin drift).
    const pref = await createPreference(token, {
      items: [{ title: "Recarga de saldo IA", quantity: 1, unit_price: cents / 100 }],
      externalReference: ref,
      notificationUrl: `${base}/api/webhooks/mercadopago?ref=${ref}`,
      backUrls: {
        success: `${base}/dashboard?recarga=exito`,
        failure: `${base}/dashboard?recarga=error`,
        pending: `${base}/dashboard?recarga=pendiente`,
      },
    });

    // Traza de la preferencia (el id del pago real reemplaza este ref al acreditar).
    await prisma.aiTopup.update({ where: { id: topup.id }, data: { gatewayRef: pref.id } });

    return NextResponse.json({ initPoint: pref.initPoint, topupId: topup.id });
  } catch (err) {
    // La preferencia falló: marca la recarga FAILED para no dejar un PENDING colgado.
    await prisma.aiTopup
      .update({ where: { id: topup.id }, data: { status: "FAILED" } })
      .catch(() => {});
    console.error("createPreference (ai-wallet topup) error:", err);
    return NextResponse.json(
      { error: "No se pudo iniciar el pago con MercadoPago." },
      { status: 502 },
    );
  }
}
