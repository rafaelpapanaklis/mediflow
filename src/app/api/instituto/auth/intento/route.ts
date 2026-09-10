import { NextRequest, NextResponse } from "next/server";
import {
  persistentRateLimit,
  failbanGuard,
  recordAuthFailure,
  recordAuthSuccess,
} from "@/lib/failban";
import { createClient } from "@/lib/supabase/server";
import { EDU_LOGIN_MENSAJES } from "@/lib/edu/puerta-core";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/auth/intento — EL INTENTO DE ENTRADA del instituto,
 * con su contador de fallos (H-153 · S-2).
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
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 S-2 · POR QUÉ ESTE ENDPOINT HACE EL INTENTO, Y NO SOLO LO CUENTA.
 *
 * Hasta esta ola el formulario autenticaba en el NAVEGADOR y luego venía a
 * contarlo aquí, en tres fases (`check` / `fail` / `success`) que el cuerpo
 * de la petición DECLARABA. Nada probaba que ese intento hubiera ocurrido, y
 * con eso se hacían dos cosas desde internet y sin sesión:
 *
 *   · **bloquear a cualquiera**: cinco `{"phase":"fail","email":"direccion@…"}`
 *     y la directora leía «Demasiados intentos fallidos» sin haber intentado
 *     entrar, renovable indefinidamente por debajo del anti-flood;
 *   · **desbloquearse uno mismo**: `{"phase":"success"}` borraba contador y
 *     cerradura —de la IP y de la cuenta—, así que una fuerza bruta con un
 *     `success` cada cuatro fallos dejaba el contador clavado en cero. El
 *     candado no cerraba nunca.
 *
 * La forma correcta es que el conteo lo decida quien VE el resultado, así
 * que el intento se hace AQUÍ: el formulario manda correo y contraseña, este
 * endpoint llama a `signInWithPassword` en el servidor y registra el fallo o
 * el éxito según lo que contestó GoTrue. `phase` y `email` dejan de existir
 * como entrada. Nadie puede ya declarar un éxito que no tuvo, y por lo tanto
 * nadie se desbloquea sin la contraseña.
 *
 * ⚠️ Lo que esto NO arregla, dicho sin adornos: quien golpee DIRECTAMENTE la
 * API de GoTrue (`POST /auth/v1/token?grant_type=password`) sigue sin pasar
 * por aquí y sus fallos no se cuentan. Eso no se cierra con código de este
 * repo — se cierra apagando el `grant_type=password` público o poniendo el
 * proyecto detrás de un límite propio, que es un clic en Supabase. Va en el
 * reporte.
 *
 * ⚠️ Y sí: un tercero todavía puede sumar fallos a una cuenta ajena mandando
 * contraseñas equivocadas, porque eso es lo que hace cualquier login del
 * mundo. La diferencia es que ahora cuesta un intento REAL —el mismo que
 * cuenta el candado— y no una línea de JSON, y sobre todo que ya no existe
 * la salida de emergencia que lo volvía inofensivo para quien atacaba.
 *
 * 🔴 LA SESIÓN LA ESCRIBE ESTE ENDPOINT. `createClient()` de
 * `@/lib/supabase/server` monta el cliente SSR sobre las cookies de la
 * petición, así que un `signInWithPassword` de aquí deja la cookie
 * `sb-…-auth-token` puesta en la RESPUESTA, exactamente igual que la dejaba
 * el navegador. Por eso el formulario puede seguir con
 * `GET /api/instituto/auth/session` sin tocar GoTrue en ningún momento.
 *
 * 🔴 ESPACIO DE NOMBRES PROPIO: `instituto-login`. NO se reusa el
 * "clinic-login" del dental a propósito — compartirlo haría que los fallos
 * de una recepción dental bloquearan a un alumno del instituto que entra
 * desde la misma IP de la escuela, y al revés.
 *
 * 🔴 SIN eduApiGuard, y por eso está declarada en EDU_API_RUTAS_SIN_GUARD:
 * este endpoint corre ANTES de que exista sesión de instituto. Exigirla
 * sería exigir haber entrado para poder intentar entrar.
 *
 * 🔴 NO CONFIRMA NI DESMIENTE QUE UNA CUENTA EXISTA. Un correo que no está,
 * uno que está con otra contraseña y uno de otro producto devuelven los tres
 * el MISMO 401 con el mismo texto. Quién es de un instituto lo contesta
 * `auth/session`, y solo a quien ya autenticó con esa cuenta.
 * ═══════════════════════════════════════════════════════════════════════
 */

const SCOPE = "instituto-login";

/** Correo o contraseña incorrectos: el ÚNICO texto que sale de aquí cuando
 *  no se entra. Da igual cuál de las dos cosas falló y da igual si la cuenta
 *  existe. */
function noEntra(status: number) {
  return NextResponse.json(
    { ok: false, motivo: "credenciales", error: EDU_LOGIN_MENSAJES.credenciales },
    { status },
  );
}

export async function POST(req: NextRequest) {
  // Anti-flood del endpoint. 30/60 s deja sitio de sobra a una escuela
  // entrando a la vez desde su única IP y sigue muy por encima del umbral
  // del lockout (5.º fallo), que es el que tiene que cortar primero.
  const limited = await persistentRateLimit(req, { limit: 30, scope: SCOPE });
  if (limited) return limited;

  let body: { email?: unknown; password?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // El correo se normaliza igual que en todo el vertical (minúsculas,
  // recortado): si no, "Ana@x.mx" y "ana@x.mx" contarían como dos cuentas
  // distintas y el bloqueo por cuenta se esquivaría con una mayúscula.
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const target = { scope: SCOPE, account: email || null };

  // ── 1 · ¿esta IP o esta cuenta están bloqueadas? ────────────────────
  // El candado se mira ANTES de tocar GoTrue: un bloqueo que igualmente
  // consulta al proveedor no es un bloqueo, es un retraso.
  //
  // ⚠️ FAIL-OPEN, y es deliberado: si el contador (Upstash) no contesta, se
  // deja pasar y se sigue al intento. Un problema de infraestructura no
  // puede dejar a una escuela entera en la puerta. Lo que NO es fail-open es
  // el intento en sí: sin credenciales buenas no se entra pase lo que pase.
  try {
    const locked = await failbanGuard(req, target);
    if (locked) return locked;
  } catch (err) {
    console.warn("[instituto/auth] el contador de intentos no contestó:", err);
  }

  // Sin los dos campos no hubo intento que contar: no se suma fallo (si no,
  // un cuerpo vacío repetido bloquearía a un tercero, que es justo lo que
  // esto viene a cerrar) y no se dice cuál de los dos falta.
  if (!email || !password) return noEntra(400);

  // ── 2 · EL INTENTO, aquí y no en el navegador ───────────────────────
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    try {
      await recordAuthFailure(req, target);
    } catch (err) {
      console.warn("[instituto/auth] no se pudo anotar el fallo:", err);
    }
    return noEntra(401);
  }

  // ── 3 · Entró. Se borran los contadores de esta IP y esta cuenta ────
  // Se hace aunque la cuenta resulte no ser de ningún instituto: la
  // contraseña era correcta, así que esto no es un ataque de fuerza bruta.
  // Quién es de aquí lo decide `auth/session`, que es quien lee la sesión
  // que este endpoint acaba de dejar en la cookie.
  try {
    await recordAuthSuccess(req, target);
  } catch (err) {
    console.warn("[instituto/auth] no se pudieron limpiar los contadores:", err);
  }

  return NextResponse.json({ ok: true });
}
