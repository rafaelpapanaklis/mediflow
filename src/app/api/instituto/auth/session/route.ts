import { NextResponse } from "next/server";
import { getEduContext } from "@/lib/edu-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * ¿La sesión de Supabase que trae este navegador es de un instituto?
 *
 * Lo consulta el login del vertical justo después de autenticar, para poder
 * decir "esta cuenta no es de aquí" en vez de rebotar en silencio contra
 * /instituto (la cookie de Supabase es una sola para todo el dominio, así
 * que una credencial de clínica autentica perfectamente y no pertenece a
 * ningún instituto).
 *
 * 🔴 Devuelve un booleano y NADA MÁS: ni el nombre del instituto, ni el
 * rol, ni el id. Es un endpoint sin permiso alguno — lo único que puede
 * revelar es lo que quien ya se autenticó sabe de sí mismo.
 *
 * 🔴 H-159 · Y AQUÍ SE ESCRIBE «ÚLTIMA ENTRADA». `EduUser.lastLogin` existía
 * en el schema desde la Ola 0, se LEÍA en cuatro sitios —la ficha del
 * docente, la lista de equipo— y no se escribía en ninguno: un grep en todo
 * el repo devolvía cero escrituras, así que la columna decía «nunca» para
 * todo el mundo y la ficha lo explicaba con una mentira de permisos.
 *
 * Se escribe AQUÍ y no en `getEduContext`, que es lo que parecería obvio:
 * ese helper corre en CADA render del panel (force-dynamic), así que
 * escribir ahí sería un UPDATE por pantalla pintada. Este endpoint lo llama
 * el login UNA vez, justo después de autenticar — que es exactamente lo que
 * la columna quiere decir.
 *
 * El try/catch NO es decoración: si la escritura falla, la persona entra
 * igual. Una columna de auditoría informativa no puede ser el motivo de que
 * alguien se quede en la puerta.
 */
export async function GET() {
  const ctx = await getEduContext();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    await prisma.eduUser.updateMany({
      where: { id: ctx.eduUserId, institutionId: ctx.institutionId },
      data: { lastLogin: new Date() },
    });
  } catch (err) {
    console.warn("[instituto/auth] no se pudo anotar la última entrada:", err);
  }

  return NextResponse.json({ ok: true });
}
