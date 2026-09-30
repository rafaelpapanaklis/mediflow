import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { estadoConexionGoogle, leerAjustesGoogle } from "@/lib/google-calendar-estado";

export const dynamic = "force-dynamic";

// GET → estado de la conexión de Google Calendar DE LA CLÍNICA (no la del usuario).
// Solo admins: alimenta el aviso del panel «se perdió la conexión con Google».
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const clinica = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { googleCalendarEnabled: true, googleRefreshToken: true },
  });
  const ajustes = await leerAjustesGoogle(ctx.clinicId);
  return NextResponse.json({
    estado: estadoConexionGoogle(clinica, ajustes),
    caidoDesde: ajustes.caidoDesde,
    motivo: ajustes.motivo,
  });
}
