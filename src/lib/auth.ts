import { cache } from "react";
import { authDebug } from "@/lib/auth/debug-log";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { estadoSuplantacionDe } from "@/lib/admin/suplantacion";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { readActiveClinicCookie, logClinicFallback } from "@/lib/active-clinic";
import { resolverSesion } from "@/lib/auth/sesion-en-cache";
import { isPlanExpired, isApiPathBlockedForExpiredPlan } from "@/lib/plan-status";
import { decidirDosPasos } from "@/lib/auth/two-factor-decision";
import { bloqueaDosPasos } from "@/lib/auth/two-factor-gate";
import {
  TWO_FA_CHALLENGE_PATH,
  TWO_FA_SETUP_PATH,
  TWO_FA_ROUTE_PREFIX,
} from "@/lib/auth/two-factor-constants";

// getSession/getCurrentUser/getUserClinics van memoizadas por request con
// React cache(): layout, page y route handlers invocados in-process dentro
// del mismo render comparten UNA ejecución de cada una (antes cada
// navegación pagaba 3-4 supabase.auth.getUser() + sus queries duplicadas).
export const getSession = cache(async () => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // M5 (auditoría 30-sep): una sesión de «Ver como clínica» vencida (2 h) o
  // cerrada vale como SIN sesión, aunque el navegador conserve las cookies.
  if (user && (await estadoSuplantacionDe(supabase)).tipo === "terminada") return null;
  return user;
});

export async function requireAuth() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

// Garantiza que el user devuelto siempre tenga permissionsOverride como
// string[]. Defensivo contra un escenario de deploy donde Prisma client
// quedó cacheado de una build vieja sin el campo — en ese caso la query
// devuelve `undefined` y el sidebar caía al default del rol ignorando el
// override que sí está en DB. Con este normalizer el caller puede asumir
// que el array siempre existe.
function normalizeUser<T extends { permissionsOverride?: string[] | null } & object>(u: T): T & { permissionsOverride: string[] } {
  return { ...u, permissionsOverride: (u.permissionsOverride as string[] | null | undefined) ?? [] };
}

/**
 * EQ-02 — corrige `totpEnabled` al nivel de la PERSONA.
 *
 * Una persona tiene una fila `User` por clínica y el 2FA vivía en esa fila, así
 * que el dueño que lo enroló en su sede principal entraba a la segunda sin que
 * nadie le pidiera el código. Se corrige aquí, en el resolver, y no en cada
 * sitio que lo lee: el layout de /dashboard, las pantallas del reto y del
 * enrolamiento y las ~30 rutas de agenda que entran por loadClinicSession leen
 * `user.totpEnabled` y todas reciben ya el valor bueno.
 *
 * Si la fila activa ya lo tiene puesto no se mira nada más. Las hermanas
 * llegan ya leídas desde getCurrentUser (ws1-t1): antes eran otra consulta.
 */
function conDosFactoresDeLaPersona<T extends { supabaseId: string; totpEnabled?: boolean | null }>(
  u: T,
  filasDeLaPersona: ReadonlyArray<{ totpEnabled?: boolean | null }>,
): T {
  if (u.totpEnabled) return u;
  // Las filas ya vienen leídas (todas las activas de este supabaseId): es la
  // misma pregunta que hacía personaTieneDosFactores, sin otra consulta.
  return filasDeLaPersona.some((f) => !!f.totpEnabled) ? { ...u, totpEnabled: true } : u;
}

// Gate de 2FA de getCurrentUser — el SEGUNDO camino además de getAuthContext,
// y no es un camino menor: por aquí entran el layout y las páginas de
// /dashboard, las ~30 rutas de agenda, citas, lista de espera y
// /api/dashboard/home (vía loadClinicSession) y las server actions que lo usan.
//
// ws1-t8 · M1: antes solo cortaba en /api (por el x-pathname); en páginas y
// server actions no hacía nada y confiaba en el layout, que no se re-ejecuta en
// la navegación suave ni corre en una server action. Ahora corta SIEMPRE que la
// decisión bloquee. getCurrentUser no puede devolver null (redirige por
// contrato), así que se corta con redirect al reto o al enrolamiento: el
// handler, la action o la página no llegan a correr, que es lo que importa.
//
// La única salida es getCurrentUserSinDosPasos, que usan el layout (decide él,
// con la ruta) y las pantallas del propio flujo del 2FA.
function enforceTwoFactorGate(user: {
  supabaseId: string;
  clinicId: string;
  role?: string | null;
  totpEnabled?: boolean | null;
  clinic?: { require2fa?: boolean | null } | null;
}): void {
  const { decision } = decidirDosPasos(user);
  if (!bloqueaDosPasos(decision)) return;
  if (decision === "setup") redirect(TWO_FA_SETUP_PATH);
  const pathname = (() => {
    try { return headers().get("x-pathname"); } catch { return null; }
  })();
  // `next` solo para volver a una pantalla del panel tras el reto (el reto ya
  // filtra lo que no empiece por /dashboard); en /api no hay a dónde volver.
  const volver =
    pathname && pathname.startsWith("/dashboard") && !pathname.startsWith(TWO_FA_ROUTE_PREFIX)
      ? `?next=${encodeURIComponent(pathname)}`
      : "";
  redirect(`${TWO_FA_CHALLENGE_PATH}${volver}`);
}

// Gate de plan vencido para los route handlers que autentican vía
// getCurrentUser (segundo camino además de getAuthContext). Si el plan venció
// y la request va a una ruta /api NO exenta (allowlist de pago/auth), cortamos
// con redirect a /dashboard/suspended — getCurrentUser no puede devolver null,
// pero el redirect impide que el handler corra y el dato salga. Sólo dispara
// en /api: las páginas server (pathname /dashboard/*) las cubre el layout, y
// para callers sin x-pathname es no-op. Mismo criterio que getAuthContext.
function enforceApiPlanGate(clinic: unknown): void {
  if (!isPlanExpired(clinic as { trialEndsAt?: Date | string | null; subscriptionStatus?: string | null } | null)) return;
  const pathname = (() => {
    try { return headers().get("x-pathname"); } catch { return null; }
  })();
  if (isApiPathBlockedForExpiredPlan(pathname)) redirect("/dashboard/suspended");
}

/**
 * getCurrentUser con TODOS sus gates: 2FA (siempre) y plan vencido (en /api).
 * Es la que usa todo el mundo.
 */
export const getCurrentUser = cache(async () => {
  const user = await resolverUsuarioActual();
  // ORDEN: 2FA antes que plan. El 2FA es autenticación; el plan, comercial.
  enforceTwoFactorGate(user);
  enforceApiPlanGate(user.clinic);
  return user;
});

/**
 * ⚠ SIN el gate de 2FA. Solo para quien tiene que funcionar con el segundo
 * factor pendiente y decide por su cuenta: el layout de /dashboard (que sabe en
 * qué ruta está y manda al reto, al enrolamiento o al aviso) y las pantallas
 * /dashboard/2fa*. La lista de quién la usa la fija
 * src/lib/auth/__tests__/dos-pasos-en-toda-sesion.test.ts: añadir un caller
 * nuevo obliga a ir allí a justificarlo.
 */
export const getCurrentUserSinDosPasos = cache(async () => resolverUsuarioActual());

// La resolución de la persona y su clínica activa, sin gates. Cacheada por
// petición: getCurrentUser y getCurrentUserSinDosPasos en el mismo render
// comparten UNA lectura.
const resolverUsuarioActual = cache(async () => {
  const supabaseUser = await requireAuth();
  const activeClinicId = readActiveClinicCookie();

  // UNA lectura: todas las filas ACTIVAS de la persona, de la más antigua a la
  // más nueva (ws1-t1). Antes eran la de la cookie, después —si fallaba— esta
  // misma lista, y encima la pregunta de 2FA por las hermanas: hasta tres
  // viajes seguidos a la base en cada ruta que entra por aquí. Mismo criterio
  // que getAuthContext (@/lib/auth-context), y la misma caché de 10 s en las
  // lecturas de /api, con llave persona + clínica de la cookie
  // (@/lib/auth/sesion-en-cache). Los gates siguen corriendo en cada petición.
  const { filas: candidates, deLaCookie } = await resolverSesion(supabaseUser.id, activeClinicId);

  if (activeClinicId) {
    const user = deLaCookie;
    if (user) {
      return normalizeUser(conDosFactoresDeLaPersona(user, candidates));
    }
  }

  const user = candidates[0];
  if (!user) {
    // La sesión no tiene User de clínica. Antes de mandarla a onboarding,
    // verifica si pertenece a un proveedor (SupplierUser activo) — misma query
    // que getSupplierContext — y en ese caso mándala a su panel. /proveedores
    // usa getSupplierContext (no getCurrentUser), así que no hay loop de redirect.
    const supplierUser = await prisma.supplierUser.findFirst({
      where: { supabaseId: supabaseUser.id, isActive: true },
      select: { id: true },
    });
    if (supplierUser) redirect("/proveedores");
    // Chequeo simétrico de laboratorio: si la sesión pertenece a un DentalLabUser
    // activo, mándala a su panel. /laboratorios usa getDentalLabContext (no
    // getCurrentUser), así que no hay loop de redirect — igual que /proveedores.
    const labUser = await prisma.dentalLabUser.findFirst({
      where: { supabaseId: supabaseUser.id, isActive: true },
      select: { id: true },
    });
    if (labUser) redirect("/laboratorios");
    // Chequeo simétrico de BARBERÍA (DaleControl Barber): si la sesión
    // pertenece a un BarberUser activo, mándala a su panel. /barber usa
    // getBarberContext (no getCurrentUser), así que no hay loop de redirect
    // — igual que /proveedores y /laboratorios.
    //
    // 🔴 try/catch OBLIGATORIO: si la tabla barber_users aún no existe en la
    // BD (sql/barber.sql sin aplicar), este lookup NO puede tumbar el login
    // de las clínicas en producción — se loguea y se sigue al flujo normal.
    // OJO: redirect() lanza NEXT_REDIRECT, por eso vive FUERA del try (si
    // viviera dentro, el catch se tragaría la redirección).
    let barberUser: { id: string } | null = null;
    try {
      barberUser = await prisma.barberUser.findFirst({
        where: { supabaseId: supabaseUser.id, isActive: true },
        select: { id: true },
      });
    } catch (err) {
      console.warn(
        "[auth] lookup de barber_users falló (¿sql/barber.sql sin aplicar?); sigue flujo normal",
        err instanceof Error ? err.message : err,
      );
    }
    if (barberUser) redirect("/barber");
    // Chequeo simétrico de INMUEBLES (DaleControl Inmuebles): si la sesión
    // pertenece a un RealtyUser activo, mándala a su panel. /inmobiliaria
    // usa getRealtyContext (no getCurrentUser), así que no hay loop de
    // redirect — igual que /proveedores, /laboratorios y /barber.
    //
    // 🔴 try/catch OBLIGATORIO, por el mismo motivo que barber: si la tabla
    // realty_users aún no existe en la BD (sql/realty.sql sin aplicar), este
    // lookup NO puede tumbar el login de las clínicas NI el de las barberías
    // en producción — se loguea y se sigue al flujo normal.
    // OJO: redirect() lanza NEXT_REDIRECT, por eso vive FUERA del try (si
    // viviera dentro, el catch se tragaría la redirección).
    let realtyUser: { id: string } | null = null;
    try {
      realtyUser = await prisma.realtyUser.findFirst({
        where: { supabaseId: supabaseUser.id, active: true },
        select: { id: true },
      });
    } catch (err) {
      console.warn(
        "[auth] lookup de realty_users falló (¿sql/realty.sql sin aplicar?); sigue flujo normal",
        err instanceof Error ? err.message : err,
      );
    }
    if (realtyUser) redirect("/inmobiliaria");
    redirect("/onboarding");
  }

  if (activeClinicId) {
    authDebug("warn", "[AUTH-DEBUG getCurrentUser] cookie inválida, reseteada", JSON.stringify({
      reason: "supabaseId no es activo en clinicId solicitada",
      requested: activeClinicId,
      picked: user.clinicId,
    }));
    logClinicFallback({ supabaseId: supabaseUser.id, requestedClinicId: activeClinicId, actualClinicId: user.clinicId });
  } else {
    authDebug("warn", "[AUTH-DEBUG getCurrentUser] cookie inválida, reseteada", JSON.stringify({
      reason: "cookie ausente o HMAC inválido",
      picked: user.clinicId,
    }));
  }

  // Camino de fallback (primer User por createdAt asc). Los gates ya no viven
  // en cada rama sino en getCurrentUser, sobre lo que devuelva cualquiera de
  // las dos: no hay rama que se los pueda olvidar.
  return normalizeUser(conDosFactoresDeLaPersona(user, candidates));
});

export const getUserClinics = cache(async () => {
  const supabaseUser = await requireAuth();
  const users = await prisma.user.findMany({
    where: { supabaseId: supabaseUser.id, isActive: true },
    include: { clinic: { select: { id: true, name: true, category: true, plan: true, logoUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return users.map(u => ({
    clinicId: u.clinic.id,
    clinicName: u.clinic.name,
    category: (u.clinic as any).category ?? "OTHER",
    plan: u.clinic.plan,
    logoUrl: u.clinic.logoUrl,
    role: u.role,
    userId: u.id,
  }));
});
