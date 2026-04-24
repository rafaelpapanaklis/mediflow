import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

/**
 * OAuth callback from Supabase (Google, Microsoft/Azure, etc.)
 *
 * Resolución:
 *  1. Si no hay code → /login?error=auth_callback_failed
 *  2. Si el usuario ya tiene Clinic → redirect al ?next param (default /dashboard)
 *  3. Si el usuario NO tiene Clinic (primer OAuth) → redirect /signup?step=2&email={email}
 *     para completar los datos de clínica. El endpoint /api/auth/register-oauth
 *     se encarga de crear la Clinic sin re-crear al user Supabase.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = createClient();
  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !sessionData.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabaseId = sessionData.user.id;
  const email = sessionData.user.email ?? "";

  // ¿El user ya tiene Clinic(s)?
  try {
    const userClinics = await prisma.user.findMany({
      where: { supabaseId, isActive: true },
      select: { clinicId: true },
      orderBy: { createdAt: "asc" },
    });
    if (userClinics.length > 0) {
      const res = NextResponse.redirect(`${origin}${next}`);
      // Sembrar/limpiar cookie activeClinicId del nuevo supabaseId.
      res.cookies.set("notifLastSeen", "", { path: "/", maxAge: 0 });
      const { writeActiveClinicCookie } = await import("@/lib/active-clinic");
      if (userClinics.length === 1) {
        writeActiveClinicCookie(res, userClinics[0].clinicId);
      } else {
        res.cookies.set("activeClinicId", "", { path: "/", maxAge: 0 });
      }
      return res;
    }
  } catch (err) {
    // DB no disponible (build/prerendering) — fall through a signup
    console.error("[auth/callback] prisma lookup failed:", err);
  }

  // Primer OAuth — enviar al paso 2 del signup para completar datos de clínica
  const url = new URL(`${origin}/signup`);
  url.searchParams.set("step", "2");
  if (email) url.searchParams.set("email", email);
  // Señal para el form: vino de OAuth, no necesita crear Supabase user de nuevo
  url.searchParams.set("source", "oauth");
  return NextResponse.redirect(url.toString());
}
