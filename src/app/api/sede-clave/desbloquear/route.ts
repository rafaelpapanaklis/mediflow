import { NextRequest, NextResponse } from "next/server";
import { getAuthContextParaClaveDeSede } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { logError } from "@/lib/safe-log";
import { writeActiveClinicCookie } from "@/lib/active-clinic";
import { applyTwoFactorLoginCookies } from "@/lib/auth/two-factor-cookie";
import { destinoSeguro, minutosHasta } from "@/lib/sede-clave/core";
import { tablaExiste } from "@/lib/sede-clave/estado.server";
import { ponerDesbloqueo } from "@/lib/sede-clave/gate.server";
import { bitacoraClave, verificarClave } from "@/lib/sede-clave/servicio.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/sede-clave/desbloquear — la pantalla «Esta sede tiene clave» (ws1-t4).
 *
 * Body: { clave, clinicId?, next?, cambiarDeSede? }
 *   · sin `clinicId` (o el de la sede activa): desbloquea la sede activa, la que
 *     el layout mandó a esta pantalla tras el login o al caducar las 72 h;
 *   · con el `clinicId` de OTRA sede: es el selector de sedes. Se coteja contra
 *     las fichas ACTIVAS de esta persona (mismo criterio que /api/switch-clinic)
 *     y, si la clave es buena, además se cambia la sede activa — salvo
 *     `cambiarDeSede: false` (v2: el candado del Reporte de sedes desbloquea la
 *     sede para verla en el reporte sin sacar al dueño de la sede en la que está).
 *
 * Usa getAuthContextParaClaveDeSede: con el 2FA pasado, pero sin el gate de la
 * clave (si no, nadie desbloquearía nunca) ni el del plan (una sede con clave y
 * el plan vencido tiene que poder llegar a la pantalla de pago).
 *
 * 5 claves mal en 15 min para esta persona+sede → 15 min sin poder intentar.
 * Cada fallo, el bloqueo y cada desbloqueo quedan en la bitácora de esa sede.
 */
export async function POST(req: NextRequest) {
  const rl = await persistentRateLimit(req, { limit: 20, windowSec: 60 });
  if (rl) return rl;

  const ctx = await getAuthContextParaClaveDeSede();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const supabaseId: string = ctx.user.supabaseId;
  if (!supabaseId || !ctx.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const pedido = typeof body?.clinicId === "string" && body.clinicId.trim() ? body.clinicId.trim() : null;
  const destino = destinoSeguro(body?.next);

  try {
    // La sede: la activa, o una hermana donde esta persona tiene ficha activa.
    let ficha: { id: string; clinicId: string } = { id: ctx.userId, clinicId: ctx.clinicId };
    if (pedido && pedido !== ctx.clinicId) {
      const otra = await prisma.user.findFirst({
        where: { supabaseId, clinicId: pedido, isActive: true, clinic: { archivedAt: null } },
        select: { id: true, clinicId: true },
      });
      if (!otra) return NextResponse.json({ error: "No tienes acceso a esa sede." }, { status: 403 });
      ficha = otra;
    }
    const cambiaDeSede = ficha.clinicId !== ctx.clinicId && body?.cambiarDeSede !== false;

    const responderOk = async (version: number | null) => {
      const res = NextResponse.json({ ok: true, destino });
      if (version !== null) ponerDesbloqueo(res, supabaseId, ficha.clinicId, version);
      if (cambiaDeSede) {
        writeActiveClinicCookie(res, ficha.clinicId);
        await applyTwoFactorLoginCookies(res, supabaseId, ficha.clinicId);
      }
      return res;
    };

    // Sin el SQL no hay claves: nada que desbloquear.
    if (!(await tablaExiste(true))) return responderOk(null);

    const verif = await verificarClave({ clinicId: ficha.clinicId, supabaseId, clave: body?.clave });
    if (verif.ok) {
      await bitacoraClave({ req, clinicId: ficha.clinicId, userId: ficha.id, evento: "desbloqueo", activaAntes: true, activaDespues: true, version: verif.version });
      return responderOk(verif.version);
    }
    // La quitaron mientras la pantalla estaba abierta: ya se puede entrar.
    if (verif.motivo === "sin_clave") return responderOk(null);
    if (verif.motivo === "en_curso") return NextResponse.json({ error: "Ya hay un intento en curso con esta clave. Espera un momento y vuelve a intentarlo.", code: "en_curso" }, { status: 429 });

    if (verif.motivo === "bloqueado") {
      const min = minutosHasta(verif.intentos.bloqueadoHasta ?? Date.now());
      return NextResponse.json(
        { error: `Demasiados intentos. Espera ${min} min y vuelve a intentarlo.`, code: "bloqueo", minutos: min },
        { status: 429 },
      );
    }

    await bitacoraClave({ req, clinicId: ficha.clinicId, userId: ficha.id, evento: "intento_fallido", activaAntes: true, activaDespues: true, version: verif.version });
    if (verif.intentos.bloqueadoHasta !== null) {
      await bitacoraClave({ req, clinicId: ficha.clinicId, userId: ficha.id, evento: "bloqueo", activaAntes: true, activaDespues: true, version: verif.version });
      const min = minutosHasta(verif.intentos.bloqueadoHasta);
      return NextResponse.json(
        { error: `La clave no es correcta. Por seguridad no podrás intentarlo en ${min} min.`, code: "bloqueo", minutos: min },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "La clave no es correcta.", code: "clave_incorrecta", restantes: verif.intentos.restantes },
      { status: 403 },
    );
  } catch (err) {
    // Sin el cuerpo: lleva la clave.
    logError("[api/sede-clave/desbloquear POST]", err);
    return NextResponse.json({ error: "No se pudo comprobar la clave" }, { status: 500 });
  }
}
