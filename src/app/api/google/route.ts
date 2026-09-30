import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { getAuthUrl } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { limpiarGoogleCaido } from "@/lib/google-calendar-estado";
import { revocarTokensGoogle } from "@/lib/google-calendar-revocar";

// GET → redirect to Google OAuth
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = getAuthUrl(ctx.userId);
  return NextResponse.redirect(url);
}

// DELETE → disconnect Google Calendar
//
// Limpia nuestros datos y REVOCA el permiso en Google (antes la app seguía en
// «Cuentas y permisos» de la cuenta). No borra el calendario ni los eventos que
// ya se crearon: se quedan en la cuenta de Google y la pantalla lo dice.
export async function DELETE(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Los tokens se leen ANTES de borrarlos: son lo que se le entrega a Google.
  const aRevocar: (string | null)[] = [];
  const usuario = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { googleRefreshToken: true } });
  aRevocar.push(usuario?.googleRefreshToken ?? null);
  if (ctx.isAdmin) {
    const clinica = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { googleRefreshToken: true } });
    aRevocar.push(clinica?.googleRefreshToken ?? null);
  }

  // Always disconnect the user
  await prisma.user.update({
    where: { id: ctx.userId },
    data: {
      googleCalendarToken:   null,
      googleRefreshToken:    null,
      googleCalendarEmail:   null,
      googleCalendarEnabled: false,
    },
  });

  // If admin → also disconnect clinic-level calendar
  if (ctx.isAdmin) {
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: {
        googleCalendarToken:    null,
        googleRefreshToken:     null,
        googleCalendarEmail:    null,
        googleCalendarEnabled:  false,
        googleClinicCalendarId: null,
      },
    });
    // Desconectar a propósito no es una conexión «caída».
    await limpiarGoogleCaido(ctx.clinicId);
  }

  // Best-effort y con tope de tiempo: nunca impide que la desconexión termine.
  const rev = await revocarTokensGoogle(aRevocar);

  return NextResponse.json({
    success: true,
    // true solo si Google aceptó revocar todo lo que se le pidió (o ya no valía).
    permisoRevocado: rev.intentados > 0 && rev.revocados === rev.intentados,
    // Los eventos ya creados NO se borran: siguen en el calendario de Google.
    eventosSeQuedan: true,
  });
}
