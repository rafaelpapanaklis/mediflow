import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient, getOrCreateClinicCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const BASE = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${BASE}&gcal=error`);
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    const accessToken  = tokens.access_token  ?? null;
    const refreshToken = tokens.refresh_token ?? null;

    if (!accessToken && !refreshToken) {
      throw new Error("No tokens received from Google");
    }

    // v4 — Extract email from id_token JWT — no API call needed
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const parts   = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        email = payload.email ?? null;
      } catch { /* non-fatal */ }
    }

    // Get user from DB
    const user = await prisma.user.findUnique({
      where:   { id: state },
      select:  { id: true, role: true, clinicId: true, clinic: { select: { name: true } } },
    });
    if (!user) throw new Error("User not found");

    // Save tokens on user using raw SQL to avoid Prisma client cache issues
    await prisma.$executeRaw`
      UPDATE users SET
        "googleCalendarToken"   = ${accessToken},
        "googleRefreshToken"    = ${refreshToken},
        "googleCalendarEmail"   = ${email},
        "googleCalendarEnabled" = true,
        "updatedAt"             = NOW()
      WHERE id = ${state}
    `;

    // If admin → save on clinic too
    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      await prisma.$executeRaw`
        UPDATE clinics SET
          "googleCalendarToken"   = ${accessToken},
          "googleRefreshToken"    = ${refreshToken},
          "googleCalendarEmail"   = ${email},
          "googleCalendarEnabled" = true,
          "updatedAt"             = NOW()
        WHERE id = ${user.clinicId}
      `;

      // Try to create clinic calendar
      if (refreshToken) {
        try {
          const calendarId = await getOrCreateClinicCalendar(
            accessToken ?? refreshToken,
            refreshToken,
            user.clinic.name
          );
          if (calendarId) {
            await prisma.$executeRaw`
              UPDATE clinics SET "googleClinicCalendarId" = ${calendarId}
              WHERE id = ${user.clinicId}
            `;
          }
        } catch (calErr) {
          console.error("Clinic calendar creation failed (non-fatal):", calErr);
        }
      }
    }

    return NextResponse.redirect(`${BASE}&gcal=success`);
  } catch (err) {
    console.error("Google OAuth error:", err);
    return NextResponse.redirect(`${BASE}&gcal=error`);
  }
}
