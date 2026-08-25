import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized, isRealtyWaGateOk, openRealtyWaGate } from "../_server";
import { expireStaleRealtyPending, sendRealtyVisitReminders } from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Los avisos con reloj que son de ESTA terminal: el recordatorio de visita y
// el cierre de los envíos que se quedaron colgados.
//
// 🔴 LA COBRANZA DE RENTA NO ESTÁ AQUÍ, Y ES A PROPÓSITO. La cola de avisos
// de renta la arma T4 (`buildRentNoticeQueue` → `deliverRentNotice`, en
// src/lib/realty/leases.ts) y la dispara su propio barrido
// (`/api/cron/realty-rent`). Esta terminal solo pone el envío por WhatsApp
// dentro de esa cola (`sendRentNoticeWhatsapp`). Tener dos barridos para el
// mismo cobro, cada uno con su llave de idempotencia, serían dos WhatsApps
// al mismo inquilino.
//
// ⚠️ EL CRON NO ESTÁ DADO DE ALTA TODAVÍA. `vercel.json` está FUERA del
// vertical (el guardia lo marca como prohibido) y no se toca desde aquí. El
// bloque exacto que hay que pegar va en el reporte de ORQUESTA.md. Mientras
// tanto, el botón del panel hace exactamente lo mismo para UNA cuenta.

/** Cron de Vercel: recorre TODAS las cuentas. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Primero se cierran los reclamos que se quedaron colgados de una corrida
  // anterior: si no, el panel enseña "pendiente" para siempre.
  const expired = await expireStaleRealtyPending();
  const visits = await sendRealtyVisitReminders();
  return NextResponse.json({ ok: true, expired, visits });
}

/** Botón del panel: solo la cuenta de la sesión. */
export async function POST() {
  const gate = await openRealtyWaGate("whatsapp.send");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const expired = await expireStaleRealtyPending(gate.ctx.accountId);
  const visits = await sendRealtyVisitReminders(gate.ctx.accountId);
  return NextResponse.json({ ok: true, expired, visits });
}
