import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient, getOrCreateClinicCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state"); // userId
  const error = searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones&gcal=error`
    );
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);
    const { google } = await import("googleapis");
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: gUser } = await oauth2.userinfo.get();

    // Get user + their clinic
    const user = await prisma.user.findUnique({
      where:   { id: state },
      include: { clinic: { select: { id: true, name: true } } },
    });
    if (!user) throw new Error("User not found");

    // Always save tokens on the user (for backward compat)
    await prisma.user.update({
      where: { id: state },
      data: {
        googleCalendarToken:   tokens.access_token  ?? null,
        googleRefreshToken:    tokens.refresh_token ?? null,
        googleCalendarEmail:   gUser.email          ?? null,
        googleCalendarEnabled: true,
      },
    });

    // If admin → also save tokens on clinic + create clinic calendar
    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      // Save clinic-level tokens
      await prisma.clinic.update({
        where: { id: user.clinicId },
        data: {
          googleCalendarToken:   tokens.access_token  ?? null,
          googleRefreshToken:    tokens.refresh_token ?? null,
          googleCalendarEmail:   gUser.email          ?? null,
          googleCalendarEnabled: true,
        },
      });

      // Create or find the clinic calendar in Google
      if (tokens.access_token && tokens.refresh_token) {
        const clinicCalendarId = await getOrCreateClinicCalendar(
          tokens.access_token,
          tokens.refresh_token,
          user.clinic.name
        );

        if (clinicCalendarId) {
          await prisma.clinic.update({
            where: { id: user.clinicId },
            data:  { googleClinicCalendarId: clinicCalendarId },
          });
        }
      }
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones&gcal=success`
    );
  } catch (err) {
    console.error("Google OAuth error:", err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones&gcal=error`
    );
  }
}
