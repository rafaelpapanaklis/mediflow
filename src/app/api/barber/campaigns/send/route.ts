// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/campaigns/send
//   → manda la tanda. SOLO con acción explícita de la barbería.
//
// TRES CANDADOS, todos en el servidor:
//   1. `confirmCost` — la barbería tiene que mandar el costo que VIO. Si no
//      coincide con el que calcula el servidor, no sale nada. Así nadie
//      confirma un gasto distinto del que le enseñaron (una lista que
//      creció entre el render y el clic, por ejemplo).
//   2. La lista de elegibles se RECALCULA dentro de sendBarberCampaignRun:
//      los ids del body solo pueden restringirla, jamás ampliarla.
//   3. El cupo del plan lo revisa el emisor de T7 mensaje por mensaje.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  isBarberCampaignAudience,
  sendBarberCampaignRun,
  estimateBarberCampaignCost,
  listBarberCampaignAudience,
  CAMPAIGN_BATCH_MAX,
} from "@/lib/barber/campaigns";
import { asString, jsonError, openCampaignsGate, readJson } from "../_server";

export const dynamic = "force-dynamic";
// Una tanda son hasta 60 llamadas a Meta, una por cliente (cada mensaje
// lleva su propio texto). Con el default de 10 s se cortaría a la mitad.
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await readJson(req);
  const gate = await openCampaignsGate("whatsapp.send");
  if (gate.response) return gate.response;
  const ctx = gate.gate.ctx;

  const audience = body?.audience;
  if (!isBarberCampaignAudience(audience)) return jsonError("Campaña desconocida.", 400);

  const clientIds = Array.isArray(body?.clientIds)
    ? (body!.clientIds as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      )
    : [];
  if (clientIds.length === 0) return jsonError("Elige a quién le vas a escribir.", 400);

  // El marketing NUNCA sale solo: exige que la barbería confirme, viendo
  // el costo. Sin esta bandera explícita no se manda nada.
  if (body?.confirmed !== true) {
    return jsonError("Confirma el envío viendo el costo antes de mandar.", 400, {
      code: "NEEDS_CONFIRM",
    });
  }

  const month = Number.isFinite(Number(body?.month)) ? Number(body!.month) : undefined;
  const days = Number.isFinite(Number(body?.days)) ? Number(body!.days) : undefined;

  try {
    // Se recalcula el costo REAL antes de tocar Meta y se compara con el
    // que la barbería dice haber visto.
    const list = await listBarberCampaignAudience(ctx, { audience, month, days });
    const wanted = new Set(clientIds);
    const willSend = Math.min(
      list.targets.filter((t) => t.eligible && wanted.has(t.clientId)).length,
      CAMPAIGN_BATCH_MAX,
    );
    const cost = estimateBarberCampaignCost(willSend);

    if (willSend === 0) {
      return jsonError("Ya nadie de esa lista puede recibir esta campaña.", 400, {
        code: "NO_ELIGIBLE",
      });
    }

    const confirmed = Number(body?.confirmCost);
    if (!Number.isFinite(confirmed) || Math.abs(confirmed - cost.totalUsd) > 0.0001) {
      return jsonError(
        "La lista cambió desde que viste el costo. Vuelve a revisarla antes de mandar.",
        409,
        { code: "COST_CHANGED", cost },
      );
    }

    const result = await sendBarberCampaignRun(ctx, {
      audience,
      clientIds,
      promo: asString(body?.promo) ?? "",
      month,
      days,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST barber/campaigns/send]", err);
    return jsonError("No se pudo enviar la campaña.", 500);
  }
}
