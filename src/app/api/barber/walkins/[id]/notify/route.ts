// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/walkins/[id]/notify
//   → PUNTO DE EXTENSIÓN del aviso de fila por WhatsApp. T7 lo conecta.
//
// ESTA OLA NO MANDA NADA. Aquí solo se REGISTRA el evento: se encola una
// fila BarberMessage (direction OUTBOUND, status PENDING) con el cuerpo ya
// redactado y templateName = BARBER_WALKIN_NOTIFY_TEMPLATE. El envío real
// —WABA de la barbería, cuota de mensajes del plan, reintentos, paso a
// SENT/DELIVERED/FAILED— es trabajo de la ola de WhatsApp (T7).
//
// CONTRATO PARA T7 (todo lo que necesita saber):
//   · Qué leer:  BarberMessage donde direction = OUTBOUND, status = PENDING
//                y templateName = "walkin_casi_es_tu_turno".
//   · Qué mandar: el campo `body`, ya redactado en es-MX por
//                walkInNotifyBody() (src/lib/barber/agenda.ts). Si T7 usa
//                una plantilla aprobada de Meta, ese texto es el fallback y
//                la referencia de las variables.
//   · A quién:   el campo `phone` (10 dígitos MX ya normalizados).
//   · Al acabar: status = SENT (+ waMessageId) o FAILED (+ errorMessage).
//   · Qué NO tomar: cualquier fila cuyo errorMessage empiece con
//                "[recordatorio-invalidado]" — ésa la matamos nosotros a
//                propósito (ver isInvalidatedReminder).
//   · No hay tabla nueva ni cola aparte: BarberMessage YA es la cola.
//
// La entrada de fila no se referencia con una FK porque BarberMessage no
// tiene columna para walk-ins y el schema NO se toca en esta ola: el
// vínculo es (phone, templateName) dentro de la misma barbería.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { hasBarberPermission } from "@/lib/barber/permissions";
import {
  BARBER_WALKIN_NOTIFY_TEMPLATE,
  estimateWaitMinutes,
  toWalkInDTO,
  walkInNotifyBody,
  walkInsAhead,
} from "@/lib/barber/agenda";
import { asString, jsonError, openAgendaGate, readJson } from "../../../appointments/_server";
import { loadQueueSnapshot, WALKIN_FEATURE } from "../../_server";

export const dynamic = "force-dynamic";

/** Ventana anti-spam: no se encola dos veces al mismo número tan seguido. */
const DEDUPE_MINUTES = 10;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  const gate = await openAgendaGate({
    permission: "walkin.manage",
    feature: WALKIN_FEATURE,
    branchId: asString(body?.branchId),
  });
  if (gate.response) return gate.response;
  const { ctx, shopId, shopName } = gate.gate;

  // Encolar un mensaje ES mandar un mensaje, solo que en diferido. Por eso
  // además del permiso de fila se exige el de enviar WhatsApp.
  const canSend = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "whatsapp.send",
  );
  if (!canSend) {
    return jsonError("No tienes permiso para enviar WhatsApp.", 403, {
      permission: "whatsapp.send",
    });
  }

  const entry = await prisma.barberWalkIn.findFirst({
    where: { id: params.id, barbershopId: shopId },
  });
  if (!entry) return jsonError("Esa persona ya no está en la fila.", 404);

  const phone = mxTenDigits(entry.phone ?? "");
  if (!phone) {
    return jsonError("Esa persona no dejó un WhatsApp a 10 dígitos.", 400, { code: "NO_PHONE" });
  }

  const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000);
  const already = await prisma.barberMessage.findFirst({
    where: {
      barbershopId: shopId,
      phone,
      templateName: BARBER_WALKIN_NOTIFY_TEMPLATE,
      status: "PENDING",
      createdAt: { gt: since },
    },
    select: { id: true },
  });
  if (already) {
    return NextResponse.json({ queued: false, messageId: already.id, reason: "ALREADY_QUEUED" });
  }

  const snapshot = await loadQueueSnapshot(shopId);
  const queue = snapshot.rows.map(toWalkInDTO);
  const ahead = walkInsAhead(queue, entry.id);
  const etaMinutes = estimateWaitMinutes({
    ahead,
    chairs: snapshot.chairs,
    avgServiceMin: snapshot.avgServiceMin,
  });

  const message = await prisma.barberMessage.create({
    data: {
      barbershopId: shopId,
      direction: "OUTBOUND",
      phone,
      body: walkInNotifyBody({
        shopName,
        clientName: entry.clientName,
        ahead,
        etaMinutes,
      }),
      templateName: BARBER_WALKIN_NOTIFY_TEMPLATE,
      status: "PENDING",
    },
    select: { id: true, body: true },
  });

  return NextResponse.json({
    queued: true,
    messageId: message.id,
    preview: message.body,
    ahead,
    etaMinutes,
  });
}
