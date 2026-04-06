import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { getAuthUrl } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

// GET → redirect to Google OAuth
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = getAuthUrl(ctx.userId);
  return NextResponse.redirect(url);
}

// DELETE → disconnect Google Calendar
export async function DELETE(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  }

  return NextResponse.json({ success: true });
}
