// GET   /api/paciente/notificaciones  → { notifications, unreadCount } | 401
// PATCH /api/paciente/notificaciones   { id } | { all: true } → { ok, unreadCount } | 400 | 401
//
// Centro de notificaciones del portal. Multi-tenant ESTRICTO: SOLO
// notificaciones cuyo patientId esté en los links de la sesión (ctx.links).
// Jamás se acepta patientId/clinicId del cliente. Degrada a vacío si la tabla
// aún no existe (SQL pendiente).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";

export const dynamic = "force-dynamic";

const NOSTORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  const patientIds = ctx.links.map((l) => l.patientId);
  if (patientIds.length === 0) {
    return NextResponse.json({ notifications: [], unreadCount: 0 }, { headers: NOSTORE });
  }

  try {
    const [rows, unreadCount] = await Promise.all([
      prisma.patientNotification.findMany({
        where: { patientId: { in: patientIds } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.patientNotification.count({
        where: { patientId: { in: patientIds }, readAt: null },
      }),
    ]);

    const notifications = rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    }));

    return NextResponse.json({ notifications, unreadCount }, { headers: NOSTORE });
  } catch (err) {
    // Tabla aún no creada (SQL pendiente) u otro fallo → degrada a vacío.
    console.error("[paciente/notificaciones] GET (¿SQL pendiente?):", err);
    return NextResponse.json({ notifications: [], unreadCount: 0 }, { headers: NOSTORE });
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  let body: { id?: unknown; all?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; all?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const patientIds = ctx.links.map((l) => l.patientId);
  if (patientIds.length === 0) {
    return NextResponse.json({ ok: true, unreadCount: 0 });
  }

  const markAll = body.all === true;
  const id = typeof body.id === "string" ? body.id : null;
  if (!markAll && !id) {
    return NextResponse.json({ error: "Falta id o all" }, { status: 400 });
  }

  try {
    // updateMany con el filtro de ownership (patientId IN links): jamás toca
    // notificaciones de otros pacientes aunque manden un id ajeno.
    await prisma.patientNotification.updateMany({
      where: {
        patientId: { in: patientIds },
        readAt: null,
        ...(markAll ? {} : { id: id as string }),
      },
      data: { readAt: new Date() },
    });
    const unreadCount = await prisma.patientNotification.count({
      where: { patientId: { in: patientIds }, readAt: null },
    });
    return NextResponse.json({ ok: true, unreadCount });
  } catch (err) {
    console.error("[paciente/notificaciones] PATCH:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
