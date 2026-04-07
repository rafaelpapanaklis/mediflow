import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const BASE = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones`;

  console.log("STEP1 code:", !!code, "state:", !!state, "error:", error);
  if (error || !code || !state) return NextResponse.redirect(`${BASE}&gcal=error`);

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    console.log("STEP2 tokens:", !!tokens.access_token, !!tokens.refresh_token, !!tokens.id_token);

    const accessToken  = tokens.access_token  ?? null;
    const refreshToken = tokens.refresh_token ?? null;
    if (!accessToken && !refreshToken) throw new Error("No tokens");

    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const parts   = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        email = payload.email ?? null;
      } catch(e) { console.log("STEP3 id_token parse error:", e); }
    }
    console.log("STEP3 email:", email);

    const user = await prisma.user.findUnique({
      where:  { id: state },
      select: { id: true, role: true, clinicId: true, clinic: { select: { name: true } } },
    });
    console.log("STEP4 user found:", !!user, "role:", user?.role);
    if (!user) throw new Error("User not found");

    const result = await prisma.$executeRawUnsafe(
      `UPDATE users SET "googleCalendarToken"=$1,"googleRefreshToken"=$2,"googleCalendarEmail"=$3,"googleCalendarEnabled"=true,"updatedAt"=NOW() WHERE id=$4`,
      accessToken, refreshToken, email, state
    );
    console.log("STEP5 user update result:", result);

    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      const r2 = await prisma.$executeRawUnsafe(
        `UPDATE clinics SET "googleCalendarToken"=$1,"googleRefreshToken"=$2,"googleCalendarEmail"=$3,"googleCalendarEnabled"=true,"updatedAt"=NOW() WHERE id=$4`,
        accessToken, refreshToken, email, user.clinicId
      );
      console.log("STEP6 clinic update result:", r2);
    }

    console.log("STEP7 success redirect");
    return NextResponse.redirect(`${BASE}&gcal=success`);
  } catch (err: any) {
    console.error("STEP_ERROR:", err?.message, err?.code);
    return NextResponse.redirect(`${BASE}&gcal=error`);
  }
}
