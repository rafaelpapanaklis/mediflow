import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { writeActiveClinicCookie } from "@/lib/active-clinic";
import { applyTwoFactorLoginCookies } from "@/lib/auth/two-factor-cookie";
import { estadoGateSede } from "@/lib/sede-clave/gate.server";
import { CODIGO_SEDE_CON_CLAVE, STATUS_SEDE_CON_CLAVE } from "@/lib/sede-clave/constantes";

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
 *
 * ws1-t4 — «Clave de la sede»: si la sede de DESTINO tiene clave y esta persona
 * no la ha tecleado en este navegador (o caducó, o cambió), NO se cambia la
 * sede activa: 423 con código, y el selector manda a la pantalla de la clave
 * (/dashboard/sede-con-clave?sede=…), que la desbloquea y entonces cambia.
 * Vale también para el SUPER_ADMIN.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clinicId } = await req.json().catch(() => ({}));
  // Un id de verdad es texto: un objeto aquí se volvería un filtro de Prisma.
  if (!clinicId || typeof clinicId !== "string") return NextResponse.json({ error: "clinicId required" }, { status: 400 });

  const dbUser = await prisma.user.findFirst({
    where: { supabaseId: user.id, clinicId, isActive: true, clinic: { archivedAt: null } },
    select: { id: true, clinicId: true },
  });
  if (!dbUser) return NextResponse.json({ error: "No access to this clinic" }, { status: 403 });

  const gate = await estadoGateSede({ supabaseId: user.id, clinicId: dbUser.clinicId });
  if (gate === "sin_comprobar") {
    // v2 (A1): la base no dejó comprobar ni la lista ni la fila de esa sede. No
    // se cambia de sede, y se dice lo que pasa (no «tiene clave»).
    return NextResponse.json(
      { error: "No pudimos comprobar la clave de la sede. Recarga e inténtalo de nuevo.", code: "sede_sin_comprobar" },
      { status: 503 },
    );
  }
  if (gate === "cerrada") {
    return NextResponse.json(
      { error: "Esta sede tiene clave. Escríbela para entrar.", code: CODIGO_SEDE_CON_CLAVE, clinicId: dbUser.clinicId },
      { status: STATUS_SEDE_CON_CLAVE },
    );
  }

  const response = NextResponse.json({ success: true, clinicId: dbUser.clinicId });
  writeActiveClinicCookie(response, dbUser.clinicId);
  await applyTwoFactorLoginCookies(response, user.id, dbUser.clinicId);
  return response;
}
