import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cierra la sesión Supabase del usuario de inmuebles (espejo de
// /api/barber/auth/logout). El sidebar redirige después a /login, que es el
// login COMPARTIDO: este vertical no tiene uno propio.
export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
