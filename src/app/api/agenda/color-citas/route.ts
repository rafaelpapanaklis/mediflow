import { NextResponse, type NextRequest } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { hasPermission } from "@/lib/auth/permissions";
import { extractAuditMeta, logAudit } from "@/lib/audit";
import {
  AgendaFlexibleSinTablaError,
  guardarModoColor,
  leerAgendaFlexible,
} from "@/lib/agenda/agenda-flexible.server";

export const dynamic = "force-dynamic";

/**
 * /api/agenda/color-citas — «Colorear las citas por: Doctor / Procedimiento»
 * (WS1-T5, agenda flexible).
 *
 *     GET  (agenda.view)    → { encendida, modoColor }
 *     PUT  (settings.edit)  ← { modo: "doctor" | "procedimiento" } → { encendida, modoColor }
 *
 * El `clinicId` sale SIEMPRE de la sesión. Sin la bandera `agenda-flexible`
 * el ajuste no existe: el PUT contesta 404.
 */

function usuarioDe(session: { user: { role: string; permissionsOverride?: string[] | null } }) {
  return {
    role: session.user.role,
    permissionsOverride: session.user.permissionsOverride ?? [],
  };
}

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(usuarioDe(session), "agenda.view")) {
    return NextResponse.json({ error: "Permiso requerido: agenda.view" }, { status: 403 });
  }

  const { encendida, modoColor } = await leerAgendaFlexible(session.user.clinicId);
  return NextResponse.json({ encendida, modoColor });
}

export async function PUT(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(usuarioDe(session), "settings.edit")) {
    return NextResponse.json({ error: "Permiso requerido: settings.edit" }, { status: 403 });
  }

  let body: { modo?: unknown } = {};
  try {
    const crudo = await req.json();
    if (crudo && typeof crudo === "object") body = crudo as { modo?: unknown };
  } catch {
    body = {};
  }
  if (body.modo !== "doctor" && body.modo !== "procedimiento") {
    return NextResponse.json({ error: "modo debe ser «doctor» o «procedimiento»" }, { status: 400 });
  }

  const clinicId = session.user.clinicId;
  const antes = await leerAgendaFlexible(clinicId);
  if (!antes.encendida) {
    return NextResponse.json({ error: "no_disponible" }, { status: 404 });
  }

  try {
    await guardarModoColor(clinicId, body.modo);
  } catch (err) {
    if (err instanceof AgendaFlexibleSinTablaError) {
      return NextResponse.json({ error: "SQL_PENDIENTE" }, { status: 503 });
    }
    throw err;
  }

  await logAudit({
    clinicId,
    userId: session.user.id,
    entityType: "clinic",
    entityId: clinicId,
    action: "update",
    changes: { agendaColorPor: { before: antes.modoColor, after: body.modo } },
    ...extractAuditMeta(req),
  });

  return NextResponse.json({ encendida: true, modoColor: body.modo });
}
