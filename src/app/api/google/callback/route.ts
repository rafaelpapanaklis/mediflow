import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google-calendar";
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

    // Get user email from Google
    oauth2Client.setCredentials(tokens);
    const oauth2 = (await import("googleapis")).google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: gUser } = await oauth2.userinfo.get();

    // Save tokens to user
    await prisma.user.update({
      where: { id: state },
      data: {
        googleCalendarToken:   tokens.access_token  ?? null,
        googleRefreshToken:    tokens.refresh_token ?? null,
        googleCalendarEmail:   gUser.email          ?? null,
        googleCalendarEnabled: true,
      },
    });

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
