// ═══════════════════════════════════════════════════════════════════════
// GET  /api/barber/whatsapp/campaign?kind=birthday|winback
//        → a quién le tocaría y CUÁNTO CUESTA. No manda nada.
// POST /api/barber/whatsapp/campaign
//        → manda la tanda. SOLO con acción explícita de la barbería.
//
// Estos dos mensajes son categoría MARKETING: cuestan ~4x que los de
// utilidad y el cliente puede bloquear ese tipo de mensajes en WhatsApp.
// Por eso NUNCA se disparan solos y por eso el GET enseña el costo
// estimado ANTES de que nadie apriete nada.
//
// Las listas salen de T2 (listBarberClients con filter birthday/inactive):
// no se reimplementan aquí.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { listBarberClients } from "@/lib/barber/clients";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  CAMPAIGN_BATCH_MAX,
  listBarberTemplates,
  sendBarberCampaign,
} from "@/lib/barber/whatsapp";
import { BARBER_WA_PRICE_USD, barberWaTemplate } from "@/lib/barber/whatsapp-core";
import { asString, jsonError, openWaGate, readJson, WA_INBOX_FEATURE } from "../_server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CampaignKind = "birthday" | "winback";

function readKind(value: unknown): CampaignKind | null {
  return value === "birthday" || value === "winback" ? value : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // SIN branchId a propósito: listBarberClients (T2) siempre lee la barbería
  // de la SESIÓN, así que aceptar otra sede aquí mandaría los mensajes de
  // una barbería con las credenciales de otra.
  const gate = await openWaGate({ permission: "whatsapp.send", feature: WA_INBOX_FEATURE });
  if (gate.response) return gate.response;
  const shopId = gate.gate.ctx.barbershopId;

  const kind = readKind(url.searchParams.get("kind"));
  if (!kind) return jsonError("Campaña desconocida.", 400);

  try {
    const recipients = await collectRecipients(gate.gate.ctx, kind);

    // ¿Está aprobada la plantilla? Si no, no se puede mandar y hay que
    // decirlo ANTES, no después de que la barbería apriete el botón.
    const tpl = barberWaTemplate(kind);
    const templates = await listBarberTemplates(shopId);
    const status = templates.templates.find((t) => t.name === tpl.name)?.status ?? "MISSING";

    return NextResponse.json({
      kind,
      recipients,
      batchMax: CAMPAIGN_BATCH_MAX,
      templateName: tpl.name,
      templateStatus: status,
      // Lo que Meta le va a cobrar A LA BARBERÍA, no a nosotros.
      estimatedUsd: Number((recipients.length * BARBER_WA_PRICE_USD.MARKETING).toFixed(4)),
      unitUsd: BARBER_WA_PRICE_USD.MARKETING,
    });
  } catch (err) {
    console.error("[GET barber/whatsapp/campaign]", err);
    return jsonError("No se pudo preparar la campaña.", 500);
  }
}

/**
 * Destinatarios de la campaña, tomados de las listas de T2 (filter
 * "birthday" = cumpleañeros del mes, "inactive" = sin venir desde hace los
 * días que la barbería configuró). Se leen varias páginas porque la lista
 * de T2 pagina de 25 en 25 y una tanda son 60.
 */
async function collectRecipients(
  ctx: Parameters<typeof listBarberClients>[0],
  kind: CampaignKind,
): Promise<{ clientId: string; name: string; phone: string }[]> {
  const filter = kind === "birthday" ? ("birthday" as const) : ("inactive" as const);
  const out: { clientId: string; name: string; phone: string }[] = [];

  for (let page = 1; page <= 3 && out.length < CAMPAIGN_BATCH_MAX; page++) {
    const list = await listBarberClients(ctx, { filter, page });
    for (const client of list.items) {
      if (client.blockedAt) continue;
      if (!mxTenDigits(client.phone)) continue;
      out.push({ clientId: client.id, name: client.name, phone: client.phone });
      if (out.length >= CAMPAIGN_BATCH_MAX) break;
    }
    if (list.items.length === 0 || page * list.pageSize >= list.total) break;
  }
  return out;
}

export async function POST(req: Request) {
  const body = await readJson(req);
  // Mismo criterio que el GET: la campaña siempre es de la barbería de la
  // sesión (los clientes los lista T2 sobre ella).
  const gate = await openWaGate({ permission: "whatsapp.send", feature: WA_INBOX_FEATURE });
  if (gate.response) return gate.response;

  const kind = readKind(body?.kind);
  if (!kind) return jsonError("Campaña desconocida.", 400);

  const clientIds = Array.isArray(body?.clientIds)
    ? (body!.clientIds as unknown[]).filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (clientIds.length === 0) return jsonError("Elige a quién le vas a escribir.", 400);

  const promo = asString(body?.promo) ?? "";

  try {
    const result = await sendBarberCampaign({
      barbershopId: gate.gate.ctx.barbershopId,
      kind,
      promo,
      clientIds,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST barber/whatsapp/campaign]", err);
    return jsonError("No se pudo enviar la campaña.", 500);
  }
}
