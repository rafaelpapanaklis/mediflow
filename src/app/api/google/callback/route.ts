import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const BASE = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones`;

  if (error || !code || !state) return NextResponse.redirect(`${BASE}&gcal=error`);

  try {
    // Verify authenticated session and match state to logged-in user
    const ctx = await getAuthContext();
    if (!ctx || ctx.userId !== state) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`);
    }

    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    const accessToken  = tokens.access_token  ?? null;
    const refreshToken = tokens.refresh_token ?? null;
    if (!accessToken && !refreshToken) throw new Error("No tokens");

    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const parts   = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        email = payload.email ?? null;
      } catch(e) { /* ignore parse error */ }
    }

    const user = await prisma.user.findUnique({
      where:  { id: state },
      select: { id: true, role: true, clinicId: true, clinic: { select: { name: true } } },
    });
    if (!user) throw new Error("User not found");

    await prisma.$executeRawUnsafe(
      `UPDATE users SET "googleCalendarToken"=$1,"googleRefreshToken"=$2,"googleCalendarEmail"=$3,"googleCalendarEnabled"=true,"updatedAt"=NOW() WHERE id=$4`,
      accessToken, refreshToken, email, state
    );

    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      await prisma.$executeRawUnsafe(
        `UPDATE clinics SET "googleCalendarToken"=$1,"googleRefreshToken"=$2,"googleCalendarEmail"=$3,"googleCalendarEnabled"=true,"updatedAt"=NOW() WHERE id=$4`,
        accessToken, refreshToken, email, user.clinicId
      );
    }

    return NextResponse.redirect(`${BASE}&gcal=success`);
  } catch (err: any) {
    console.error("Google OAuth callback error:", err?.message);
    return NextResponse.redirect(`${BASE}&gcal=error`);
  }
}
