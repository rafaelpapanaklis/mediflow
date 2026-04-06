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
      role: true, specialty: true, color: true, services: true,
      avatarUrl: true, phone: true, isActive: true, createdAt: true,
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
  const { email, firstName, lastName, role, specialty, color, phone, services } = body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Nombre, apellido y email son requeridos" }, { status: 400 });
  }

  // Auto-assign color
  const existing = await prisma.user.findMany({
    where: { clinicId: ctx!.clinicId }, select: { color: true, email: true },
  });
  if (existing.some(u => u.email === email.trim().toLowerCase())) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email en esta clínica" }, { status: 400 });
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
        error: "Este email ya tiene cuenta en MediFlow. El doctor debe usar su contraseña existente.",
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
    },
  });

  return NextResponse.json({
    ...newUser,
    tempPassword,
    createdAt: newUser.createdAt.toISOString(),
    updatedAt: newUser.updatedAt.toISOString(),
  }, { status: 201 });
}
