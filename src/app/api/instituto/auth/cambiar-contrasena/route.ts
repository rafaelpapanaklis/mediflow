import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEduContext } from "@/lib/edu-auth";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { rateLimitKey } from "@/lib/rate-limit";
import { eduAudit, eduAuditRequestMeta } from "@/lib/edu/auditoria";
import {
  EDU_TEMP_PASSWORD_CADUCADA,
  eduPasswordCheck,
  eduTempPasswordEstado,
} from "@/lib/edu/puerta-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/auth/cambiar-contrasena — la persona cambia SU
 * contraseña (P2-9). Es el único modo de levantar `mustChangePassword`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE Y NO SE LLAMA AL DEL DENTAL. /api/auth/change-password
 * se autentica con getAuthContext(), que exige una fila `User` de CLÍNICA:
 * un EduUser recibe 401. Lo que sí se copia de ahí es lo que costó
 * aprender: el criterio de fuerza, el tope de 72 (bcrypt), la comprobación
 * best-effort de "es la misma temporal" y el orden Auth PRIMERO / Prisma
 * después.
 *
 * 🔴 H-161 · LA REGLA VIVE EN UN SOLO SITIO Y LA PANTALLA LA DICE ENTERA.
 * La ayuda del formulario pedía «mayúsculas, minúsculas y números» y este
 * endpoint aceptaba `contrasenita`. El criterio NO se ha endurecido —es el
 * mismo del registro público del producto, y cambiarlo aquí dejaría al
 * instituto exigiendo una cosa y al resto de DaleControl otra—: lo que se
 * hizo es mudarlo a `eduPasswordCheck` (src/lib/edu/puerta-core.ts), que
 * es lo que AHORA usan los dos lados, con su texto de ayuda al lado. Dos
 * reglas parecidas escritas en dos sitios es exactamente cómo se llegó al
 * desfase.
 *
 * 🔴 H-153 · UNA TEMPORAL CADUCADA NO SE CANJEA. Éste es el candado de
 * verdad de la caducidad: con `mustChangePassword` encendida el panel ya
 * está cerrado por el layout y por eduApiGuard, así que convertirse en
 * definitiva es lo ÚNICO que una temporal puede hacer. Cerrado esto, una
 * temporal vieja no sirve para nada aunque alguien la adivine.
 *
 * 🔴 MULTI-TENANT: NADA sale del body salvo la contraseña. La cuenta que
 * se cambia es SIEMPRE la de la sesión (getEduContext) — este endpoint no
 * puede cambiarle la contraseña a nadie más.
 *
 * 🔴 La marca se levanta en TODAS las filas edu_users de ese supabaseId
 * (una por instituto): la contraseña es de la CUENTA, no del instituto. La
 * fila del dental no se toca — este vertical no escribe tablas del dental,
 * y si allá había un cambio forzado pendiente, allá se resuelve.
 *
 * La contraseña NO se registra en ningún sitio: ni la vieja, ni la nueva,
 * ni en consola.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(req: NextRequest) {
  const ctx = await getEduContext();
  if (!ctx) {
    return NextResponse.json({ error: "Tu sesión caducó. Vuelve a entrar." }, { status: 401 });
  }

  // ── 🔴 H-153 · LA TEMPORAL CADUCADA NO SE CANJEA ──────────────────────
  // Va ANTES del rate-limit y antes de leer el body: no es una cuestión de
  // qué mandó, es que la llave con la que llegó ya no vale. El mensaje dice
  // qué hacer (pedir otra), no qué falló.
  if (eduTempPasswordEstado(ctx.user, new Date()).caducada) {
    return NextResponse.json({ error: EDU_TEMP_PASSWORD_CADUCADA }, { status: 403 });
  }

  // Freno suave contra el bucle: cambiar una contraseña es un acto que una
  // persona hace una vez, no cinco por minuto.
  if (!rateLimitKey(`edu-cambiar-pass:${ctx.eduUserId}`, 5)) {
    return NextResponse.json(
      { error: "Demasiados intentos seguidos. Espera un minuto." },
      { status: 429 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        error:
          "Este servidor no está configurado para cambiar contraseñas. Avísale a quien administra DaleControl.",
      },
      { status: 500 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    /* body vacío: cae en la validación de abajo */
  }

  const password = typeof body.password === "string" ? body.password : "";

  // El MISMO criterio que el registro público del producto y que el cambio
  // del dental (mínimo 8 y puntaje >= 2), escrito UNA vez en puerta-core.ts
  // — y el mensaje que sale de aquí es palabra por palabra la ayuda que
  // pinta el formulario. H-161.
  const check = eduPasswordCheck(password);
  if (!check.ok) {
    return NextResponse.json({ error: check.motivo }, { status: 400 });
  }

  // ── ¿Es la misma temporal? ────────────────────────────────────────────
  // La temporal no se guarda en ningún lado (a propósito), así que la única
  // prueba fiable de "es la misma" es que AUTENTIQUE. Cliente desechable
  // (persistSession: false → no toca las cookies de la sesión abierta).
  // Best-effort: sin llave anon o con la red caída no se bloquea el cambio
  // — abajo queda la red del propio GoTrue, que rechaza la repetida.
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (ctx.user.email && anonKey) {
    try {
      const probe = createAdminClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: probeData } = await probe.auth.signInWithPassword({
        email: ctx.user.email,
        password,
      });
      if (probeData?.user) {
        try {
          await probe.auth.signOut();
        } catch {
          /* ignore */
        }
        return NextResponse.json(
          { error: "La contraseña nueva tiene que ser distinta de la que ya tienes." },
          { status: 400 },
        );
      }
    } catch {
      /* best-effort; sigue el camino normal */
    }
  }

  // ── Supabase PRIMERO ──────────────────────────────────────────────────
  // Auth es la fuente de verdad del login; Prisma solo guarda la marca. Si
  // Auth falla NO se toca Prisma: dejar mustChangePassword en false con la
  // contraseña vieja todavía viva sería exactamente el agujero que esto
  // viene a cerrar.
  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: updateError } = await admin.auth.admin.updateUserById(ctx.user.supabaseId, {
    password,
  });

  if (updateError) {
    const msg = updateError.message ?? "";
    if (/different from the old password/i.test(msg)) {
      return NextResponse.json(
        { error: "La contraseña nueva tiene que ser distinta de la que ya tienes." },
        { status: 400 },
      );
    }
    console.error("[instituto/auth] cambio de contraseña falló en Supabase:", msg);
    return NextResponse.json(
      { error: "No se pudo cambiar la contraseña. Intenta de nuevo." },
      { status: 500 },
    );
  }

  // Auth dijo OK → se levanta la exigencia en TODAS las filas edu de esta
  // cuenta (la contraseña es global a la cuenta, no del instituto).
  await prisma.eduUser.updateMany({
    where: { supabaseId: ctx.user.supabaseId },
    data: { mustChangePassword: false },
  });

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 S-3 / H-160 · Y SE CIERRAN LAS OTRAS SESIONES.
  //
  // El escenario es el que este panel tiene todos los días: se usa de pie
  // en el piso clínico y en equipo compartido. Quien pasaba por una sesión
  // abierta le cambiaba la contraseña a la cuenta —de TODO DaleControl con
  // ese correo, porque la cuenta de Auth es una sola—, el dueño se quedaba
  // fuera… y la sesión del que pasó por ahí seguía viva. Cambiar la
  // contraseña tiene que echar a todos MENOS a quien la cambió.
  //
  // `scope: "others"` es exactamente eso: revoca los refresh tokens de las
  // demás sesiones y deja viva la de esta petición. Con `"global"` se
  // echaría también a quien acaba de estrenarla —que además es el caso
  // normal: alguien canjeando su temporal— y volvería a la puerta sin saber
  // por qué. Best-effort: si GoTrue no contesta, la contraseña YA cambió y
  // negar un 200 aquí solo conseguiría que lo intentara otra vez.
  // ═══════════════════════════════════════════════════════════════════
  let otrasCerradas = true;
  try {
    const sesion = createClient();
    const { error: outError } = await sesion.auth.signOut({ scope: "others" });
    if (outError) {
      otrasCerradas = false;
      console.warn("[instituto/auth] no se pudieron cerrar las otras sesiones:", outError.message);
    }
  } catch (err) {
    otrasCerradas = false;
    console.warn("[instituto/auth] no se pudieron cerrar las otras sesiones:", err);
  }

  // 🔴 Y DEJA RENGLÓN. 179 líneas y cero llamadas a la bitácora, teniéndola
  // ya en esta ola y haciéndolo el dental. Sin él, la pregunta «¿quién le
  // cambió la contraseña a esta cuenta?» no tenía dónde contestarse.
  //
  // NO se guarda la contraseña, ni su longitud, ni una pista de ella: solo
  // el HECHO, con la IP y el navegador que pone `eduAuditRequestMeta`.
  await eduAudit(ctx, {
    action: "update",
    entity: "session",
    entityId: ctx.eduUserId,
    before: { contrasena: "la anterior" },
    after: {
      contrasena: "cambiada por la persona",
      // `aplica` de eduTempPasswordEstado es exactamente esta bandera; se
      // lee del contexto para no volver a calcular el estado entero.
      eraTemporal: Boolean(ctx.user.mustChangePassword),
      otrasSesionesCerradas: otrasCerradas,
    },
    ...eduAuditRequestMeta(req),
  });

  return NextResponse.json({ ok: true });
}
