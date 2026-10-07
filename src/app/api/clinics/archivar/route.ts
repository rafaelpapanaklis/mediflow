import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { logMutation } from "@/lib/audit";
import { logError } from "@/lib/safe-log";
import { puedeCerrarSede, MENSAJE_NO_SE_PUEDE_CERRAR } from "@/lib/sede-cierre";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * M3 — el dueño cierra (archiva lógicamente) una de SUS sedes. Solo SUPER_ADMIN.
 * Anti-IDOR: el id del body se coteja contra las sedes donde la SESIÓN es dueña.
 * No borra nada: igual que el archivado de /admin, el expediente se conserva.
 */
const schema = z.object({ clinicId: z.string().trim().min(1).max(40) });

export async function POST(req: NextRequest) {
  const rl = await persistentRateLimit(req, { limit: 5, windowSec: 60 });
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede cerrar una sede." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const { clinicId } = parsed.data;

  try {
    const filas = await prisma.user.findMany({
      where: { supabaseId: ctx.user.supabaseId, role: "SUPER_ADMIN", isActive: true },
      select: { clinic: { select: { id: true, createdAt: true, archivedAt: true } } },
    });
    const sedes = filas.map((f) => f.clinic);
    const veredicto = puedeCerrarSede({ clinicId, clinicIdActiva: ctx.clinicId, sedes });
    if ("motivo" in veredicto) {
      return NextResponse.json({ error: MENSAJE_NO_SE_PUEDE_CERRAR[veredicto.motivo], code: veredicto.motivo }, { status: veredicto.motivo === "NO_ES_TUYA" ? 403 : 409 });
    }

    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        archivedAt: new Date(),
        archivedBy: `owner:${ctx.userId}`,
        archiveReason: "Cerrada por el dueño desde Sucursales",
        isPublic: false,
        landingActive: false,
      },
    });
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId,
      entityType: "clinic", entityId: clinicId, action: "archive",
      after: { archivedClinicId: clinicId },
    });
    return NextResponse.json({ success: true, clinicId });
  } catch (err: any) {
    logError("[api/clinics/archivar POST]", err);
    return NextResponse.json({ error: "No se pudo cerrar la sede" }, { status: 500 });
  }
}
