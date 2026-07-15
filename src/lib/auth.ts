import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { readActiveClinicCookie, logClinicFallback } from "@/lib/active-clinic";
import { isPlanExpired, isApiPathBlockedForExpiredPlan } from "@/lib/plan-status";

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

export const getCurrentUser = cache(async () => {
  const supabaseUser = await requireAuth();
  const activeClinicId = readActiveClinicCookie();

  if (activeClinicId) {
    const user = await prisma.user.findFirst({
      where: { supabaseId: supabaseUser.id, clinicId: activeClinicId, isActive: true },
      include: { clinic: true },
    });
    if (user) {
      enforceApiPlanGate(user.clinic);
      return normalizeUser(user);
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

  enforceApiPlanGate(user.clinic);
  return normalizeUser(user);
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
