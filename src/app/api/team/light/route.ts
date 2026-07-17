import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/light — el equipo, en mínimo indispensable.
 *
 * Lo consume el picker de visibilidad por paciente (lo abre CUALQUIER staff que
 * pueda crear un paciente, no solo admins). GET /api/team es admin-only y además
 * expone de más para este caso (email, teléfono, cédulas, contadores), así que
 * no se toca: acá va solo lo que el picker pinta — nombre para la lista, role
 * para marcar/deshabilitar a los admins, color para el avatar.
 *
 * Aislamiento multi-tenant: clinicId SIEMPRE de la sesión, nunca del request.
 * Solo usuarios ACTIVOS: a un usuario inactivo no tiene sentido concederle
 * visibilidad (y normalizeVisibleUserIds lo rechazaría en el POST).
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const team = await prisma.user.findMany({
    where: { clinicId: ctx.clinicId, isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true, color: true },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json(team, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
