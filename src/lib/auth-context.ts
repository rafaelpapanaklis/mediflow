import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { readActiveClinicCookie, logClinicFallback } from "@/lib/active-clinic";
import { isPlanExpired, isApiPathBlockedForExpiredPlan } from "@/lib/plan-status";

export interface AuthContext {
  userId:       string;
  clinicId:     string;
  role:         string;
  color:        string;
  clinic:       any;
  user:         any;
  // Override granular del default del role. Siempre presente como string[]
  // (vacío si no hay override). Endpoints lo usan con
  // denyIfMissingPermission(ctx, "billing.refund").
  permissionsOverride: string[];
  clinicCategory: string; // ClinicCategory enum value
  // Plan vencido (trial expirado y suscripción no activa). Ver isPlanExpired
  // en @/lib/plan-status. Expuesto para callers que quieran degradar la UI/UX.
  isPlanExpired: boolean;
  // Role helpers
  isSuperAdmin: boolean;  // Platform owner — global access
  isAdmin:      boolean;  // Clinic admin — full access to their clinic
  isDoctor:     boolean;  // Doctor — only their own data
  isReceptionist: boolean; // Receptionist — limited access
  canManageTeam: boolean;  // Can create/edit/delete doctors
  canViewAllData: boolean; // Can see all clinic data (not just own)
}

/**
 * Core auth function — call this in every API route.
 * Returns null if unauthenticated or inactive.
 * The clinicId is ALWAYS taken from the session, never from the request body.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const activeClinicId = readActiveClinicCookie();

    const dbUser = activeClinicId
      ? await prisma.user.findFirst({
          where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
          include: { clinic: true },
        })
      : null;

    if (dbUser) {
      console.log("[AUTH-DEBUG getAuthContext] cookie OK", JSON.stringify({ picked: dbUser.clinicId }));
    }

    const finalUser = dbUser ?? await prisma.user.findFirst({
      where: { supabaseId: user.id, isActive: true },
      include: { clinic: true },
      orderBy: { createdAt: "asc" },
    });

    if (!finalUser || !finalUser.isActive) return null;

    if (!dbUser) {
      if (activeClinicId) {
        console.warn("[AUTH-DEBUG getAuthContext] cookie inválida, reseteada", JSON.stringify({
          reason: "supabaseId no es activo en clinicId solicitada",
          requested: activeClinicId,
          picked: finalUser.clinicId,
        }));
        logClinicFallback({ supabaseId: user.id, requestedClinicId: activeClinicId, actualClinicId: finalUser.clinicId });
      } else {
        console.warn("[AUTH-DEBUG getAuthContext] cookie inválida, reseteada", JSON.stringify({
          reason: "cookie ausente o HMAC inválido",
          picked: finalUser.clinicId,
        }));
      }
    }

    const isSuperAdmin   = finalUser.role === "SUPER_ADMIN";
    const isAdmin        = finalUser.role === "ADMIN" || isSuperAdmin;
    const isDoctor       = finalUser.role === "DOCTOR";
    const isReceptionist = finalUser.role === "RECEPTIONIST";

    // Normalizamos permissionsOverride a [] si Prisma client viejo (deploy
    // cacheado) no devuelve el campo. Sin esto, ctx.user.permissionsOverride
    // sería undefined y denyIfMissingPermission caería al default del rol
    // ignorando el override real en DB.
    const permissionsOverride: string[] =
      ((finalUser as any).permissionsOverride as string[] | null | undefined) ?? [];

    // Gate central de plan vencido a nivel API. Si la clínica está vencida
    // (trial expirado + suscripción no activa) y la request va a una ruta
    // /api NO exenta (allowlist de pago/auth en @/lib/plan-status), cortamos
    // devolviendo null → la ruta responde 401, igual que con sesión inválida.
    // El pathname lo inyecta el middleware en x-pathname para TODA ruta /api;
    // si falta (páginas server, callers no-API) NO bloqueamos — el layout de
    // /dashboard ya redirige esas navegaciones a /dashboard/suspended. El
    // gate aplica a TODOS los roles (un SUPER_ADMIN destraba desde /admin,
    // ruta con su propia auth, no cubierta por este check).
    const planExpired = isPlanExpired(finalUser.clinic);
    if (planExpired) {
      const pathname = (() => {
        try { return headers().get("x-pathname"); } catch { return null; }
      })();
      if (isApiPathBlockedForExpiredPlan(pathname)) return null;
    }

    return {
      userId:         finalUser.id,
      clinicId:       finalUser.clinicId,
      role:           finalUser.role,
      color:          finalUser.color ?? "#3b82f6",
      clinic:         finalUser.clinic,
      user:           { ...finalUser, permissionsOverride },
      permissionsOverride,
      clinicCategory: (finalUser.clinic as any).category ?? "OTHER",
      isPlanExpired:  planExpired,
      isSuperAdmin,
      isAdmin,
      isDoctor,
      isReceptionist,
      canManageTeam:   isAdmin,
      canViewAllData:  isAdmin,
    };
  } catch {
    return null;
  }
}

/**
 * Build patient WHERE clause based on role.
 * Admins see all clinic patients. Doctors only see their own.
 */
export function buildPatientWhere(ctx: AuthContext, extra: Record<string, any> = {}) {
  return {
    clinicId: ctx.clinicId, // ALWAYS — prevents cross-clinic access
    ...(ctx.isDoctor && {   // Doctors only see their patients
      OR: [
        { primaryDoctorId: ctx.userId },
        { appointments: { some: { doctorId: ctx.userId } } },
        { records: { some: { doctorId: ctx.userId } } },
      ],
    }),
    ...extra,
  };
}

/**
 * Build appointment WHERE clause based on role.
 */
export function buildAppointmentWhere(ctx: AuthContext, extra: Record<string, any> = {}) {
  return {
    clinicId: ctx.clinicId,
    ...(ctx.isDoctor && { doctorId: ctx.userId }),
    ...extra,
  };
}

/**
 * Build medical record WHERE clause based on role.
 */
export function buildRecordWhere(ctx: AuthContext, extra: Record<string, any> = {}) {
  return {
    clinicId: ctx.clinicId,
    ...(ctx.isDoctor && { doctorId: ctx.userId }),
    ...extra,
  };
}

/**
 * Require a minimum role. Returns 403 response if not authorized.
 * Use in API routes that need specific permissions.
 */
export function requireRole(ctx: AuthContext | null, ...roles: string[]): NextResponse | null {
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!roles.includes(ctx.role) && !ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  return null;
}

/**
 * Require admin role. Returns 403 if not admin.
 */
export function requireAdmin(ctx: AuthContext | null): NextResponse | null {
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  return null;
}

/**
 * Verify that a resource belongs to the user's clinic.
 * Critical for preventing cross-clinic access.
 */
export function assertSameClinic(ctx: AuthContext, resourceClinicId: string): boolean {
  return ctx.clinicId === resourceClinicId || ctx.isSuperAdmin;
}
