import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuthClient, getOrCreateClinicCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state"); // userId
  const error = searchParams.get("error");

  const REDIRECT_BASE = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${REDIRECT_BASE}&gcal=error`);
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    // FIX: access_token can be null on re-auth, use refresh_token to get a fresh one
    let accessToken = tokens.access_token;
    if (!accessToken && tokens.refresh_token) {
      oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
      const { credentials } = await oauth2Client.refreshAccessToken();
      accessToken = credentials.access_token ?? null;
    }

    if (!accessToken) {
      throw new Error("No access token received from Google");
    }

    // Get Google user info
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: tokens.refresh_token });
    const oauth2   = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: gUser } = await oauth2.userinfo.get();
    const email = gUser.email ?? null;

    // Get user from DB
    const user = await prisma.user.findUnique({
      where:   { id: state },
      include: { clinic: { select: { id: true, name: true } } },
    });
    if (!user) throw new Error("User not found");

    const refreshToken = tokens.refresh_token ?? null;

    // Always save on user
    await prisma.user.update({
      where: { id: state },
      data: {
        googleCalendarToken:   accessToken,
        googleRefreshToken:    refreshToken,
        googleCalendarEmail:   email,
        googleCalendarEnabled: true,
      },
    });

    // If admin → save on clinic too + create clinic calendar
    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      await prisma.clinic.update({
        where: { id: user.clinicId },
        data: {
          googleCalendarToken:   accessToken,
          googleRefreshToken:    refreshToken,
          googleCalendarEmail:   email,
          googleCalendarEnabled: true,
        },
      });

      // Try to create clinic calendar (non-fatal if fails)
      try {
        const calendarId = await getOrCreateClinicCalendar(accessToken, refreshToken!, user.clinic.name);
        if (calendarId) {
          await prisma.clinic.update({
            where: { id: user.clinicId },
            data:  { googleClinicCalendarId: calendarId },
          });
        }
      } catch (calErr) {
        console.error("Clinic calendar creation failed (non-fatal):", calErr);
      }
    }

    return NextResponse.redirect(`${REDIRECT_BASE}&gcal=success`);
  } catch (err) {
    console.error("Google OAuth error:", err);
    return NextResponse.redirect(`${REDIRECT_BASE}&gcal=error`);
  }
}
