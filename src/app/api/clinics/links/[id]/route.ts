import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { getOwnedClinicIds } from "@/lib/branches";
import { persistentRateLimit } from "@/lib/failban";
import { logMutation } from "@/lib/audit";
import { logError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/clinics/links/[id] — corta el vínculo de pacientes entre dos
 * sedes. A partir de aquí cada una vuelve a ver sólo su propio expediente.
 *
 * ANTI-IDOR simétrico al POST: el id del vínculo llega por la URL, así que
 * ANTES de borrar se lee la fila y se exige que AMBAS clínicas del par estén
 * en las sedes del supabaseId de la SESIÓN. Sin ese cotejo, conocer un id
 * ajeno bastaría para desvincular sedes de otro dueño.
 */

const LINKS_RATE_LIMIT = { limit: 10, windowSec: 60 };

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const rl = await persistentRateLimit(req, LINKS_RATE_LIMIT);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Solo el dueño de la cuenta puede desvincular sedes." },
      { status: 403 },
    );
  }

  try {
    const link = await prisma.clinicPatientLink.findUnique({
      where: { id: params.id },
      select: { id: true, clinicAId: true, clinicBId: true },
    });
    // 404 genérico también cuando existe pero no es suyo: no confirmamos la
    // existencia de vínculos ajenos.
    if (!link) return NextResponse.json({ error: "Vínculo no encontrado" }, { status: 404 });

    // Basta con ser dueño de UNA de las dos sedes para cortar el vínculo.
    //
    // ⚠️ Exigir AMBAS (como estaba) crea un vínculo IRREVOCABLE: si el dueño
    // deja de serlo de una de las dos sedes —socio que se va, SUPER_ADMIN
    // desactivado—, nadie puede volver a cerrarlo y la sede ajena sigue
    // leyendo pacientes indefinidamente. Revocar el acceso A TUS PROPIOS datos
    // tiene que ser siempre unilateral; vincular sí exige las dos (ver POST).
    const owned = await getOwnedClinicIds(ctx.user.supabaseId);
    if (owned.indexOf(link.clinicAId) === -1 && owned.indexOf(link.clinicBId) === -1) {
      return NextResponse.json({ error: "Vínculo no encontrado" }, { status: 404 });
    }

    await prisma.clinicPatientLink.delete({ where: { id: link.id } });

    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "clinic",
      entityId: link.id,
      action: "delete",
      before: { patientLink: true, clinicAId: link.clinicAId, clinicBId: link.clinicBId },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    logError("[api/clinics/links DELETE]", err);
    return NextResponse.json({ error: "No se pudo desvincular las sedes" }, { status: 500 });
  }
}
