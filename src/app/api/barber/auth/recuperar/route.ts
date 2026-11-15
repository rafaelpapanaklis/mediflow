import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { persistentRateLimit } from "@/lib/failban";
import { logError } from "@/lib/safe-log";
import { origenParaEnlaceDeAuth } from "@/lib/auth/origen-de-enlaces";
import { BARBER_RECOVERY_CONFIRM_PATH } from "@/lib/barber/contrasena";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(320) });

/**
 * El freno es EL MISMO del dental, no uno parecido: misma llave (la ruta de
 * allá) y mismos topes. Con una llave propia, quien quisiera bombardear un
 * buzón tendría el doble de intentos usando las dos puertas.
 */
const SCOPE_DEL_DENTAL = "/api/auth/forgot-password";

/**
 * POST /api/barber/auth/recuperar — pedir el enlace para restablecer la
 * contraseña desde /barber/recuperar.
 *
 * Copia de /api/auth/forgot-password (que no se toca) con UNA diferencia: el
 * enlace del correo regresa a Barber (BARBER_RECOVERY_CONFIRM_PATH) y no a
 * /reset-password. Todo lo demás es igual:
 *  · misma llamada: supabase.auth.resetPasswordForEmail con el cliente de
 *    cookies (PKCE: el verificador queda en este navegador);
 *  · mismos frenos: 5/min por IP y 3 cada 5 min por cuenta, ANTES de Supabase;
 *  · respuesta SIEMPRE neutra: exista o no el correo, sale { ok: true };
 *  · el origen del enlace sale de la lista fija del servidor, nunca del
 *    header Origin (auditoría nº6).
 */
export async function POST(req: NextRequest) {
  const rlIp = await persistentRateLimit(req, { scope: SCOPE_DEL_DENTAL, limit: 5, windowSec: 60 });
  if (rlIp) return rlIp;

  let email: string;
  try {
    const body = await req.json();
    email = schema.parse(body).email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  }

  const rlAcct = await persistentRateLimit(req, {
    id: `acct:${email}`,
    scope: SCOPE_DEL_DENTAL,
    limit: 3,
    windowSec: 300,
  });
  if (rlAcct) return rlAcct;

  const origin = origenParaEnlaceDeAuth(req.headers.get("origin"));
  const redirectTo = `${origin}${BARBER_RECOVERY_CONFIRM_PATH}`;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    // Neutra a propósito: «no existe», el tope de Supabase, etc. responden
    // igual que el éxito. Solo queda el rastro en el log.
    if (error) logError("[barber/auth/recuperar] resetPasswordForEmail", error);
  } catch (err) {
    logError("[barber/auth/recuperar] unexpected", err);
  }

  return NextResponse.json({ ok: true });
}
