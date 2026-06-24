// GET /api/paciente/notificaciones/unread-count → { count } | 401
// Ligero: solo COUNT de no leídas. Lo consume la campana del shell (poll 20s).
// Multi-tenant por ctx.links. Degrada a { count: 0 } si la tabla no existe.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";

export const dynamic = "force-dynamic";

const NOSTORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  const patientIds = ctx.links.map((l) => l.patientId);
  if (patientIds.length === 0) {
    return NextResponse.json({ count: 0 }, { headers: NOSTORE });
  }
  try {
    const count = await prisma.patientNotification.count({
      where: { patientId: { in: patientIds }, readAt: null },
    });
    return NextResponse.json({ count }, { headers: NOSTORE });
  } catch (err) {
    console.error("[paciente/notificaciones/unread-count] (¿SQL pendiente?):", err);
    return NextResponse.json({ count: 0 }, { headers: NOSTORE });
  }
}
