import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuthClient, getOrCreateClinicCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const REDIRECT_BASE = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${REDIRECT_BASE}&gcal=error`);
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token && !tokens.refresh_token) {
      throw new Error("No tokens received from Google");
    }

    // Set ALL credentials at once before making any API calls
    oauth2Client.setCredentials({
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type:    tokens.token_type,
      expiry_date:   tokens.expiry_date,
    });

    // Get user email from Google
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: gUser } = await oauth2Api.userinfo.get();
    const email = gUser.email ?? null;

    const accessToken  = tokens.access_token  ?? null;
    const refreshToken = tokens.refresh_token ?? null;

    // Get user from DB
    const user = await prisma.user.findUnique({
      where:   { id: state },
      include: { clinic: { select: { id: true, name: true } } },
    });
    if (!user) throw new Error("User not found");

    // Save tokens on user
    await prisma.user.update({
      where: { id: state },
      data: {
        googleCalendarToken:   accessToken,
        googleRefreshToken:    refreshToken,
        googleCalendarEmail:   email,
        googleCalendarEnabled: true,
      },
    });

    // If admin → save on clinic + create clinic calendar
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

      if (accessToken) {
        try {
          const calendarId = await getOrCreateClinicCalendar(
            accessToken,
            refreshToken ?? accessToken,
            user.clinic.name
          );
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
    }

    return NextResponse.redirect(`${REDIRECT_BASE}&gcal=success`);
  } catch (err) {
    console.error("Google OAuth error:", err);
    return NextResponse.redirect(`${REDIRECT_BASE}&gcal=error`);
  }
}
