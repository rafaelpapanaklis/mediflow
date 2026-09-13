import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { clearPricingCache } from "@/lib/ai-billing/pricing";
import {
  DEFAULT_PRICING_ROW_ID,
  MODEL_PRICING_ROW_PREFIX,
  modelEditsToWrite,
  parseModelPriceEdits,
} from "@/lib/ai-billing/pricing-core";
import { logAdminGlobalEvent } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Editor de precios GLOBAL de AiPricingConfig. Tras guardar se invalida la cache
// en memoria (clearPricingCache) para que el próximo cobro use los precios nuevos.
//   · Tipo de cambio y fee → fila id="default" (como siempre).
//   · Precio por modelo    → fila id="model:<id>", solo si difiere del precio de
//     lista o si ya existía (ver modelEditsToWrite).
// Los cuatro precios globales viejos de la fila default ya no cobran nada y no se
// aceptan aquí.
const FIELDS = ["usdToMxnRate", "feePct"] as const;
const LEGACY_PRICE_FIELDS = ["inputUsdPerMtok", "outputUsdPerMtok", "cacheWriteUsdPerMtok", "cacheReadUsdPerMtok"];

export async function PATCH(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Una pestaña abierta desde antes del deploy manda los precios globales viejos:
  // guardar solo fx/fee y contestar "actualizado" le haría creer que cambió un precio.
  if (body?.models === undefined && LEGACY_PRICE_FIELDS.some((f) => body?.[f] !== undefined)) {
    return NextResponse.json(
      { error: "Los precios ahora son por modelo. Recarga la página y vuelve a guardar." },
      { status: 409 },
    );
  }

  const data: Record<string, number> = {};
  for (const f of FIELDS) {
    const raw = body?.[f];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `Valor inválido para ${f}` }, { status: 400 });
    }
    data[f] = n;
  }
  if (data.feePct !== undefined && data.feePct > 100) {
    return NextResponse.json({ error: "feePct fuera de rango (0-100)" }, { status: 400 });
  }
  // Con fx en 0 todo cobro del bot sale en 0 MXN (un campo vacío llega como 0).
  if (data.usdToMxnRate !== undefined && data.usdToMxnRate <= 0) {
    return NextResponse.json({ error: "El tipo de cambio debe ser mayor que 0" }, { status: 400 });
  }

  const parsed = parseModelPriceEdits(body?.models);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const prev = await prisma.aiPricingConfig.findMany({
      where: { OR: [{ id: DEFAULT_PRICING_ROW_ID }, { id: { startsWith: MODEL_PRICING_ROW_PREFIX } }] },
    });
    const modelEdits = modelEditsToWrite(parsed.edits, new Set(prev.map((r) => r.id)));

    if (Object.keys(data).length === 0 && modelEdits.length === 0) {
      return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
    }

    const ops = [];
    if (Object.keys(data).length > 0) {
      ops.push(
        prisma.aiPricingConfig.upsert({
          where: { id: DEFAULT_PRICING_ROW_ID },
          update: data,
          create: { id: DEFAULT_PRICING_ROW_ID, ...data },
        }),
      );
    }
    for (const e of modelEdits) {
      const id = MODEL_PRICING_ROW_PREFIX + e.model;
      ops.push(prisma.aiPricingConfig.upsert({ where: { id }, update: e.price, create: { id, ...e.price } }));
    }
    const saved = await prisma.$transaction(ops);
    clearPricingCache();
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "ai-pricing", entityId: DEFAULT_PRICING_ROW_ID,
      action: "update",
      before: prev.length ? prev : null,
      after: { ...data, models: Object.fromEntries(modelEdits.map((e) => [e.model, e.price])) },
    });
    return NextResponse.json({ ok: true, saved: saved.length });
  } catch (err: any) {
    console.error("[admin/ai-billing/pricing PATCH]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
