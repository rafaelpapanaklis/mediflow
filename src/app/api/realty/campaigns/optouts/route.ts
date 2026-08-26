// ═══════════════════════════════════════════════════════════════════════
// GET    /api/realty/campaigns/optouts → quién pidió no recibir
// POST   /api/realty/campaigns/optouts → darlo de baja a mano
// DELETE /api/realty/campaigns/optouts → reactivarlo
//
// 🔴 EL DELETE ES EL PELIGROSO. Quitarle la baja a alguien es volver a
// mandarle mensajes que pidió no recibir. Por eso:
//   · exige `confirm: true` explícito en el body — un DELETE con el
//     teléfono nada más no basta;
//   * exige whatsapp.send (quien puede reactivar es quien puede mandar);
//   · y la pantalla lo pide con el motivo escrito.
// La reactivación existe porque la gente cambia de opinión y lo dice por
// teléfono; lo que no puede existir es que se le quite la baja a alguien
// sin que nadie lo haya decidido.
//
// El GET también REFRESCA las bajas que llegaron por WhatsApp desde la
// última vez: la palabra "BAJA" la clasifica el mismo `classifyRealtyReply`
// que usa el webhook, así que la pantalla enseña lo mismo que aplica el
// envío. Ver syncRealtyOptOutsFromInbound.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  REALTY_CAMPAIGNS_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  clearRealtyOptOut,
  listRealtyOptOuts,
  realtyGrowthStorageReady,
  setRealtyOptOut,
  syncRealtyOptOutsFromInbound,
} from "@/lib/realty/bot/growth-db";
import type { RealtyOptOutScope } from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.view",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  // Si esto falla, la lista se enseña igual: perder el refresco es un dato
  // viejo; tumbar la pantalla es no poder ver ninguna baja.
  await syncRealtyOptOutsFromInbound(gate.ctx.accountId).catch(() => 0);

  const [optOuts, storageReady] = await Promise.all([
    listRealtyOptOuts(gate.ctx.accountId, 200),
    realtyGrowthStorageReady(),
  ]);
  return NextResponse.json({ optOuts, storageReady });
}

export async function POST(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.view",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  if (!(await realtyGrowthStorageReady())) {
    return NextResponse.json({ error: "Falta aplicar sql/realty_growth.sql." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const phone = mxTenDigits(body?.phone as string);
  if (!phone) return NextResponse.json({ error: "Teléfono no válido" }, { status: 400 });

  const ok = await setRealtyOptOut({
    accountId: gate.ctx.accountId,
    phone,
    contactId: typeof body?.contactId === "string" ? body.contactId : null,
    scope: (body?.scope === "ALL" ? "ALL" : "MARKETING") as RealtyOptOutScope,
    source: "MANUAL",
    note: typeof body?.note === "string" ? body.note.slice(0, 300) : null,
  });

  if (!ok) return NextResponse.json({ error: "No se pudo guardar la baja." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const phone = mxTenDigits(body?.phone as string);
  if (!phone) return NextResponse.json({ error: "Teléfono no válido" }, { status: 400 });

  // 🔴 La confirmación explícita. Sin esto, un DELETE suelto reactiva a
  // alguien que pidió que lo dejaran en paz.
  if (body?.confirm !== true) {
    return NextResponse.json(
      {
        error:
          "Reactivar a alguien que pidió la baja necesita confirmación expresa. Solo hazlo si te lo pidió esa persona.",
        needsConfirm: true,
      },
      { status: 428 },
    );
  }

  const ok = await clearRealtyOptOut(gate.ctx.accountId, phone);
  return NextResponse.json({ ok });
}
