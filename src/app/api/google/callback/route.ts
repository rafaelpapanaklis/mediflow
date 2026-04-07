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

    // Extract email from id_token JWT — no API call needed
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
      where:  { id: state },
      select: { id: true, role: true, clinicId: true, clinic: { select: { name: true } } },
    });
    if (!user) throw new Error("User not found");

    // Save on user — use executeRawUnsafe for reliable parameterized SQL
    await prisma.$executeRawUnsafe(
      `UPDATE users SET 
        "googleCalendarToken" = $1, 
        "googleRefreshToken" = $2, 
        "googleCalendarEmail" = $3, 
        "googleCalendarEnabled" = true, 
        "updatedAt" = NOW() 
       WHERE id = $4`,
      accessToken, refreshToken, email, state
    );

    // If admin → save on clinic too
    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      await prisma.$executeRawUnsafe(
        `UPDATE clinics SET 
          "googleCalendarToken" = $1, 
          "googleRefreshToken" = $2, 
          "googleCalendarEmail" = $3, 
          "googleCalendarEnabled" = true, 
          "updatedAt" = NOW() 
         WHERE id = $4`,
        accessToken, refreshToken, email, user.clinicId
      );

      // Try to create clinic calendar (non-fatal)
      if (refreshToken) {
        try {
          const calendarId = await getOrCreateClinicCalendar(
            accessToken ?? refreshToken,
            refreshToken,
            user.clinic.name
          );
          if (calendarId) {
            await prisma.$executeRawUnsafe(
              `UPDATE clinics SET "googleClinicCalendarId" = $1 WHERE id = $2`,
              calendarId, user.clinicId
            );
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
