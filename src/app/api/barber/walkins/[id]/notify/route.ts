// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/walkins/[id]/notify
//   → le avisa por WhatsApp a quien espera en la fila: "ya casi es tu turno".
//
// MANDA DE VERDAD. Antes este punto solo dejaba una fila PENDING en
// BarberMessage que nadie enviaba (el cron del despacho no estaba dado de
// alta). Ahora el aviso sale en el momento por el MISMO camino que el
// drenado de la cola (src/lib/barber/whatsapp.ts → notifyBarberWalkIn):
//   · con la ventana de 24 h abierta va como texto; si no, con la plantilla
//     de utilidad `dc_barber_turno_fila`;
//   · respeta el cupo de mensajes del plan;
//   · queda en la bandeja con su estado real (SENT → DELIVERED/READ, o
//     FAILED con el motivo de Meta);
//   · no se le avisa dos veces al mismo número en menos de 10 minutos.
//
// Si NO salió, el mostrador lo tiene que saber en el acto (la persona está
// esperando): la ruta responde con error y el motivo, no con un "encolado".
//
// La entrada de fila no se referencia con una FK porque BarberMessage no
// tiene columna para walk-ins y el schema NO se toca: el vínculo es
// (phone, templateName) dentro de la misma barbería.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { hasBarberPermission } from "@/lib/barber/permissions";
import {
  estimateWaitMinutes,
  toWalkInDTO,
  walkInNotifyBody,
  walkInsAhead,
} from "@/lib/barber/agenda";
import { notifyBarberWalkIn } from "@/lib/barber/whatsapp";
import { asString, jsonError, openAgendaGate, readJson } from "../../../appointments/_server";
import { loadQueueSnapshot, WALKIN_FEATURE } from "../../_server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  const snapshot = await loadQueueSnapshot(shopId);
  const queue = snapshot.rows.map(toWalkInDTO);
  const ahead = walkInsAhead(queue, entry.id);
  const etaMinutes = estimateWaitMinutes({
    ahead,
    chairs: snapshot.chairs,
    avgServiceMin: snapshot.avgServiceMin,
  });
  const preview = walkInNotifyBody({
    shopName,
    clientName: entry.clientName,
    ahead,
    etaMinutes,
  });

  let result;
  try {
    result = await notifyBarberWalkIn({ barbershopId: shopId, phone, body: preview });
  } catch (err) {
    console.error("[POST barber/walkins/notify]", err);
    return jsonError("No se pudo mandar el aviso. Intenta de nuevo.", 500);
  }

  if (result.outcome === "already") {
    // Mismo contrato que antes: el mostrador enseña "ya se le avisó".
    return NextResponse.json({
      queued: false,
      sent: false,
      messageId: result.messageId,
      reason: "ALREADY_QUEUED",
    });
  }
  if (result.outcome === "failed") {
    // 409 = algo que la barbería puede resolver (conectar, cupo); 502 = Meta
    // lo rechazó. En los dos casos viaja el motivo real.
    const fixable = result.code === "NOT_CONNECTED" || result.code === "QUOTA" || result.code === "NO_PHONE";
    return jsonError(result.error ?? "No se pudo mandar el aviso.", fixable ? 409 : 502, {
      code: result.code ?? "SEND_FAILED",
    });
  }

  return NextResponse.json({
    // `queued` se conserva porque es lo que lee el panel de la fila.
    queued: true,
    sent: result.outcome === "sent",
    messageId: result.messageId,
    preview,
    ahead,
    etaMinutes,
  });
}
