import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  failbanGuard,
  persistentRateLimit,
  recordAuthFailure,
  recordAuthSuccess,
} from "@/lib/failban";
import {
  MENSAJE_BLOQUEO,
  MENSAJE_CREDENCIALES,
  MENSAJE_INVALIDO,
  SCOPE_LOGIN_CLINICA,
  leerEntradaLogin,
  mismoOrigen,
} from "@/lib/auth/login-servidor";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login { email, password } — login de clínica en el servidor
 * (auditoría 30-sep, M4). Ver @/lib/auth/login-servidor.
 *
 * Orden: origen → anti-flood por IP → bloqueo persistente (IP + cuenta) →
 * Supabase. Con éxito, las cookies de sesión las escribe el cliente SSR de
 * Supabase en ESTA respuesta; el formulario sigue llamando después a
 * /api/auth/post-login (clínica activa y cookies del 2FA, sin cambios: lo de
 * ws1-t8 queda intacto).
 *
 * Google OAuth, recuperar contraseña y «Ver como clínica» no pasan por aquí.
 */
export async function POST(req: NextRequest) {
  if (!mismoOrigen(req.headers)) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  // Anti-flood del endpoint por IP. El freno de fuerza bruta es el bloqueo de
  // abajo (5 fallos → 1 min, con backoff hasta 30 min).
  const flood = await persistentRateLimit(req, { limit: 20, windowSec: 60 });
  if (flood) return flood;

  const entrada = leerEntradaLogin(await req.json().catch(() => null));
  if (!entrada.ok) return NextResponse.json({ error: MENSAJE_INVALIDO }, { status: 400 });

  const target = { scope: SCOPE_LOGIN_CLINICA, account: entrada.email };

  // El bloqueo aplica igual exista o no la cuenta: no revela nada.
  const bloqueado = await failbanGuard(req, target);
  if (bloqueado) {
    return NextResponse.json(
      { error: MENSAJE_BLOQUEO },
      { status: 429, headers: { "Retry-After": bloqueado.headers.get("Retry-After") ?? "60" } },
    );
  }

  const supabase = createClient();
  // Sesión previa fuera: evita mezclar cuentas en el mismo navegador (lo hacía el formulario).
  try { await supabase.auth.signOut(); } catch { /* sin sesión previa */ }

  let fallo = true;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: entrada.email,
      password: entrada.password,
    });
    fallo = !!error || !data?.session;
  } catch (e) {
    console.error("[login] signInWithPassword lanzó:", e instanceof Error ? e.message : e);
    fallo = true;
  }

  if (fallo) {
    await recordAuthFailure(req, target);
    // Mismo texto para cuenta inexistente, contraseña mala, correo sin confirmar…
    return NextResponse.json({ error: MENSAJE_CREDENCIALES }, { status: 401 });
  }

  await recordAuthSuccess(req, target);
  return NextResponse.json({ ok: true });
}
