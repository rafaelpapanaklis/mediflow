import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";
import { isPlanId } from "@/lib/billing/plans";
import { clearPlanConfigCache } from "@/lib/plans";
import { FALLBACK_PLAN_CONFIG, PLAN_MODULE_KEYS } from "@/lib/plan-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/admin/plan-config/[planId]
 *
 * Editor de la config GLOBAL de un plan (precio mensual/anual, límites,
 * máximos y permisos por módulo). Protegido por el guard admin existente
 * (cookie admin_token === ADMIN_SECRET_TOKEN). Tras guardar invalida la caché
 * en memoria para que el próximo checkout/gating use los valores nuevos.
 *
 * plan_configs es config global (sin clinicId/userId) → `logAudit` (FK a
 * clinic/user) no aplica; dejamos rastro estructurado en logs, igual que el
 * editor de precios de IA (admin/ai-billing/pricing).
 */

const INT_FIELDS = ["priceMxnMonthly", "priceMxnAnnual", "aiTokensDefault", "whatsappMonthly"] as const;
const NULLABLE_INT_FIELDS = ["maxPatients", "maxUsers"] as const;

/** Aplana BigInt → number para poder serializar la fila a JSON. */
function serialize(row: any) {
  if (!row) return row;
  return { ...row, storageBytes: Number(row.storageBytes) };
}

export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const planId = params.planId;
  if (!isPlanId(planId)) return NextResponse.json({ error: "Plan inválido" }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const update: any = {};

  if (typeof body.label === "string" && body.label.trim()) {
    update.label = body.label.trim().slice(0, 60);
  }

  for (const f of INT_FIELDS) {
    if (body[f] === undefined || body[f] === null || body[f] === "") continue;
    const n = Number(body[f]);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `Valor inválido para ${f}` }, { status: 400 });
    }
    update[f] = Math.round(n);
  }

  if (body.storageBytes !== undefined && body.storageBytes !== null && body.storageBytes !== "") {
    const n = Number(body.storageBytes);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "Valor inválido para storageBytes" }, { status: 400 });
    }
    update.storageBytes = BigInt(Math.round(n));
  }

  // maxPatients/maxUsers: null/"" = ilimitado.
  for (const f of NULLABLE_INT_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (v === null || v === "" || v === undefined) {
      update[f] = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `Valor inválido para ${f}` }, { status: 400 });
      }
      update[f] = Math.round(n);
    }
  }

  // features: solo keys del catálogo, normalizadas a boolean (default true; solo
  // un false explícito oculta el módulo).
  if (body.features && typeof body.features === "object") {
    const feats: Record<string, boolean> = {};
    for (const k of PLAN_MODULE_KEYS) feats[k] = body.features[k] !== false;
    update.features = feats;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
  }

  // Para create (upsert) completamos lo no enviado con el fallback del plan.
  const fb = FALLBACK_PLAN_CONFIG[planId];
  const createData = {
    planId,
    label: update.label ?? fb.label,
    priceMxnMonthly: update.priceMxnMonthly ?? fb.priceMxnMonthly,
    priceMxnAnnual: update.priceMxnAnnual ?? fb.priceMxnAnnual,
    storageBytes: update.storageBytes ?? BigInt(fb.storageBytes),
    aiTokensDefault: update.aiTokensDefault ?? fb.aiTokensDefault,
    whatsappMonthly: update.whatsappMonthly ?? fb.whatsappMonthly,
    maxPatients: "maxPatients" in update ? update.maxPatients : fb.maxPatients,
    maxUsers: "maxUsers" in update ? update.maxUsers : fb.maxUsers,
    features: update.features ?? fb.features,
  };

  try {
    const before = await prisma.planConfig.findUnique({ where: { planId } });
    const saved = await prisma.planConfig.upsert({
      where: { planId },
      update,
      create: createData,
    });
    clearPlanConfigCache();
    console.info("[admin/plan-config] update", {
      planId,
      before: serialize(before),
      after: serialize(saved),
    });
    return NextResponse.json(serialize(saved));
  } catch (err: any) {
    console.error("[admin/plan-config PATCH]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
