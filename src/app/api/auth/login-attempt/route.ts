import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit, failbanGuard } from "@/lib/failban";

export const dynamic = "force-dynamic";

const SCOPE = "clinic-login"; // = SCOPE_LOGIN_CLINICA de @/lib/auth/login-servidor

/**
 * Consulta de bloqueo del login de clínica (solo `check`).
 *
 * Auditoría 30-sep (M4): el login ya es del servidor (POST /api/auth/login),
 * que cuenta él mismo los fallos y solo él limpia el bloqueo tras un acierto
 * real. Aquí se aceptaban `fail` y `success` SIN sesión: cinco `fail` con el
 * correo del dueño lo dejaban fuera 30 min y un `success` borraba el bloqueo
 * de cualquier cuenta. Esas dos fases ya no hacen nada (410): ni con sesión,
 * porque nadie legítimo las necesita. `check` sigue para quien lo llame
 * (responde 429 si la IP o la cuenta están bloqueadas, sin decir si existe).
 */
export async function POST(req: NextRequest) {
  // Anti-flood del endpoint (anti-spam del contador). Intencionalmente más alto
  // (30/60s) porque cada intento de login lo llama varias veces (check + fail/
  // success); sigue MUY por encima del lockout (5.º fallo), que corta primero.
  const limited = await persistentRateLimit(req, { limit: 30 });
  if (limited) return limited;

  let body: { phase?: unknown; email?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const phase = typeof body?.phase === "string" ? body.phase : "check";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const target = { scope: SCOPE, account: email || null };

  if (phase === "fail" || phase === "success") {
    // M4: retiradas. No cuentan ni limpian nada (ver arriba).
    return NextResponse.json({ error: "Fase retirada: el login se hace en /api/auth/login" }, { status: 410 });
  }

  // phase "check" (por defecto): 429 con Retry-After si está bloqueado.
  const locked = await failbanGuard(req, target);
  if (locked) return locked;
  return NextResponse.json({ ok: true });
}
