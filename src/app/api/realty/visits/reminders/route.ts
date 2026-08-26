// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/visits/reminders — qué avisos tocan y cuáles ya salieron
// POST /api/realty/visits/reminders — mándalos ahora
//
// 🔴 ESTA RUTA NO MANDA NADA POR SÍ MISMA. Con la feature `whatsapp`, el
// POST delega ENTERO en sendRealtyVisitReminders (T6). Sin ella (plan
// PROPIETARIO), sale por correo. Dos colas para el mismo aviso serían dos
// WhatsApps al mismo prospecto — la lección que ya dejó escrita la ola de
// rentas cuando borró su barrido duplicado.
//
// El permiso es `visits.manage` y NO `whatsapp.send`: quien agenda es quien
// recuerda, y en el plan PROPIETARIO el aviso sale por correo, donde
// `whatsapp.send` no pinta nada. Cuando sí va por WhatsApp, el cupo, la
// ventana de 24 h y el gating por plan los sigue aplicando T6 dentro.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { checkVisitsAccess, listVisitReminders, runVisitReminders } from "@/lib/realty/visits";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "visits.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const data = await listVisitReminders(ctx);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "visits.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await runVisitReminders(ctx);
  const after = await listVisitReminders(ctx);
  return NextResponse.json({ ...result, pending: after.pending });
}
