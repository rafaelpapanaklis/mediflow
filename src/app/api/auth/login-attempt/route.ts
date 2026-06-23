import { NextRequest, NextResponse } from "next/server";
import {
  persistentRateLimit,
  failbanGuard,
  recordAuthFailure,
  recordAuthSuccess,
} from "@/lib/failban";

export const dynamic = "force-dynamic";

const SCOPE = "clinic-login";

/**
 * Guard server-side para el login de clínica.
 *
 * El login de clínica es Supabase CLIENT-SIDE (signInWithPassword en el
 * navegador), así que NO hay un seam de servidor ANTES de validar credenciales.
 * Este endpoint es ese seam, llamado por el formulario:
 *   - phase "check"   → ANTES de signInWithPassword. 429 si IP/cuenta bloqueada.
 *   - phase "fail"    → tras un signInWithPassword fallido. Cuenta el fallo.
 *   - phase "success" → tras login OK. Resetea contadores (IP + cuenta).
 *
 * Es best-effort: el formulario hace FAIL-OPEN si este endpoint falla o no
 * responde 429 (nunca rompe un login legítimo). La protección dura vive aquí en
 * el servidor; un atacante podría saltarse el "check" del cliente, pero el
 * conteo de fallos sigue siendo server-side. Endurecer con captcha = otra ola.
 */
export async function POST(req: NextRequest) {
  // Throttle del propio endpoint (anti-spam del contador).
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

  if (phase === "fail") {
    await recordAuthFailure(req, target);
    return NextResponse.json({ ok: true });
  }

  if (phase === "success") {
    await recordAuthSuccess(req, target);
    return NextResponse.json({ ok: true });
  }

  // phase "check" (por defecto): 429 con Retry-After si está bloqueado.
  const locked = await failbanGuard(req, target);
  if (locked) return locked;
  return NextResponse.json({ ok: true });
}
