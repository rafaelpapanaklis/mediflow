import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const cookieStore = cookies();
  const activeClinicId = cookieStore.get("activeClinicId")?.value;
  console.log("[api/users/me] rawCookie=", activeClinicId?.slice(0, 30), "hasDot=", activeClinicId?.includes("."));
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
  const updated = await prisma.user.update({ where: { id: dbUser.id }, data: { firstName: body.firstName, lastName: body.lastName, phone: body.phone || undefined, specialty: body.specialty || undefined } });
  return NextResponse.json(updated);
}
