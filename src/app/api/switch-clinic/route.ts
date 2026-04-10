import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clinicId } = await req.json();
  if (!clinicId) return NextResponse.json({ error: "clinicId required" }, { status: 400 });

  // Verify the user actually has access to this clinic
  const dbUser = await prisma.user.findFirst({
    where: { supabaseId: user.id, clinicId, isActive: true },
    select: { id: true, clinicId: true },
  });

  if (!dbUser) return NextResponse.json({ error: "No access to this clinic" }, { status: 403 });

  // Set the active clinic cookie
  const response = NextResponse.json({ success: true, clinicId });
  response.cookies.set("activeClinicId", clinicId, {
    path: "/",
    httpOnly: false, // needs to be readable by client for instant UI updates
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  return response;
}
