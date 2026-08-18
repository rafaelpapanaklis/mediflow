import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { writeActiveClinicCookie } from "@/lib/active-clinic";
import { applyTwoFactorLoginCookies } from "@/lib/auth/two-factor-cookie";

/**
 * Cambia la clínica activa de la sesión.
 *
 * EQ-02 — esta ruta escribía la cookie de sede y ya. Está EXENTA del gate de
 * 2FA con el argumento de que "la clínica de destino vuelve a pedir su propio
 * reto"; la cookie df_2fa sí está atada al par persona+clínica, pero eso solo
 * sirve si el destino pide algo, y con el 2FA guardado por FILA la sede a la
 * que se llega podía no pedir nada.
 *
 * Ahora, al cambiar de sede se re-evalúa el segundo factor para la sede de
 * DESTINO exactamente igual que en el cierre de login: si la persona tiene el
 * 2FA puesto —en la sede que sea— o la clínica de destino lo exige, se siembra
 * el pendiente y se borra la cookie de "2FA superado", así que el panel manda
 * al reto al llegar. Si no, se limpian las dos.
 *
 * No se le pone el gate (seguiría exenta): esto es una SALIDA, y bloquearla
 * dejaría al dueño con varias sedes sin poder moverse entre ellas.
 */
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
  await applyTwoFactorLoginCookies(response, user.id, dbUser.clinicId);
  return response;
}
