import { NextRequest, NextResponse } from "next/server";
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

    console.log("TOKENS:", JSON.stringify({at: !!tokens.access_token, rt: !!tokens.refresh_token, idt: !!tokens.id_token}));
    const accessToken  = tokens.access_token  ?? null;
    const refreshToken = tokens.refresh_token ?? null;

    if (!accessToken && !refreshToken) {
      throw new Error("No tokens received from Google");
    }

    // Extract email from id_token JWT — always present, no extra API call needed.
    // This avoids the 401 error when calling userinfo endpoint with a null access_token.
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const parts   = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        email = payload.email ?? null;
      } catch {
        // non-fatal — email stays null
      }
    }

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

      if (refreshToken) {
        try {
          const calendarId = await getOrCreateClinicCalendar(
            accessToken ?? refreshToken,
            refreshToken,
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
