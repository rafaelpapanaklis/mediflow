import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { MIEMBRO_SELECT, camposPublicosDeMiembro } from "@/lib/team/member-fields";
import { leerCambiosPropios, textosMiPerfil } from "@/lib/team/mis-datos-profesionales";
import { logMutation } from "@/lib/audit";

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí (Supabase + prisma a
// mano), pero pasando por los gates de 2FA y de plan vencido que la copia se
// saltaba. ctx.user es la fila User con permissionsOverride normalizado, así
// que sirve tal cual para denyIfMissingPermission.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

export async function PATCH(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  // Solo los campos de «Mi perfil» (nombre, teléfono, especialidad y los datos NOM-024: cédula, especialidad
  // oficial, cédula de especialidad), y siempre sobre la fila de la sesión. Rol, permisos, estado y correo no
  // viajan por aquí (ws1-t1: un DOCTOR corrige su cédula sin poder tocar nada más).
  const cambios = leerCambiosPropios(body);
  if (!cambios.ok) {
    return NextResponse.json(
      { error: textosMiPerfil("es").errores[cambios.motivo], campo: cambios.campo },
      { status: 400 },
    );
  }
  // La respuesta sale por la LISTA BLANCA de @/lib/team/member-fields, la misma
  // que cerró EQ-05 en /api/team/[id]. El `update` iba sin `select` y devolvía
  // la fila ENTERA: totpSecret en base32 EN CLARO, recoveryCodes, cajaPinHash,
  // googleRefreshToken / googleCalendarToken y stripeAccountId. Y esta ruta es
  // la que llama el "Guardar" de Ajustes, así que le pasó a todo el que guardó
  // su perfil. Van las dos formas de la misma lista: `select` para que el
  // secreto no salga de Postgres, y la proyección encima para que la forma de
  // la respuesta siga siendo la lista blanca aunque mañana alguien vuelva a
  // necesitar aquí la fila completa (como le pasa al PATCH de team, que la usa
  // para la bitácora).
  const updated = await prisma.user.update({
    where: { id: dbUser.id },
    data: cambios.data,
    select: MIEMBRO_SELECT,
  });
  // Bitácora: quién cambió sus propios datos profesionales y de qué a qué.
  const antes: Record<string, unknown> = {};
  for (const k of Object.keys(cambios.data)) antes[k] = (dbUser as Record<string, unknown>)[k] ?? null;
  await logMutation({
    req,
    clinicId: dbUser.clinicId,
    userId: dbUser.id,
    entityType: "user",
    entityId: dbUser.id,
    action: "update",
    before: antes,
    after: cambios.data,
  });
  revalidateAfter("clinic");
  revalidateAfter("team");
  return NextResponse.json(camposPublicosDeMiembro(updated));
}
