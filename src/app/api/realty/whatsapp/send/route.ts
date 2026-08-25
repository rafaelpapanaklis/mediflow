import { NextRequest, NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../_server";
import { isRealtyWaSendOk } from "@/lib/realty/whatsapp-core";
import {
  notifyRealtyLead,
  notifyRealtyMatches,
  sendRealtyPropertyCard,
} from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Los envíos que dispara una PANTALLA (no el cron):
 *
 *   { action: "propertyCard", propertyId, phone, contactId? }
 *       La ficha del inmueble — el botón de la ficha, lo que el asesor hace
 *       20 veces al día.
 *   { action: "leadAck", leadId }
 *       El acuse al prospecto. Normalmente lo llama el alta del lead sin
 *       pasar por aquí; esto es el botón de "volver a intentar".
 *   { action: "match", propertyId }
 *       Avisar a quien buscaba algo así. Con sus tres frenos dentro.
 *
 * Todo pasa por sendRealtyWhatsApp, o sea: cupo, ventana de 24 h y registro
 * en el hilo. No hay atajo a Meta desde ninguna pantalla.
 */
export async function POST(req: NextRequest) {
  const gate = await openRealtyWaGate("whatsapp.send");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "propertyCard") {
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
    const phone = typeof body?.phone === "string" ? body.phone : "";
    if (!propertyId || !phone) {
      return NextResponse.json({ error: "Faltan el inmueble o el teléfono." }, { status: 400 });
    }
    const result = await sendRealtyPropertyCard({
      accountId: gate.ctx.accountId,
      propertyId,
      phone,
      contactId: typeof body?.contactId === "string" ? body.contactId : null,
    });
    if (!isRealtyWaSendOk(result)) {
      return NextResponse.json({ error: result.error, reason: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, messageId: result.messageId }, { status: 201 });
  }

  if (action === "leadAck") {
    const leadId = typeof body?.leadId === "string" ? body.leadId : "";
    if (!leadId) return NextResponse.json({ error: "Falta el prospecto." }, { status: 400 });

    // 🔴 El accountId sale de la SESIÓN, nunca del cuerpo: sin esta
    // comprobación, un leadId de otra inmobiliaria mandaría su mensaje.
    const { prisma } = await import("@/lib/prisma");
    const mine = await prisma.realtyLead.findFirst({
      where: { id: leadId, accountId: gate.ctx.accountId },
      select: { id: true },
    });
    if (!mine) return NextResponse.json({ error: "Prospecto no encontrado." }, { status: 404 });

    const result = await notifyRealtyLead(leadId);
    if (!isRealtyWaSendOk(result)) {
      return NextResponse.json({ error: result.error, reason: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, messageId: result.messageId }, { status: 201 });
  }

  if (action === "match") {
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
    if (!propertyId) return NextResponse.json({ error: "Falta el inmueble." }, { status: 400 });

    const { prisma } = await import("@/lib/prisma");
    const mine = await prisma.realtyProperty.findFirst({
      where: { id: propertyId, accountId: gate.ctx.accountId },
      select: { id: true },
    });
    if (!mine) return NextResponse.json({ error: "Inmueble no encontrado." }, { status: 404 });

    const result = await notifyRealtyMatches(propertyId);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
}
