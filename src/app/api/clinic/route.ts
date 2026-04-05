import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.user.findUnique({ where: { supabaseId: user.id } });
}

export async function PATCH(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Build update object — only update fields that were sent
  const data: Record<string, any> = {};
  if (body.name        !== undefined) data.name        = body.name;
  if (body.city        !== undefined) data.city        = body.city        || null;
  if (body.address     !== undefined) data.address     = body.address     || null;
  if (body.phone       !== undefined) data.phone       = body.phone       || null;
  if (body.email       !== undefined) data.email       = body.email       || null;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.isPublic    !== undefined) data.isPublic    = Boolean(body.isPublic);

  const updated = await prisma.clinic.update({
    where: { id: dbUser.clinicId },
    data,
  });

  return NextResponse.json(updated);
}
