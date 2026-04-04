import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Predefined doctor colors for the agenda
const DOCTOR_COLORS = [
  "#3b82f6", // blue
  "#7c3aed", // violet
  "#059669", // emerald
  "#e11d48", // rose
  "#d97706", // amber
  "#0891b2", // cyan
  "#db2777", // pink
  "#4338ca", // indigo
  "#16a34a", // green
  "#dc2626", // red
  "#9333ea", // purple
  "#0284c7", // sky
];

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// GET /api/team — list all doctors/staff in clinic
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const team = await prisma.user.findMany({
    where: { clinicId: ctx!.clinicId },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      role: true, specialty: true, color: true, avatarUrl: true,
      phone: true, isActive: true, createdAt: true,
      googleCalendarEnabled: true, googleCalendarEmail: true,
      _count: {
        select: {
          appointments: { where: { status: { not: "CANCELLED" } } },
          records: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json(team);
}

// POST /api/team — invite a new doctor/staff member
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const body = await req.json();
  const { email, firstName, lastName, role, specialty, color, phone } = body;

  if (!email || !firstName || !lastName) {
    return NextResponse.json({ error: "Nombre y email son requeridos" }, { status: 400 });
  }

  // Pick color — use provided or auto-assign next available
  const existingColors = await prisma.user.findMany({
    where: { clinicId: ctx!.clinicId },
    select: { color: true },
  });
  const usedColors = existingColors.map(u => u.color);
  const assignedColor = color || DOCTOR_COLORS.find(c => !usedColors.includes(c)) || DOCTOR_COLORS[0];

  // Check if email already exists in this clinic
  const existing = await prisma.user.findFirst({
    where: { clinicId: ctx!.clinicId, email },
  });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email en esta clínica" }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();

  // Check if user already exists in Supabase (maybe from another clinic)
  const { data: existingAuth } = await supabaseAdmin.auth.admin.listUsers();
  const existingAuthUser = existingAuth?.users?.find(u => u.email === email);

  let supabaseUserId: string;

  if (existingAuthUser) {
    // User exists in Supabase — just create the DB record
    supabaseUserId = existingAuthUser.id;
  } else {
    // Invite new user via Supabase — sends email with magic link to set password
    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      data: { clinicName: ctx!.clinic.name },
    });

    if (inviteError || !invited?.user) {
      return NextResponse.json({ error: inviteError?.message ?? "Error al invitar usuario" }, { status: 400 });
    }
    supabaseUserId = invited.user.id;
  }

  // Create user record in our DB
  const newUser = await prisma.user.create({
    data: {
      supabaseId: supabaseUserId,
      clinicId:   ctx!.clinicId,
      email,
      firstName,
      lastName,
      role:       role ?? "DOCTOR",
      specialty:  specialty ?? null,
      color:      assignedColor,
      phone:      phone ?? null,
      isActive:   true,
    },
  });

  return NextResponse.json(newUser, { status: 201 });
}
