import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return u;
  }
  return prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
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
  if (body.isPublic    !== undefined) {
    data.isPublic      = Boolean(body.isPublic);
    data.landingActive = Boolean(body.isPublic);
  }
  if (body.category    !== undefined) data.category    = body.category;
  // NOM-024: CLUES Sector Salud (11 chars). Trim y null si vacío.
  if (body.clues       !== undefined) {
    const clues = typeof body.clues === "string" ? body.clues.trim() : "";
    data.clues = clues.length === 0 ? null : clues.slice(0, 11);
  }

  const updated = await prisma.clinic.update({
    where: { id: dbUser.clinicId },
    data,
  });

  return NextResponse.json(updated);
}
