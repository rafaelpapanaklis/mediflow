import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { readActiveClinicCookie, logClinicFallback } from "@/lib/active-clinic";

export async function getSession() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

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

export async function getCurrentUser() {
  const supabaseUser = await requireAuth();
  const activeClinicId = readActiveClinicCookie();

  if (activeClinicId) {
    const user = await prisma.user.findFirst({
      where: { supabaseId: supabaseUser.id, clinicId: activeClinicId, isActive: true },
      include: { clinic: true },
    });
    if (user) {
      console.log("[AUTH-DEBUG getCurrentUser] cookie OK", JSON.stringify({ picked: user.clinicId }));
      return normalizeUser(user);
    }
  }

  const candidates = await prisma.user.findMany({
    where: { supabaseId: supabaseUser.id, isActive: true },
    include: { clinic: true },
    orderBy: { createdAt: "asc" },
  });

  const user = candidates[0];
  if (!user) redirect("/onboarding");

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

  return normalizeUser(user);
}

export async function getUserClinics() {
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
}
