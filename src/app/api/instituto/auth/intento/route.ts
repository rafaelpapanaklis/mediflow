import { NextRequest, NextResponse } from "next/server";
import {
  persistentRateLimit,
  failbanGuard,
  recordAuthFailure,
  recordAuthSuccess,
} from "@/lib/failban";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/auth/intento — el CONTADOR DE INTENTOS FALLIDOS del
 * login del instituto (H-153).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ ARREGLA. El login del vertical no contaba nada: ni por IP ni por
 * cuenta, sin bloqueo y sin CAPTCHA. Lo único que frenaba era el límite
 * genérico de GoTrue. Y las contraseñas que reparte este producto tienen
 * FORMA PÚBLICA Y CONOCIDA —`Edu-XXXX-XXXY`, unos 38 bits— porque el alta
 * las genera con un alfabeto de 32 letras sin caracteres ambiguos. Una
 * cuenta de aquí abre expedientes clínicos con nombre y apellido de
 * paciente: es el sitio del producto donde menos se puede dejar la puerta
 * girando libre.
 *
 * 🔴 POR QUÉ UN ENDPOINT Y NO UN `if` EN EL FORMULARIO. El login del
 * instituto autentica en el NAVEGADOR (supabase.auth.signInWithPassword),
 * así que no hay ningún punto de servidor ANTES de validar credenciales.
 * Éste es ese punto, y es EXACTAMENTE el mismo diseño que el login de
 * clínica (/api/auth/login-attempt): tres fases que llama el formulario.
 *
 *   · phase "check"   → ANTES de signInWithPassword. 429 si la IP o la
 *                       cuenta están bloqueadas.
 *   · phase "fail"    → tras un signInWithPassword fallido. Suma el fallo.
 *   · phase "success" → tras entrar. Borra contadores de IP y de cuenta.
 *
 * El contador de verdad vive en el SERVIDOR (`src/lib/failban.ts`, con
 * Upstash si está configurado y memoria si no): saltarse el "check" desde
 * la consola no salta el conteo, porque quien cuenta los fallos es este
 * endpoint y no el formulario. El formulario hace FAIL-OPEN —solo se
 * detiene ante un 429 explícito— para que un problema de infraestructura
 * nunca deje a una escuela sin poder entrar.
 *
 * 🔴 ESPACIO DE NOMBRES PROPIO: `instituto-login`. NO se reusa el
 * "clinic-login" del dental a propósito — compartirlo haría que los fallos
 * de una recepción dental bloquearan a un alumno del instituto que entra
 * desde la misma IP de la escuela, y al revés.
 *
 * 🔴 SIN eduApiGuard, y por eso está declarada en EDU_API_RUTAS_SIN_GUARD:
 * este endpoint corre ANTES de que exista sesión de instituto. Exigirla
 * sería exigir haber entrado para poder intentar entrar. No lee ni escribe
 * una sola fila del instituto: solo toca contadores de fallos.
 *
 * 🔴 NO CONFIRMA NI DESMIENTE QUE UNA CUENTA EXISTA. Contesta `{ok:true}`
 * o un 429 genérico, siempre igual. Un endpoint que dijera "esa cuenta no
 * existe" sería un enumerador de correos del instituto.
 * ═══════════════════════════════════════════════════════════════════════
 */

const SCOPE = "instituto-login";

export async function POST(req: NextRequest) {
  // Anti-flood del propio contador (anti-spam del conteo). 30/60 s y no 15
  // porque cada intento de login llama a este endpoint DOS veces (check +
  // fail/success); sigue muy por encima del umbral del lockout (5.º fallo),
  // que es el que tiene que cortar primero.
  const limited = await persistentRateLimit(req, { limit: 30, scope: SCOPE });
  if (limited) return limited;

  let body: { phase?: unknown; email?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const phase = typeof body?.phase === "string" ? body.phase : "check";
  // El correo se normaliza igual que en todo el vertical (minúsculas,
  // recortado): si no, "Ana@x.mx" y "ana@x.mx" contarían como dos cuentas
  // distintas y el bloqueo por cuenta se esquivaría con una mayúscula.
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

  // "check" por defecto: 429 con Retry-After si está bloqueado.
  const locked = await failbanGuard(req, target);
  if (locked) return locked;
  return NextResponse.json({ ok: true });
}
