import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { resetEduTeamMemberPassword } from "@/lib/edu/equipo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/equipo/[id]/restablecer — la dirección le pone una
 * contraseña temporal nueva a una persona del instituto (H-04).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE. El login del instituto promete «La dirección de tu
 * instituto da de alta las cuentas y restablece las contraseñas» y hasta
 * esta ola la segunda mitad era falsa: `equipo-core.ts` decía —y era
 * verdad— que había que restablecerla desde Supabase. Una tarde de 40 altas
 * y una contraseña apuntada mal dejaban a esa persona fuera hasta que
 * alguien con acceso al proyecto de Supabase la rescatara.
 *
 * 🔴 NO ES UN CAMINO NUEVO: es el mismo del alta. Temporal generada con el
 * mismo alfabeto (sin caracteres que se confundan al dictarlos) y
 * `mustChangePassword` encendida. Desde H-03 esa marca cierra también la
 * API, no solo las pantallas: quien recibe una temporal no puede firmar
 * nada hasta definir la suya.
 *
 * 🔴 La contraseña sale UNA vez, en el cuerpo de esta respuesta, y no se
 * guarda en ninguna parte. Es la misma decisión del alta y por lo mismo:
 * una temporal almacenada es una temporal que se filtra.
 *
 * 🔴 Necesita `equipo.manage` (como el alta y la baja) y, si la persona es
 * de DIRECCION, que quien llama TAMBIÉN lo sea — H-16.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    const res = await resetEduTeamMemberPassword(g.ctx, params.id);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/equipo/[id]/restablecer");
  }
}
