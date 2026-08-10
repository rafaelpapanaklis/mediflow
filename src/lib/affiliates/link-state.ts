import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { normalizeInviteCode } from "@/lib/affiliates/invites";

/**
 * Lo que las dos pantallas de alta (/afiliados/registro y /afiliados/vincular)
 * necesitan saber ANTES de pintar el formulario: si hay sesión abierta y si la
 * visita trae una invitación de otro afiliado.
 *
 * Estado de la sesión de Supabase vista desde el alta de afiliados. Sirve para
 * ofrecer el camino corto a quien YA está dentro del sistema (viene del enlace
 * en Configuración del panel de su clínica, con sesión abierta).
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

/** La invitación que trae la URL (`?inv=<referralCode>`), ya verificada. */
export interface InvitePreview {
  /** Código normalizado. Viaja al POST del alta y a los enlaces de la pantalla. */
  code: string;
  /** Nombre del afiliado que invita — lo único que se muestra de él. */
  name: string;
}

/**
 * ¿A quién le pertenece el `?inv=` de la URL? Sólo para PINTAR el aviso.
 *
 * No autoriza nada y no escribe nada: el vínculo real lo decide
 * `resolveInviterId` (@/lib/affiliates/invites) dentro del POST del alta, con
 * el correo ya normalizado. Aquí se replican sus dos condiciones visibles
 * —código válido e invitador APPROVED— más el descarte de la auto-invitación
 * cuando ya se conoce el correo de la sesión, para no prometer en pantalla un
 * vínculo que el servidor va a descartar.
 *
 * Nunca lanza: sin invitación reconocible se devuelve null y la pantalla se
 * pinta igual, sin aviso y sin bloquear el registro.
 */
export async function getInvitePreview(
  raw: unknown,
  selfEmail?: string | null,
): Promise<InvitePreview | null> {
  const code = normalizeInviteCode(raw);
  if (!code) return null;
  try {
    const inviter = await prisma.affiliate.findUnique({
      where: { referralCode: code },
      select: { name: true, email: true, status: true },
    });
    if (!inviter || inviter.status !== "APPROVED") return null;
    const self = (selfEmail ?? "").trim().toLowerCase();
    if (self && inviter.email && inviter.email.trim().toLowerCase() === self) return null;
    return { code, name: inviter.name };
  } catch {
    return null;
  }
}
