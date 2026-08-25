// ═══════════════════════════════════════════════════════════════════════
// GET /api/barber/campaigns?audience=inactive|birthday|…&month=&days=
//   → a quién le tocaría, por qué, quién queda fuera y CUÁNTO COSTARÍA.
//     No manda absolutamente nada.
//
// El costo va en la respuesta desde la primera lectura, no detrás de un
// segundo clic: estos mensajes son categoría MARKETING (~4x que uno de
// utilidad en México) y los paga la barbería.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  estimateBarberCampaignCost,
  isBarberCampaignAudience,
  listBarberCampaignAudience,
  getBarberCampaignConfig,
  CAMPAIGN_BATCH_MAX,
} from "@/lib/barber/campaigns";
import { getBarberWaQuota, listBarberTemplates } from "@/lib/barber/whatsapp";
import { barberWaTemplateByName } from "@/lib/barber/whatsapp-core";
import { jsonError, openCampaignsGate } from "./_server";

export const dynamic = "force-dynamic";

function readInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openCampaignsGate("whatsapp.view");
  if (gate.response) return gate.response;
  const ctx = gate.gate.ctx;
  const shopId = ctx.barbershopId;

  const audience = url.searchParams.get("audience");
  if (!isBarberCampaignAudience(audience)) {
    return jsonError("Campaña desconocida.", 400);
  }

  try {
    const [list, config, quota, templates] = await Promise.all([
      listBarberCampaignAudience(ctx, {
        audience,
        month: readInt(url.searchParams.get("month")),
        days: readInt(url.searchParams.get("days")),
      }),
      getBarberCampaignConfig(ctx),
      getBarberWaQuota(shopId),
      listBarberTemplates(shopId),
    ]);

    const eligible = list.targets.filter((t) => t.eligible);
    // El costo se cotiza sobre lo que de verdad se puede mandar en UNA
    // tanda, no sobre la lista entera: enseñar $16 cuando el tope deja
    // salir 60 mensajes sería mentir.
    const sendable = Math.min(eligible.length, CAMPAIGN_BATCH_MAX);

    // ¿Está aprobada la plantilla en Meta? Si no, no se puede mandar y hay
    // que decirlo ANTES, no después de que la barbería apriete el botón.
    const status =
      templates.templates.find((t) => t.name === list.templateName)?.status ?? "MISSING";

    return NextResponse.json({
      audience: list.audience,
      days: list.days,
      month: list.month,
      targets: list.targets,
      skipped: list.skipped,
      eligibleCount: eligible.length,
      batchMax: CAMPAIGN_BATCH_MAX,
      templateName: list.templateName,
      templateStatus: status,
      templateBody: barberWaTemplateByName(list.templateName)?.body ?? "",
      promo: config.templates[audience],
      cooldownDays: config.cooldownDays,
      configPersisted: config.persisted,
      cost: estimateBarberCampaignCost(sendable),
      quota,
    });
  } catch (err) {
    console.error("[GET barber/campaigns]", err);
    return jsonError("No se pudo preparar la campaña.", 500);
  }
}
