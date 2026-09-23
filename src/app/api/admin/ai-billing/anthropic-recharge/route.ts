import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { MAX_RECHARGE_USD_CENTS } from "@/lib/ai-billing/topes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rafael registra cuánto saldo cargó en Anthropic. Se guarda en USD cents
// (AnthropicRecharge.amountUsdCents). Acepta `amountUsd` (dólares) o
// `amountUsdCents` (centavos) directo.
//
// Tope: antes solo se exigía «positivo», así que un dedazo de 50000 en vez
// de 500 metía $50,000 USD y descuadraba margen y runway sin que nada
// chillara. El mismo número vive en @/lib/ai-billing/topes, y la pantalla
// avisa antes de mandar una cifra fuera de lo normal.
export async function POST(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  let amountUsdCents: number | null = null;
  if (body?.amountUsdCents !== undefined && body?.amountUsdCents !== null && body?.amountUsdCents !== "") {
    amountUsdCents = Math.round(Number(body.amountUsdCents));
  } else if (body?.amountUsd !== undefined && body?.amountUsd !== null && body?.amountUsd !== "") {
    amountUsdCents = Math.round(Number(body.amountUsd) * 100);
  }

  if (amountUsdCents === null || !Number.isFinite(amountUsdCents) || amountUsdCents <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }
  if (amountUsdCents > MAX_RECHARGE_USD_CENTS) {
    return NextResponse.json(
      {
        error: `El monto excede el tope de $${(MAX_RECHARGE_USD_CENTS / 100).toLocaleString("en-US")} USD por recarga. Si es correcto, regístrala en varias.`,
        code: "RECARGA_FUERA_DE_TOPE",
      },
      { status: 400 },
    );
  }

  const note =
    typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  try {
    const recharge = await prisma.anthropicRecharge.create({ data: { amountUsdCents, note } });
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "ai-recharge", entityId: recharge.id,
      action: "create", after: { amountUsdCents, note },
    });
    return NextResponse.json(recharge, { status: 201 });
  } catch (err: any) {
    console.error("[admin/ai-billing/anthropic-recharge POST]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
