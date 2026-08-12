// "Crear mis plantillas" — alta de las plantillas del catálogo dentro de la
// cuenta de WhatsApp de la clínica de la sesión.
//
// Existe para las clínicas YA conectadas: el alta automática vive en el flujo
// de conexión, y quien conectó antes de esta tarea no va a volver a pasar por
// ahí. También sirve de reintento cuando Meta rechaza una o cuando el token no
// tenía permisos la primera vez.
//
// Multi-tenant: la clínica sale SIEMPRE de la sesión. El body solo puede pedir
// que se incluya la de marketing.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { parseWaTemplates } from "@/lib/whatsapp/template-config";
import { provisionClinicTemplates, syncClinicTemplates } from "@/lib/whatsapp/provision-templates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const user = ctx?.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Mismo permiso que el resto de escrituras de WhatsApp (conexión, bot).
  const denied = denyIfMissingPermission(user, "whatsapp.send");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  // Solo se crea la de MARKETING si la clínica la pide explícitamente: cuesta
  // más que las de utilidad y el paciente puede bloquear ese tipo de mensajes.
  const includeMarketing = (body as { includeMarketing?: unknown } | null)?.includeMarketing === true;

  const result = await provisionClinicTemplates(user.clinicId, { includeMarketing });

  // Tras crear se pregunta el estado real: Meta a veces aprueba en segundos, y
  // sin esto la pantalla diría "en revisión" hasta la próxima pasada del cron.
  let templates = result.templates;
  if (result.ok) {
    const sync = await syncClinicTemplates(user.clinicId).catch(() => null);
    if (sync?.changed) {
      const row = await prisma.clinic
        .findUnique({ where: { id: user.clinicId }, select: { waTemplates: true } })
        .catch(() => null);
      if (row) templates = parseWaTemplates(row.waTemplates);
    }
  }

  return NextResponse.json({
    ok: result.ok,
    reason: result.reason ?? null,
    templates,
    outcomes: result.outcomes,
  });
}
