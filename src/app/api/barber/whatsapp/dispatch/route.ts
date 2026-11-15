// ═══════════════════════════════════════════════════════════════════════
// GET  /api/barber/whatsapp/dispatch → LO LLAMA EL CRON (todas las barberías)
// POST /api/barber/whatsapp/dispatch → botón "enviar pendientes" del panel
//                                      (SOLO la barbería de la sesión)
//
// Una pasada hace dos cosas:
//   1. PROGRAMA los recordatorios que falten (una fila OUTBOUND/PENDING por
//      visita), leyendo la cita en ese momento;
//   2. DRENA la cola: manda lo PENDING y lo pasa a SENT o a FAILED con el
//      motivo REAL de Meta.
//
// El cron SÍ está dado de alta: vercel.json llama este GET cada 5 min
// ("*/5 * * * *"). El botón del panel hace exactamente lo mismo, pero
// solo para la barbería de la sesión.
//
// EL GET AGUANTA SER LLAMADO CADA POCOS MINUTOS, incluso encimado consigo
// mismo (una pasada lenta + la siguiente): programar es idempotente
// (candado por barbería), cada fila de la cola se reclama antes de mandarse
// (dos pasadas nunca mandan la misma) y la pasada se corta sola a los 240 s
// —`partial: true`— muy por debajo de los 300 s de maxDuration. Probado
// contra Postgres en __tests__/whatsapp-integration.test.ts.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { runBarberWaDispatch } from "@/lib/barber/whatsapp";
import { asString, cronAuthorized, jsonError, openWaGate, readJson } from "../_server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronAuthorized(req);
  if (denied) return denied;

  try {
    const result = await runBarberWaDispatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[GET barber/whatsapp/dispatch]", err);
    return jsonError("El despacho falló.", 500);
  }
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const gate = await openWaGate({
    permission: "whatsapp.send",
    branchId: asString(body?.branchId),
  });
  if (gate.response) return gate.response;

  try {
    // `only` acota a la sede de la sesión: el botón del panel jamás despacha
    // los mensajes de otra barbería.
    const result = await runBarberWaDispatch(gate.gate.shopId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST barber/whatsapp/dispatch]", err);
    return jsonError("No se pudieron enviar los pendientes.", 500);
  }
}
