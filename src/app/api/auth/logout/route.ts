import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();

  const res = NextResponse.redirect(new URL("/login", request.url));
  // Limpiar cookies custom del dashboard para evitar que sobrevivan a la sesión.
  res.cookies.set("activeClinicId", "", { path: "/", maxAge: 0 });
  res.cookies.set("notifLastSeen", "", { path: "/", maxAge: 0 });
  return res;
}
