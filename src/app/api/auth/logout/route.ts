import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TWO_FA_COOKIE, TWO_FA_PENDING_COOKIE } from "@/lib/auth/two-factor-constants";

export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();

  const res = NextResponse.redirect(new URL("/login", request.url));
  // Limpiar cookies custom del dashboard para evitar que sobrevivan a la sesión.
  res.cookies.set("activeClinicId", "", { path: "/", maxAge: 0 });
  res.cookies.set("notifLastSeen", "", { path: "/", maxAge: 0 });
  // 2FA: la prueba y el flag pendiente no deben sobrevivir al cierre de sesión.
  res.cookies.set(TWO_FA_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(TWO_FA_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
