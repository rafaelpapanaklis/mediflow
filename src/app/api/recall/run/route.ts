// Disparo MANUAL del barrido de recall para la clínica de la sesión
// (admin only). Lo usa el botón "Ejecutar barrido ahora" de la sección de
// configuración. Mismo motor que el cron, pero scoped a una sola clínica.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { sweepClinic } from "@/lib/recall/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { id: true, name: true, reminderSettings: true, waConnected: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const result = await sweepClinic(clinic);
  return NextResponse.json(result);
}
