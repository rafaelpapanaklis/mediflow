import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Cierra la sesión Supabase del usuario de instituto (espejo de
// /api/barber/auth/logout). El shell redirige después a /instituto/login,
// que es el login DEDICADO del vertical — no el compartido.
export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
