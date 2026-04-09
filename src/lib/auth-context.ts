import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export interface AuthContext {
  userId:       string;
  clinicId:     string;
  role:         string;
  color:        string;
  clinic:       any;
  user:         any;
  clinicCategory: string; // ClinicCategory enum value
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

    const dbUser = await prisma.user.findUnique({
      where: { supabaseId: user.id },
      include: { clinic: true },
    });

    if (!dbUser || !dbUser.isActive) return null;

    const isSuperAdmin   = dbUser.role === "SUPER_ADMIN";
    const isAdmin        = dbUser.role === "ADMIN" || isSuperAdmin;
    const isDoctor       = dbUser.role === "DOCTOR";
    const isReceptionist = dbUser.role === "RECEPTIONIST";

    return {
      userId:         dbUser.id,
      clinicId:       dbUser.clinicId,
      role:           dbUser.role,
      color:          dbUser.color ?? "#3b82f6",
      clinic:         dbUser.clinic,
      user:           dbUser,
      clinicCategory: (dbUser.clinic as any).category ?? "OTHER",
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
