import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cierra la sesión Supabase del usuario de barbería (espejo de
// /api/laboratorios/auth/logout). El sidebar redirige después a /login.
export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
