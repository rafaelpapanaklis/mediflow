import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

/**
 * Estado de la sesión de Supabase vista desde el alta de afiliados. Lo usan las
 * páginas server /afiliados/registro y /afiliados/vincular para ofrecer el
 * camino corto a quien YA está dentro del sistema (viene del enlace en
 * Configuración del panel de su clínica, con sesión abierta).
 *
 * Sólo informa; no autoriza nada. El alta real la hace
 * POST /api/afiliados/auth/link, que vuelve a verificar la sesión en el
 * servidor. Nunca lanza: si no se puede resolver la sesión, se degrada al
 * formulario normal de registro.
 *
 * Nota: /afiliados/* no está en el matcher de src/middleware.ts, así que aquí
 * NO se refresca la cookie de Supabase. Con un access token vencido esto
 * devuelve `sessionEmail: null` y la persona simplemente escribe su contraseña
 * en /afiliados/vincular — el flujo sigue completo.
 */
export interface AffiliateLinkState {
  /** Correo de la sesión activa, o null si no hay sesión utilizable. */
  sessionEmail: string | null;
  /** Esa misma sesión ya tiene AffiliateUser (ya es afiliado). */
  alreadyAffiliate: boolean;
}

export async function getAffiliateLinkState(): Promise<AffiliateLinkState> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id || !user.email) return { sessionEmail: null, alreadyAffiliate: false };

    const au = await prisma.affiliateUser.findUnique({ where: { supabaseId: user.id } });
    return {
      sessionEmail: user.email.trim().toLowerCase(),
      alreadyAffiliate: !!au,
    };
  } catch {
    return { sessionEmail: null, alreadyAffiliate: false };
  }
}
