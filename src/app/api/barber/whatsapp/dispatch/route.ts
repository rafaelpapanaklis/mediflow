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
// ⚠️ El cron NO está dado de alta todavía: vercel.json está fuera del
// vertical barber y no se toca desde aquí. El bloque exacto que hay que
// pegar va en el reporte de ORQUESTA. Mientras tanto el botón del panel
// hace exactamente lo mismo para una barbería.
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
