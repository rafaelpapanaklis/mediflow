// ═══════════════════════════════════════════════════════════════════════
// GET /api/cron/realty-rent → el barrido diario de la RENTA
//
// Tres cosas, en este orden y por cada cuenta activa con la feature
// `rentals`:
//   1. Genera los cargos que falten de los contratos ACTIVOS (idempotente
//      por el único (leaseId, periodMonth): correrlo dos veces no duplica
//      el cobro del mes).
//   2. Marca VENCIDO lo que ya venció sin ningún abono, y pone en VENCIDO
//      el contrato cuya fecha de término ya pasó. TERMINADO no lo pone el
//      cron: terminar es una decisión de una persona, con su depósito
//      resuelto y su inventario de salida.
//   3. Arma la cola de avisos escalonados del día (−5, día de pago, +3, +8)
//      y la entrega por los canales del PLAN.
//
// 🔴 El plan PROPIETARIO ($199) NO tiene WhatsApp: sus avisos salen por
// CORREO y como pendiente en el panel. El WhatsApp lo entrega T6.
//
// ⚠️ EL CRON NO ESTÁ DADO DE ALTA TODAVÍA: vercel.json está FUERA del
// vertical inmuebles (el guardia lo marca como prohibido) y no se toca
// desde aquí. El bloque exacto que hay que pegar va en el reporte de
// ORQUESTA.md. Mientras tanto, el botón "Correr el barrido" del tablero de
// cobranza hace exactamente lo mismo para UNA cuenta.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { runRentSweep } from "@/lib/realty/leases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Fail-closed: sin CRON_SECRET en el entorno, un "Bearer undefined"
  // pasaría y dejaría abierto un endpoint que manda correos.
  if (!process.env.CRON_SECRET) {
    console.error("[cron/realty-rent] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runRentSweep();

  // AuditLog NO sirve aquí: sus columnas clinicId y userId son FK NOT NULL
  // a las tablas del dental y un cron no tiene usuario. La traza es este
  // log estructurado, que sí queda en los logs de Vercel.
  console.log("[cron/realty-rent]", JSON.stringify(summary));

  return NextResponse.json(summary);
}
