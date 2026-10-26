import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { persistentRateLimit } from "@/lib/failban";
import { logError } from "@/lib/safe-log";
import { MENSAJE_CLAVE_NUEVA, minutosHasta, puedeGestionarClave, validarClaveNueva } from "@/lib/sede-clave/core";
import { activarClave, cambiarClave, estadoFresco, quitarClave, tablaExiste } from "@/lib/sede-clave/estado.server";
import { ponerDesbloqueo, quitarDesbloqueo } from "@/lib/sede-clave/gate.server";
import { bitacoraClave, hashClave, verificarClave, type Verificacion } from "@/lib/sede-clave/servicio.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * «Clave de la sede» (ws1-t4) — Configuración → Seguridad.
 *
 *   GET  → { disponible, puedeGestionar, activa }   (nunca la clave ni su hash)
 *   POST → { accion: "activar", clave, confirmacion }
 *          { accion: "cambiar", claveActual, clave, confirmacion }
 *          { accion: "desactivar", claveActual }
 *
 * Solo el SUPER_ADMIN y el ADMIN con el permiso «sede.clave» (puedeGestionarClave).
 * La sede es SIEMPRE la activa de la sesión (getAuthContext): ningún id de
 * clínica viaja en la petición, así que otra clínica no puede tocar esta clave.
 * Como getAuthContext ya corta en una sede con clave sin desbloqueo, quien llega
 * aquí con la clave activa es porque la tecleó en este navegador.
 *
 * Activar y cambiar dejan desbloqueado al que lo hizo (acaba de escribirla);
 * cambiar, desactivar y restablecer suben la versión y caducan todos los demás
 * desbloqueos.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const puedeGestionar = puedeGestionarClave(ctx.user);
  if (!puedeGestionar) return NextResponse.json({ disponible: false, puedeGestionar: false, activa: false });
  try {
    if (!(await tablaExiste(true))) return NextResponse.json({ disponible: false, puedeGestionar, activa: false });
    const estado = await estadoFresco(ctx.clinicId);
    return NextResponse.json({ disponible: true, puedeGestionar, activa: estado.activa });
  } catch (err) {
    logError("[api/sede-clave GET]", err);
    return NextResponse.json({ error: "No se pudo leer la clave de la sede" }, { status: 500 });
  }
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** La respuesta de una clave actual que no pasó. */
function rechazoDeVerificacion(v: Verificacion): NextResponse {
  if (v.ok) throw new Error("rechazoDeVerificacion con ok");
  if (v.motivo === "sin_clave") {
    return NextResponse.json({ error: "Esta sede no tiene clave.", code: "sin_clave" }, { status: 409 });
  }
  if (v.motivo === "en_curso") {
    return NextResponse.json({ error: "Ya hay un intento en curso con esta clave. Espera un momento y vuelve a intentarlo.", code: "en_curso" }, { status: 429 });
  }
  if (v.motivo === "bloqueado") {
    const min = minutosHasta(v.intentos.bloqueadoHasta ?? Date.now());
    return NextResponse.json(
      { error: `Demasiados intentos con la clave. Espera ${min} min y vuelve a intentarlo.`, code: "bloqueo", minutos: min },
      { status: 429 },
    );
  }
  if (v.intentos.bloqueadoHasta !== null) {
    const min = minutosHasta(v.intentos.bloqueadoHasta);
    return NextResponse.json(
      { error: `La clave no es correcta. Por seguridad no podrás intentarlo en ${min} min.`, code: "bloqueo", minutos: min },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { error: "La clave actual no es correcta.", code: "clave_incorrecta", restantes: v.intentos.restantes },
    { status: 403 },
  );
}

export async function POST(req: NextRequest) {
  const rl = await persistentRateLimit(req, { limit: 10, windowSec: 60 });
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!puedeGestionarClave(ctx.user)) {
    return NextResponse.json(
      { error: "Solo el dueño o un administrador con el permiso «Crear y cambiar la clave de la sede» puede hacerlo.", code: "sin_permiso", permiso: "sede.clave" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const accion = texto(body?.accion);
  if (accion !== "activar" && accion !== "cambiar" && accion !== "desactivar") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const clinicId = ctx.clinicId;
  const supabaseId: string = ctx.user.supabaseId;
  if (!clinicId || !supabaseId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const por = `user:${ctx.userId}`;

  try {
    if (!(await tablaExiste(true))) {
      return NextResponse.json({ error: "La clave de la sede todavía no está disponible.", code: "sin_sql" }, { status: 409 });
    }

    if (accion === "activar") {
      const v = validarClaveNueva(body?.clave, body?.confirmacion);
      if (!v.ok) return NextResponse.json({ error: MENSAJE_CLAVE_NUEVA[v.error], code: v.error }, { status: 400 });
      const version = await activarClave(clinicId, await hashClave(body.clave), por);
      if (version === null) {
        return NextResponse.json({ error: "Esta sede ya tiene clave. Para cambiarla escribe la actual.", code: "ya_activa" }, { status: 409 });
      }
      await bitacoraClave({ req, clinicId, userId: ctx.userId, evento: "activar", activaAntes: false, activaDespues: true, version });
      const res = NextResponse.json({ ok: true, activa: true });
      ponerDesbloqueo(res, supabaseId, clinicId, version);
      return res;
    }

    // cambiar / desactivar: primero que la clave nueva sea válida (no gasta un
    // intento), después la actual.
    if (accion === "cambiar") {
      const v = validarClaveNueva(body?.clave, body?.confirmacion);
      if (!v.ok) return NextResponse.json({ error: MENSAJE_CLAVE_NUEVA[v.error], code: v.error }, { status: 400 });
    }

    const verif = await verificarClave({ clinicId, supabaseId, clave: body?.claveActual });
    if (!verif.ok) {
      if (verif.motivo === "incorrecta") {
        await bitacoraClave({ req, clinicId, userId: ctx.userId, evento: "intento_fallido", activaAntes: true, activaDespues: true, version: verif.version });
        if (verif.intentos.bloqueadoHasta !== null) {
          await bitacoraClave({ req, clinicId, userId: ctx.userId, evento: "bloqueo", activaAntes: true, activaDespues: true, version: verif.version });
        }
      }
      return rechazoDeVerificacion(verif);
    }

    if (accion === "cambiar") {
      const version = await cambiarClave(clinicId, await hashClave(body.clave), verif.version, por);
      if (version === null) {
        return NextResponse.json({ error: "La clave cambió mientras tanto. Recarga la página.", code: "cambio_concurrente" }, { status: 409 });
      }
      await bitacoraClave({ req, clinicId, userId: ctx.userId, evento: "cambiar", activaAntes: true, activaDespues: true, version });
      const res = NextResponse.json({ ok: true, activa: true });
      ponerDesbloqueo(res, supabaseId, clinicId, version);
      return res;
    }

    const version = await quitarClave(clinicId, por, verif.version);
    if (version === null) {
      return NextResponse.json({ error: "La clave cambió mientras tanto. Recarga la página.", code: "cambio_concurrente" }, { status: 409 });
    }
    await bitacoraClave({ req, clinicId, userId: ctx.userId, evento: "desactivar", activaAntes: true, activaDespues: false, version });
    const res = NextResponse.json({ ok: true, activa: false });
    quitarDesbloqueo(res, supabaseId, clinicId);
    return res;
  } catch (err) {
    // Sin el cuerpo: lleva la clave.
    logError("[api/sede-clave POST]", err);
    return NextResponse.json({ error: "No se pudo guardar la clave de la sede" }, { status: 500 });
  }
}
