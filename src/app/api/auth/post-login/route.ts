import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  writeActiveClinicCookie,
  clearActiveClinicCookie,
  readActiveClinicCookie,
  pickActiveClinicId,
} from "@/lib/active-clinic";
import { applyTwoFactorLoginCookies, clearAllTwoFactorCookies } from "@/lib/auth/two-factor-cookie";

/**
 * Llamado por el cliente justo después de un login exitoso (email+password u OAuth).
 * Sembra/limpia la cookie activeClinicId según el nuevo supabaseId — evita que
 * una cookie huérfana (de una sesión previa o de impersonate) contamine el dashboard.
 *
 * - 0 clínicas → BORRA la cookie (el dashboard redirige a /onboarding).
 * - >= 1 clínica → si la cookie actual apunta a una clínica que el usuario sí
 *   posee, la conserva; si no (ausente, HMAC inválido o ajena), la siembra a
 *   la primera por createdAt. Garantiza que getCurrentUser nunca caiga al
 *   fallback "primer createdAt en cada request" para multi-clínica.
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

  // notifLastSeen pertenece a la sesión anterior, siempre se limpia.
  res.cookies.set("notifLastSeen", "", { path: "/", maxAge: 0 });

  if (userClinics.length === 0) {
    clearActiveClinicCookie(res);
    clearAllTwoFactorCookies(res);
    return res;
  }

  const current = readActiveClinicCookie();
  const ownedIds = userClinics.map(u => u.clinicId);
  const picked = pickActiveClinicId(current, ownedIds);
  writeActiveClinicCookie(res, picked.clinicId);
  // Si la membresía activa tiene 2FA (o la clínica lo exige) marca el flag
  // pendiente y borra cualquier df_2fa previa → fuerza el reto este login.
  await applyTwoFactorLoginCookies(res, user.id, picked.clinicId);
  return res;
}
