import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { camposPublicosDeMiembro } from "@/lib/team/member-fields";

const DOCTOR_COLORS = [
  "#3b82f6","#7c3aed","#059669","#e11d48","#d97706",
  "#0891b2","#db2777","#4338ca","#16a34a","#dc2626",
  "#9333ea","#0284c7","#f97316","#84cc16",
];

// P1-8: roles que un admin puede asignar por API — exactamente los que ofrece
// la UI de equipo (team-client.tsx ROLES). SUPER_ADMIN queda fuera a propósito:
// es el dueño de la plataforma y requireRole le da bypass en todo el producto,
// así que fabricar uno por API era una escalada de privilegios. (Const local:
// un route.ts no puede exportar nada que no sea handler/config de Next.)
const ASSIGNABLE_ROLES: string[] = ["DOCTOR", "ADMIN", "RECEPTIONIST"];

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const team = await prisma.user.findMany({
    where: { clinicId: ctx!.clinicId },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      role: true, specialty: true, color: true, services: true,
      avatarUrl: true, phone: true, isActive: true, createdAt: true,
      cedulaProfesional: true, especialidad: true, cedulaEspecialidad: true,
      _count: {
        select: {
          appointments: { where: { status: { not: "CANCELLED" } } },
          records: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json(team, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // EQ-07: dar de alta a un miembro es "Editar equipo" del modal (por default
  // SA y ADMIN — los mismos que dejaba pasar el `requireAdmin` que había aquí),
  // con override incluido. Lo que sigue siendo SOLO del SUPER_ADMIN por rol
  // (permisos y reset de contraseña) vive en sus propias rutas.
  const denied = denyIfMissingPermission(ctx, "team.edit");
  if (denied) return denied;

  const body = await req.json();
  const { email, firstName, lastName, role, specialty, color, phone, services,
          cedulaProfesional, especialidad, cedulaEspecialidad, canAccessCaja } = body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Nombre, apellido y email son requeridos" }, { status: 400 });
  }

  // P1-8: allowlist de rol. Sin rol en el body se mantiene el default DOCTOR.
  if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json(
      { error: "Rol inválido. Permitidos: DOCTOR, ADMIN, RECEPTIONIST." },
      { status: 400 },
    );
  }

  // Auto-assign color
  const existing = await prisma.user.findMany({
    where: { clinicId: ctx!.clinicId }, select: { color: true, email: true },
  });
  if (existing.some(u => u.email === email.trim().toLowerCase())) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email en esta clínica" }, { status: 400 });
  }

  // Tope de usuarios por plan (enforcement). maxUsers null = ilimitado.
  const clinicPlan = await prisma.clinic.findUnique({ where: { id: ctx!.clinicId }, select: { plan: true } });
  const { maxUsers } = await getPlanLimits(clinicPlan?.plan);
  if (maxUsers != null) {
    const activeUsers = await prisma.user.count({ where: { clinicId: ctx!.clinicId, isActive: true } });
    if (activeUsers >= maxUsers) {
      return NextResponse.json(
        { error: `Tu plan incluye ${maxUsers} usuario(s). Sube de plan para agregar más miembros.`, code: "PLAN_LIMIT_USERS", limit: maxUsers },
        { status: 402 },
      );
    }
  }

  const usedColors    = existing.map(u => u.color);
  const assignedColor = color || DOCTOR_COLORS.find(c => !usedColors.includes(c)) || DOCTOR_COLORS[0];

  // Generate temp password — no email invite sent
  const tempPassword = `Medi${Math.random().toString(36).slice(2,6).toUpperCase()}${Math.floor(10 + Math.random()*90)}!`;

  const supabaseAdmin = getAdminClient();

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email:         email.trim().toLowerCase(),
    password:      tempPassword,
    email_confirm: true, // skip email verification
    user_metadata: { firstName, lastName, clinicName: ctx!.clinic.name },
  });

  if (createError || !created?.user) {
    const msg = createError?.message ?? "";
    if (msg.includes("already been registered") || msg.includes("already exists")) {
      return NextResponse.json({
        error: "Este email ya tiene cuenta en DaleControl. El doctor debe usar su contraseña existente.",
      }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "Error al crear usuario" }, { status: 400 });
  }

  const newUser = await prisma.user.create({
    data: {
      supabaseId: created.user.id,
      clinicId:   ctx!.clinicId,
      email:      email.trim().toLowerCase(),
      firstName:  firstName.trim(),
      lastName:   lastName.trim(),
      role:       role ?? "DOCTOR",
      specialty:  specialty || null,
      color:      assignedColor,
      phone:      phone || null,
      services:   services ?? [],
      isActive:   true,
      cedulaProfesional:  cedulaProfesional?.trim() || null,
      especialidad:       especialidad?.trim() || null,
      cedulaEspecialidad: cedulaEspecialidad?.trim() || null,
      canAccessCaja:      canAccessCaja === true,
      // La contraseña de arriba la generó el sistema y la conoce quien dio de
      // alta al miembro: no puede quedarse con ella. Hasta que defina la suya en
      // /dashboard/cambiar-contrasena, el layout del dashboard no le deja usar
      // el panel. Va en el create y no por markMustChangePassword porque
      // supabaseAdmin.auth.admin.createUser acaba de crear la cuenta: es de
      // correo + contraseña por construcción (no hay caso Google que exentar) y
      // este supabaseId tiene exactamente esta fila, sin hermanas que marcar.
      mustChangePassword: true,
    },
  });

  await logMutation({
    req,
    clinicId: ctx!.clinicId,
    userId: ctx!.userId,
    entityType: "user",
    entityId: newUser.id,
    action: "create",
    after: { firstName: newUser.firstName, lastName: newUser.lastName, email: newUser.email, role: newUser.role, especialidad: newUser.especialidad },
  });

  revalidateAfter("team");

  // Mismo patrón que EQ-05 y por eso la misma lista blanca: `create` sin
  // `select` + spread al responder. Aquí los secretos nacen vacíos, así que
  // hoy no hay nada que robar — pero el día que el alta enrole el 2FA o
  // siembre un PIN, el agujero ya estaría abierto y nadie habría tocado este
  // archivo. `tempPassword` sí sale, y a propósito: es lo único que se le
  // enseña UNA vez a quien da de alta al miembro.
  return NextResponse.json({
    ...camposPublicosDeMiembro(newUser),
    tempPassword,
    createdAt: newUser.createdAt.toISOString(),
    updatedAt: newUser.updatedAt.toISOString(),
  }, { status: 201 });
}
