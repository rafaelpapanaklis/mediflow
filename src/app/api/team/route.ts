import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const DOCTOR_COLORS = [
  "#3b82f6","#7c3aed","#059669","#e11d48","#d97706",
  "#0891b2","#db2777","#4338ca","#16a34a","#dc2626",
  "#9333ea","#0284c7","#f97316","#84cc16",
];

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

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const body = await req.json();
  const { email, firstName, lastName, role, specialty, color, phone } = body;

  if (!email || !firstName || !lastName) {
    return NextResponse.json({ error: "Nombre y email son requeridos" }, { status: 400 });
  }

  // Auto-assign color if not provided
  const existingColors = await prisma.user.findMany({
    where: { clinicId: ctx!.clinicId },
    select: { color: true },
  });
  const usedColors = existingColors.map((u: any) => u.color);
  const assignedColor = color || DOCTOR_COLORS.find(c => !usedColors.includes(c)) || DOCTOR_COLORS[0];

  // Check if email already exists in this clinic
  const existing = await prisma.user.findFirst({
    where: { clinicId: ctx!.clinicId, email },
  });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email en esta clínica" }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();

  // Invite user via Supabase — sends email with magic link to set password
  // If user already exists in Supabase auth, inviteUserByEmail handles it gracefully
  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    data: { clinicName: ctx!.clinic.name },
  });

  if (inviteError || !invited?.user) {
    return NextResponse.json({ error: inviteError?.message ?? "Error al invitar usuario" }, { status: 400 });
  }

  // Create user record in our DB
  const newUser = await prisma.user.create({
    data: {
      supabaseId: invited.user.id,
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
