// ═══════════════════════════════════════════════════════════════════════
// GET  /api/barber/campaigns/templates → textos de la barbería + fichas.
// PUT  /api/barber/campaigns/templates → los guarda.
//
// QUÉ SE EDITA Y QUÉ NO: Meta tiene aprobadas DOS plantillas de marketing
// para el vertical (cumpleaños y "te extrañamos"). Una plantilla nueva pasa
// por aprobación de Meta y NO se puede crear desde aquí. Lo que la barbería
// escribe es la PROMOCIÓN — la variable {{3}} de esas dos — y ahí sí puede
// usar fichas ({nombre}, {servicio}, {barbero}…) que se sustituyen por
// cliente en el momento de mandar.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  BARBER_CAMPAIGN_AUDIENCES,
  CAMPAIGN_DEFAULT_PROMOS,
  CAMPAIGN_PROMO_MAX,
  CAMPAIGN_TOKENS,
  CAMPAIGN_COOLDOWN_MAX,
  CAMPAIGN_COOLDOWN_MIN,
  getBarberCampaignConfig,
  saveBarberCampaignConfig,
} from "@/lib/barber/campaigns";
import { barberWaTemplate } from "@/lib/barber/whatsapp-core";
import { jsonError, openCampaignsGate, readJson } from "../_server";

export const dynamic = "force-dynamic";

function shape(config: Awaited<ReturnType<typeof getBarberCampaignConfig>>) {
  return {
    cooldownDays: config.cooldownDays,
    cooldownMin: CAMPAIGN_COOLDOWN_MIN,
    cooldownMax: CAMPAIGN_COOLDOWN_MAX,
    persisted: config.persisted,
    promoMax: CAMPAIGN_PROMO_MAX,
    tokens: CAMPAIGN_TOKENS,
    audiences: BARBER_CAMPAIGN_AUDIENCES.map((a) => {
      const tpl = barberWaTemplate(a.templateKind);
      return {
        id: a.id,
        templateName: tpl.name,
        templateBody: tpl.body,
        repeatAfterDays: a.repeatAfterDays,
        promo: config.templates[a.id],
        defaultPromo: CAMPAIGN_DEFAULT_PROMOS[a.id],
      };
    }),
  };
}

export async function GET() {
  const gate = await openCampaignsGate("whatsapp.view");
  if (gate.response) return gate.response;
  try {
    return NextResponse.json(shape(await getBarberCampaignConfig(gate.gate.ctx)));
  } catch (err) {
    console.error("[GET barber/campaigns/templates]", err);
    return jsonError("No se pudieron leer las plantillas.", 500);
  }
}

export async function PUT(req: Request) {
  const body = await readJson(req);
  // Editar los textos con los que se le habla a los clientes es configurar
  // la barbería, no mandar un mensaje: por eso `settings.edit`.
  const gate = await openCampaignsGate("settings.edit");
  if (gate.response) return gate.response;

  try {
    const result = await saveBarberCampaignConfig(gate.gate.ctx, {
      cooldownDays: body?.cooldownDays,
      templates: body?.templates,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          // "sql_pendiente" NO es un error del usuario: es que falta correr
          // sql/barber_campanas.sql. La pantalla lo dice tal cual.
          code: result.reason === "sql_pendiente" ? "SQL_PENDING" : "SAVE_FAILED",
          ...shape(result.config),
        },
        { status: result.reason === "sql_pendiente" ? 409 : 500 },
      );
    }
    return NextResponse.json({ ok: true, ...shape(result.config) });
  } catch (err) {
    console.error("[PUT barber/campaigns/templates]", err);
    return jsonError("No se pudieron guardar las plantillas.", 500);
  }
}
