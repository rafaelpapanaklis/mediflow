import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { persistentRateLimit } from "@/lib/failban";
import { logError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(320) });

/**
 * Solicitud de recuperación de contraseña (login de clínica).
 *
 * Server-side a propósito (no supabase.auth.resetPasswordForEmail en el
 * browser) por dos razones:
 *  1. Rate limit propio (persistentRateLimit) ANTES de tocar Supabase.
 *  2. Respuesta SIEMPRE neutra — nunca revelamos si el email existe
 *     (anti-enumeración): cualquier resultado de Supabase responde ok:true.
 *
 * PKCE: usamos el client de @/lib/supabase/server (cookie-backed), así el
 * code_verifier queda como cookie en el navegador del solicitante y el
 * exchangeCodeForSession de /auth/confirm funciona con el template default
 * de Supabase ({{ .ConfirmationURL }} → redirect con ?code=).
 */
export async function POST(req: NextRequest) {
  // Anti-flood por IP. Más estricto que AUTH_FLOOD (cada hit puede disparar
  // un correo); Supabase además limita 1 correo/60s por dirección.
  const rlIp = await persistentRateLimit(req, { limit: 5, windowSec: 60 });
  if (rlIp) return rlIp;

  let email: string;
  try {
    const body = await req.json();
    email = schema.parse(body).email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  // Segunda ventana por CUENTA (independiente de la IP): frena que se
  // bombardee un mismo buzón desde IPs rotadas.
  const rlAcct = await persistentRateLimit(req, { id: `acct:${email}`, limit: 3, windowSec: 300 });
  if (rlAcct) return rlAcct;

  // El enlace del correo debe volver al MISMO origen que lo pidió (prod o
  // Preview de Vercel). Supabase solo redirige a URLs de su allowlist
  // (Authentication → URL Configuration), así que un Origin ajeno no llega
  // a ningún lado. Fallback: origen de la request.
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const redirectTo = `${origin}/auth/confirm?next=/reset-password`;

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    // Neutra a propósito: "user not found", rate limit de Supabase, etc.
    // responden igual que el éxito. Solo dejamos rastro en logs.
    if (error) logError("[auth/forgot-password] resetPasswordForEmail", error);
  } catch (err) {
    logError("[auth/forgot-password] unexpected", err);
  }

  return NextResponse.json({ ok: true });
}
