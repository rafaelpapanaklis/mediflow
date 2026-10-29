// Seguridad (auditoría «cloudflare», nº5): ¿la cuenta de acceso (Supabase Auth)
// de este miembro la usa TAMBIÉN alguien fuera de la autoridad de quien edita?
//
// La cuenta de Supabase es UNA para todo DaleControl. Cambiarle el correo o la
// contraseña desde Equipo le cambia el login también en:
//   · otra clínica donde esa persona trabaja (y donde puede tener más rol);
//   · el Instituto (edu), que entra sin segundo factor;
//   · su cuenta de afiliado, donde se cambian los datos de pago.
// Desde Equipo no se puede saber si esa persona quiere eso, así que si la
// cuenta se comparte, Equipo no toca el login: se le avisa al dueño y la
// persona lo cambia ella misma desde su cuenta.
//
// Las SEDES del propio dueño no cuentan como «otro lugar»: una sede donde quien
// edita es también SUPER_ADMIN activo está dentro de su autoridad (es el flujo
// de siempre: el dueño corrige el correo de un doctor que trabaja en sus sedes).
//
// Solo LEE `edu_users` y `affiliate_users`; no toca código del Instituto ni de
// afiliados.

import { prisma } from "@/lib/prisma";

type Db = any;

export type LugarCompartido = "otra-clinica" | "instituto" | "afiliado";

export interface CuentaCompartida {
  compartida: boolean;
  donde: LugarCompartido[];
}

export const MENSAJE_CUENTA_COMPARTIDA =
  "Esta persona usa la misma cuenta de acceso en otro lugar de DaleControl (otra clínica, el Instituto o su cuenta de afiliado). " +
  "Para no cambiarle el acceso allí sin que lo sepa, el correo y la contraseña no se cambian desde Equipo: que los cambie ella desde su propia cuenta.";

/**
 * @param supabaseId  la cuenta del miembro.
 * @param clinicId    la clínica de la SESIÓN.
 * @param actorUserId el usuario de la SESIÓN que edita (sus sedes como dueño no cuentan como «otro lugar»).
 */
export async function cuentaCompartidaFueraDeLaClinica(
  args: { supabaseId: string; clinicId: string; actorUserId: string },
  db: Db = prisma,
): Promise<CuentaCompartida> {
  const { supabaseId, clinicId, actorUserId } = args;
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  if (!supabaseId) return { compartida: false, donde: [] };

  // Las clínicas donde quien edita es dueño activo (sus sedes), más la de la sesión.
  const actor = await db.user.findFirst({
    where: { id: actorUserId, clinicId },
    select: { supabaseId: true },
  });
  const comoDueno = actor?.supabaseId
    ? await db.user.findMany({
        where: { supabaseId: actor.supabaseId, role: "SUPER_ADMIN", isActive: true },
        select: { clinicId: true },
      })
    : [];
  const propias = Array.from(new Set<string>([clinicId, ...comoDueno.map((f: { clinicId: string }) => f.clinicId)]));

  const [fuera, edu, afiliado] = await Promise.all([
    db.user.findFirst({ where: { supabaseId, clinicId: { notIn: propias } }, select: { id: true } }),
    db.eduUser.findFirst({ where: { supabaseId }, select: { id: true } }),
    db.affiliateUser.findFirst({ where: { supabaseId }, select: { id: true } }),
  ]);
  const donde: LugarCompartido[] = [];
  if (fuera) donde.push("otra-clinica");
  if (edu) donde.push("instituto");
  if (afiliado) donde.push("afiliado");
  return { compartida: donde.length > 0, donde };
}
