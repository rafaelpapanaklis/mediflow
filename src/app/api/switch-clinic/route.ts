import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { writeActiveClinicCookie } from "@/lib/active-clinic";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clinicId } = await req.json();
  console.log("[switch-clinic] called with", JSON.stringify({ bodyClinicId: clinicId, supabaseId: user.id }));
  if (!clinicId) return NextResponse.json({ error: "clinicId required" }, { status: 400 });

  const dbUser = await prisma.user.findFirst({
    where: { supabaseId: user.id, clinicId, isActive: true },
    select: { id: true, clinicId: true },
  });
  if (!dbUser) {
    console.warn("[switch-clinic] no access", JSON.stringify({ supabaseId: user.id, attemptedClinicId: clinicId }));
    return NextResponse.json({ error: "No access to this clinic" }, { status: 403 });
  }

  const response = NextResponse.json({ success: true, clinicId: dbUser.clinicId });
  writeActiveClinicCookie(response, dbUser.clinicId);
  console.log("[switch-clinic] cookie set", JSON.stringify({ clinicId: dbUser.clinicId, setCookieHeader: response.headers.get("set-cookie") }));
  return response;
}
