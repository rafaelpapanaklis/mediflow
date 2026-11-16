import "server-only";
import { prisma } from "@/lib/prisma";
import { hasBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { barberWaChatAcceso, BARBER_WA_CHAT_SIN_ACCESO, type BarberWaChatAcceso } from "./wa-chat-core";

type Ctx = BarberContext;
type Plan = Parameters<typeof barberPlanHasFeature>[0];

/**
 * ¿Los botones «WhatsApp» de un cliente abren Mensajes? Lo resuelve el layout
 * del panel UNA vez por página. Barato a propósito: dos columnas de la
 * barbería y nada más (sin preguntarle a Meta; eso es de /barber/whatsapp).
 * Si la consulta falla, wa.me: un botón que lleva afuera es mejor que uno
 * muerto.
 */
export async function getBarberWaChatAcceso(
  ctx: Ctx,
  plan: Plan,
  paid: boolean,
): Promise<BarberWaChatAcceso> {
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const canView = hasBarberPermission(permUser, "whatsapp.view");
  const planInbox = barberPlanHasFeature(plan, "whatsappInbox");
  if (!paid || !canView || !planInbox || !ctx.barbershopId) return BARBER_WA_CHAT_SIN_ACCESO;

  try {
    const shop = await prisma.barbershop.findUnique({
      where: { id: ctx.barbershopId },
      select: { phoneNumberId: true, whatsappToken: true },
    });
    return barberWaChatAcceso({
      paid,
      planInbox,
      canView,
      canSend: hasBarberPermission(permUser, "whatsapp.send"),
      credenciales: Boolean(shop?.phoneNumberId && shop?.whatsappToken),
    });
  } catch (err) {
    console.error("[barber wa-chat] acceso", err);
    return BARBER_WA_CHAT_SIN_ACCESO;
  }
}
