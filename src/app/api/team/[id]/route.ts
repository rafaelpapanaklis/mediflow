import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// GET /api/team/[id] — get doctor details
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const member = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx!.clinicId }, // cross-clinic protection
    include: {
      _count: {
        select: {
          appointments: true,
          records: true,
          primaryPatients: true,
        },
      },
    },
  });

  if (!member) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(member);
}

// PATCH /api/team/[id] — update doctor info
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  // Prevent changing own role or deactivating self
  if (params.id === ctx!.userId && req.method === "PATCH") {
    const body = await req.json();
    if (body.role && body.role !== ctx!.role) {
      return NextResponse.json({ error: "No puedes cambiar tu propio rol" }, { status: 400 });
    }
    if (body.isActive === false) {
      return NextResponse.json({ error: "No puedes desactivarte a ti mismo" }, { status: 400 });
    }
  }

  const body = await req.json();

  // Verify member belongs to this clinic
  const member = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx!.clinicId },
  });
  if (!member) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: {
      ...(body.firstName  !== undefined && { firstName:  body.firstName  }),
      ...(body.lastName   !== undefined && { lastName:   body.lastName   }),
      ...(body.specialty  !== undefined && { specialty:  body.specialty  }),
      ...(body.color      !== undefined && { color:      body.color      }),
      ...(body.phone      !== undefined && { phone:      body.phone      }),
      ...(body.avatarUrl  !== undefined && { avatarUrl:  body.avatarUrl  }),
      ...(body.role       !== undefined && { role:       body.role       }),
      ...(body.isActive   !== undefined && { isActive:   body.isActive   }),
      ...(body.services   !== undefined && { services:   body.services   }),
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/team/[id] — permanently remove doctor
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  // Cannot delete yourself
  if (params.id === ctx!.userId) {
    return NextResponse.json({ error: "No puedes eliminarte a ti mismo" }, { status: 400 });
  }

  const member = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx!.clinicId },
    include: { _count: { select: { appointments: true, records: true } } },
  });

  if (!member) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // If doctor has appointments/records, deactivate instead of delete
  if (member._count.appointments > 0 || member._count.records > 0) {
    await prisma.user.updateMany({ where: { id: params.id, clinicId: ctx!.clinicId }, data: { isActive: false } });
    return NextResponse.json({ deactivated: true, message: "Doctor desactivado (tiene registros históricos)" });
  }

  // No records — safe to delete
  const supabaseAdmin = getAdminClient();
  await supabaseAdmin.auth.admin.deleteUser(member.supabaseId);
  await prisma.user.deleteMany({ where: { id: params.id, clinicId: ctx!.clinicId } });

  return NextResponse.json({ deleted: true });
}
