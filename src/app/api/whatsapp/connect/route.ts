import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const cookieStore = cookies();
  const activeClinicId = cookieStore.get("activeClinicId")?.value;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return u.clinicId;
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
  return dbUser?.clinicId ?? null;
}

export async function POST(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phoneNumberId, accessToken } = await req.json();

  if (!phoneNumberId || !accessToken) {
    return NextResponse.json({ error: "Se requiere Phone Number ID y Access Token" }, { status: 400 });
  }

  // Verify the token works by calling the WhatsApp API
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: `Token inválido: ${err.error?.message ?? "Error desconocido"}` }, { status: 400 });
    }
    const data = await res.json();

    await prisma.clinic.update({
      where: { id: clinicId },
      data: { waPhoneNumberId: phoneNumberId, waAccessToken: accessToken, waConnected: true },
    });

    return NextResponse.json({ success: true, displayName: data.display_phone_number ?? data.verified_name });
  } catch {
    return NextResponse.json({ error: "Error al verificar credenciales" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.clinic.update({
    where: { id: clinicId },
    data: { waPhoneNumberId: null, waAccessToken: null, waConnected: false },
  });
  return NextResponse.json({ success: true });
}
