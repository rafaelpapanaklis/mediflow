// POST /api/settings/anticipos/plantilla — enciende UNA de las dos plantillas
// OPCIONALES de esta ola (ws1-t3 fase 3): "deposit_request" (dc_anticipo_cita,
// el link de Mercado Pago fuera de ventana) o "payment_receipt" (dc_recibo_pago,
// el botón «Enviar recibo» fuera de ventana). UTILITY, pero apagadas por
// defecto: la clínica las enciende aquí a sabiendas de que Meta se las cobra
// (igual que la de reseñas).
//
// Reusa provisionClinicTemplates con `kinds: [kind]`: pasar `kinds` explícito
// IGNORA el filtro `optional`/`includeMarketing` (selectEntries, en
// provision-templates.ts), así que esto NO enciende la de reseñas de paso.
//
// Mismo permiso que dar de alta las demás plantillas (whatsapp.send).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { provisionClinicTemplates } from "@/lib/whatsapp/provision-templates";
import { leerPantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KINDS_PERMITIDOS: readonly WhatsAppSendKind[] = ["deposit_request", "payment_receipt"];

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  if (typeof kind !== "string" || !(KINDS_PERMITIDOS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "Plantilla desconocida." }, { status: 400 });
  }

  const result = await provisionClinicTemplates(ctx.clinicId, { kinds: [kind as WhatsAppSendKind] });
  return NextResponse.json({ ok: result.ok, reason: result.reason ?? null, outcomes: result.outcomes, pantalla: await leerPantallaAnticipos(ctx.clinicId) });
}
