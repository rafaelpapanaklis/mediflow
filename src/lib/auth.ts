import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { readActiveClinicCookie, logClinicFallback } from "@/lib/active-clinic";
import { isPlanExpired, isApiPathBlockedForExpiredPlan } from "@/lib/plan-status";
import { hasValidTwoFactorCookie } from "@/lib/auth/two-factor-cookie";
import { isApiPathBlockedForMissingTwoFactor, needsTwoFactor } from "@/lib/auth/two-factor-gate";
import { personaTieneDosFactores } from "@/lib/auth/two-factor-identity";
import { TWO_FA_CHALLENGE_PATH } from "@/lib/auth/two-factor-constants";

// getSession/getCurrentUser/getUserClinics van memoizadas por request con
// React cache(): layout, page y route handlers invocados in-process dentro
// del mismo render comparten UNA ejecución de cada una (antes cada
// navegación pagaba 3-4 supabase.auth.getUser() + sus queries duplicadas).
export const getSession = cache(async () => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
 * Si la fila activa ya lo tiene puesto no se consulta nada.
 */
async function conDosFactoresDeLaPersona<T extends { supabaseId: string; totpEnabled?: boolean | null }>(
  u: T,
): Promise<T> {
  if (u.totpEnabled) return u;
  return (await personaTieneDosFactores(u.supabaseId)) ? { ...u, totpEnabled: true } : u;
}

// Gate de plan vencido para los route handlers que autentican vía
// getCurrentUser (segundo camino además de getAuthContext). Si el plan venció
// y la request va a una ruta /api NO exenta (allowlist de pago/auth), cortamos
// con redirect a /dashboard/suspended — getCurrentUser no puede devolver null,
// pero el redirect impide que el handler corra y el dato salga. Sólo dispara
// en /api: las páginas server (pathname /dashboard/*) las cubre el layout, y
// para callers sin x-pathname es no-op. Mismo criterio que getAuthContext.
// Gate de 2FA para los route handlers que autentican vía getCurrentUser — el
// SEGUNDO camino además de getAuthContext, y no es un camino menor: por aquí
// entran las ~30 rutas de agenda, citas, lista de espera y /api/dashboard/home,
// todas a través de loadClinicSession() (@/lib/agenda/api-helpers).
//
// getCurrentUser no puede devolver null (redirige por contrato), así que se corta
// con redirect al reto — exactamente lo que ya hace enforceApiPlanGate con
// /dashboard/suspended. El handler no llega a correr, que es lo único que
// importa: el dato no sale.
//
// Sólo dispara en /api. Para páginas server (pathname /dashboard/*) es no-op: ahí
// el gate autoritativo es el layout, que ya distingue reto de enrolamiento.
// Criterio y allowlist compartidos con getAuthContext en @/lib/auth/two-factor-gate.
function enforceApiTwoFactorGate(user: {
  supabaseId: string;
  clinicId: string;
  totpEnabled?: boolean | null;
  clinic?: { require2fa?: boolean | null } | null;
}): void {
  if (!needsTwoFactor({ totpEnabled: user.totpEnabled, require2fa: user.clinic?.require2fa })) return;
  const pathname = (() => {
    try { return headers().get("x-pathname"); } catch { return null; }
  })();
  if (!isApiPathBlockedForMissingTwoFactor(pathname)) return;
  if (hasValidTwoFactorCookie(user.supabaseId, user.clinicId)) return;
  redirect(TWO_FA_CHALLENGE_PATH);
}

function enforceApiPlanGate(clinic: unknown): void {
  if (!isPlanExpired(clinic as { trialEndsAt?: Date | string | null; subscriptionStatus?: string | null } | null)) return;
  const pathname = (() => {
    try { return headers().get("x-pathname"); } catch { return null; }
  })();
  if (isApiPathBlockedForExpiredPlan(pathname)) redirect("/dashboard/suspended");
}

export const getCurrentUser = cache(async () => {
  const supabaseUser = await requireAuth();
  const activeClinicId = readActiveClinicCookie();

  if (activeClinicId) {
    const user = await prisma.user.findFirst({
      where: { supabaseId: supabaseUser.id, clinicId: activeClinicId, isActive: true },
      include: { clinic: true },
    });
    if (user) {
      // ORDEN: 2FA antes que plan. El 2FA es autenticación; el plan, comercial.
      const conDosFactores = await conDosFactoresDeLaPersona(user);
      enforceApiTwoFactorGate(conDosFactores);
      enforceApiPlanGate(conDosFactores.clinic);
      return normalizeUser(conDosFactores);
    }
  }

  const candidates = await prisma.user.findMany({
    where: { supabaseId: supabaseUser.id, isActive: true },
    include: { clinic: true },
    orderBy: { createdAt: "asc" },
  });

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
    console.warn("[AUTH-DEBUG getCurrentUser] cookie inválida, reseteada", JSON.stringify({
      reason: "supabaseId no es activo en clinicId solicitada",
      requested: activeClinicId,
      picked: user.clinicId,
    }));
    logClinicFallback({ supabaseId: supabaseUser.id, requestedClinicId: activeClinicId, actualClinicId: user.clinicId });
  } else {
    console.warn("[AUTH-DEBUG getCurrentUser] cookie inválida, reseteada", JSON.stringify({
      reason: "cookie ausente o HMAC inválido",
      picked: user.clinicId,
    }));
  }

  // Mismo par de gates que en la rama de la cookie de clínica activa, y en el
  // mismo orden. Este es el camino de fallback (primer User por createdAt asc):
  // si se le olvida el gate a UNA de las dos ramas, el agujero sigue abierto por
  // ahí para cualquier sesión sin cookie de clínica válida.
  const conDosFactores = await conDosFactoresDeLaPersona(user);
  enforceApiTwoFactorGate(conDosFactores);
  enforceApiPlanGate(conDosFactores.clinic);
  return normalizeUser(conDosFactores);
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
