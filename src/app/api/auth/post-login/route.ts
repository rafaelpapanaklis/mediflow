import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { writeActiveClinicCookie } from "@/lib/active-clinic";

/**
 * Llamado por el cliente justo después de un login exitoso (email+password u OAuth).
 * Sembra/limpia la cookie activeClinicId según el nuevo supabaseId — evita que
 * una cookie huérfana (de una sesión previa o de impersonate) contamine el dashboard.
 *
 * - Si el user tiene exactamente UNA clínica → setea cookie firmada a esa clinicId.
 * - Si tiene varias → BORRA la cookie (getCurrentUser caerá al primer User por createdAt).
 * - Si no tiene clínicas → BORRA la cookie también; el dashboard redirige a /onboarding.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userClinics = await prisma.user.findMany({
    where: { supabaseId: user.id, isActive: true },
    select: { clinicId: true },
    orderBy: { createdAt: "asc" },
  });

  const res = NextResponse.json({ ok: true, clinicCount: userClinics.length });

  // Limpiar también notifLastSeen — pertenece a la sesión anterior.
  res.cookies.set("notifLastSeen", "", { path: "/", maxAge: 0 });

  if (userClinics.length === 1) {
    writeActiveClinicCookie(res, userClinics[0].clinicId);
  } else {
    res.cookies.set("activeClinicId", "", { path: "/", maxAge: 0 });
  }
  return res;
}
