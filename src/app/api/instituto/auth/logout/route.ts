import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEduContext } from "@/lib/edu-auth";
import { eduAudit, eduAuditRequestMeta } from "@/lib/edu/auditoria";

export const dynamic = "force-dynamic";

/**
 * Cierra la sesión Supabase del usuario de instituto (espejo de
 * /api/barber/auth/logout). El shell redirige después a /instituto/login,
 * que es el login DEDICADO del vertical — no el compartido.
 *
 * 🔴 Y DEJA RENGLÓN. La bitácora no registraba ni la entrada ni la salida, y
 * son las dos preguntas con las que empieza cualquier investigación: en un
 * panel que se usa en equipo compartido, «cerró sesión» y «se fue dejándola
 * abierta» son dos respuestas muy distintas a la misma pregunta.
 *
 * El orden importa: PRIMERO se lee quién es —después del `signOut` la sesión
 * ya no existe y el renglón no sabría a quién atribuirse— y el renglón se
 * escribe antes de cerrar. `eduAudit` nunca lanza, así que un fallo de
 * bitácora no puede dejar a nadie sin poder salir; y si no hay contexto
 * (la sesión ya había caducado) simplemente no hay nada que registrar.
 */
export async function POST(request: Request) {
  const ctx = await getEduContext();

  if (ctx) {
    await eduAudit(ctx, {
      action: "logout",
      entity: "session",
      entityId: ctx.eduUserId,
      after: { salio: new Date() },
      ...eduAuditRequestMeta(request),
    });
  }

  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
