import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { MIEMBRO_SELECT, camposPublicosDeMiembro } from "@/lib/team/member-fields";

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
  const body = await req.json();
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
    data: { firstName: body.firstName, lastName: body.lastName, phone: body.phone || undefined, specialty: body.specialty || undefined },
    select: MIEMBRO_SELECT,
  });
  revalidateAfter("clinic");
  return NextResponse.json(camposPublicosDeMiembro(updated));
}
