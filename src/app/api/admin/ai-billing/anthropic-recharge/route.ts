import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rafael registra cuánto saldo cargó en Anthropic. Se guarda en USD cents
// (AnthropicRecharge.amountUsdCents). Acepta `amountUsd` (dólares) o
// `amountUsdCents` (centavos) directo.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const note =
    typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  try {
    const recharge = await prisma.anthropicRecharge.create({ data: { amountUsdCents, note } });
    return NextResponse.json(recharge, { status: 201 });
  } catch (err: any) {
    console.error("[admin/ai-billing/anthropic-recharge POST]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
