import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { writeActiveClinicCookie } from "@/lib/active-clinic";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clinicId } = await req.json();
  if (!clinicId) return NextResponse.json({ error: "clinicId required" }, { status: 400 });

  const dbUser = await prisma.user.findFirst({
    where: { supabaseId: user.id, clinicId, isActive: true },
    select: { id: true, clinicId: true },
  });
  if (!dbUser) return NextResponse.json({ error: "No access to this clinic" }, { status: 403 });

  const response = NextResponse.json({ success: true, clinicId: dbUser.clinicId });
  writeActiveClinicCookie(response, dbUser.clinicId);
  return response;
}
