import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAuthUrl } from "@/lib/google-calendar";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.user.findUnique({ where: { supabaseId: user.id } });
}

// GET → redirect to Google OAuth
export async function GET(req: NextRequest) {
  const user = await getDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = getAuthUrl(user.id);
  return NextResponse.redirect(url);
}

// DELETE → disconnect
export async function DELETE(req: NextRequest) {
  const user = await getDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      googleCalendarToken:   null,
      googleRefreshToken:    null,
      googleCalendarEmail:   null,
      googleCalendarEnabled: false,
    },
  });
  return NextResponse.json({ success: true });
}
