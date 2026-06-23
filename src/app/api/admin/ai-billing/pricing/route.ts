import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { clearPricingCache } from "@/lib/ai-billing/pricing";
import { logAdminGlobalEvent } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Editor de precios GLOBAL (fila id="default" de AiPricingConfig). Tras guardar
// se invalida la cache en memoria (clearPricingCache) para que el próximo cobro
// del bot use los precios nuevos.
const FIELDS = [
  "inputUsdPerMtok",
  "outputUsdPerMtok",
  "cacheWriteUsdPerMtok",
  "cacheReadUsdPerMtok",
  "usdToMxnRate",
  "feePct",
] as const;

export async function PATCH(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
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

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
  }
  if (data.feePct !== undefined && data.feePct > 100) {
    return NextResponse.json({ error: "feePct fuera de rango (0-100)" }, { status: 400 });
  }

  try {
    const prev = await prisma.aiPricingConfig.findUnique({ where: { id: "default" } });
    const config = await prisma.aiPricingConfig.upsert({
      where: { id: "default" },
      update: data,
      create: { id: "default", ...data },
    });
    clearPricingCache();
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "ai-pricing", entityId: "default",
      action: "update", before: prev ?? null, after: data,
    });
    return NextResponse.json(config);
  } catch (err: any) {
    console.error("[admin/ai-billing/pricing PATCH]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
