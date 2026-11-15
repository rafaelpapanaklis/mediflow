import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { vencerSiTocaBarber } from "@/lib/barber/cobros";

/**
 * DaleControl BARBER — CANDADO DE ACCESO AL PANEL. Una sola regla, un solo
 * archivo.
 *
 * EL BUG QUE CIERRA: una barbería en "pending_payment" aterrizaba en
 * /barber/suscripcion… con el menú completo al lado. Un clic en Agenda,
 * Clientes o Caja y estaba dentro trabajando sin haber pagado nunca. El
 * candado vivía en DOS pantallas sueltas (src/app/barber/page.tsx, que es
 * solo el router, y /barber/inicio); las otras veinticuatro nacieron gratis.
 *
 * POR QUÉ NO SE COPIA EL GATE DEL LAYOUT DENTAL: aquél lee el header
 * x-pathname que pone src/middleware.ts, y el middleware NO cubre /barber
 * (su matcher es dashboard, admin, api, proveedores). Sin ese header el
 * layout no sabe en qué ruta está y no puede indultar /barber/suscripcion:
 * cortar ahí sería un bucle infinito contra la pantalla donde se paga.
 * Por eso el candado es POR PÁGINA y la prueba estática
 * src/lib/barber/__tests__/candado-suscripcion.test.ts obliga a que la
 * próxima pantalla que alguien agregue lo llame.
 *
 * POR QUÉ MÓDULO APARTE DE gating.ts: gating.ts lo importan las rutas de
 * API, y redirect() lanza NEXT_REDIRECT — dentro de un endpoint eso no
 * redirige a nadie: revienta la petición con un error opaco. Aquí vive lo
 * que solo pueden usar páginas y layouts (Server Components).
 *
 * QUIÉN PAGA: la MATRIZ (parentId null), igual que loadRootShop en
 * gating.ts. Una sucursal hereda el estado de su cadena — el webhook de
 * suscripción lo propaga a la familia, pero la fila que manda es la raíz.
 * El `isActive` en cambio se mira sobre la sede de la SESIÓN: una sucursal
 * apagada no trabaja aunque su matriz esté al corriente.
 *
 * SIN DÍAS DE GRACIA (decisión #10 de Rafael, 15-nov-2026): además del
 * estado, al entrar se mira la FECHA. Si la matriz sigue «al corriente» pero
 * su último periodo pagado terminó antes de hoy (día de México), se suspende
 * en ese momento (past_due en la matriz y sus sucursales, para que lo público
 * se apague también) y el panel se cierra. No espera a Stripe ni al cron.
 * Ver src/lib/barber/cobros-core.ts (barberiaVencida).
 */

/** A dónde va quien no ha pagado. Es también la ÚNICA página exenta por bucle. */
export const BARBER_PAID_REDIRECT = "/barber/suscripcion";

/** Estado de suscripción de la fila que paga (la matriz de la cadena). */
async function rootSubscriptionStatus(ctx: BarberContext): Promise<{ rootId: string; status: string }> {
  const rootId = ctx.barbershop.parentId ?? ctx.barbershopId;
  if (rootId === ctx.barbershopId) return { rootId, status: ctx.barbershop.subscriptionStatus };

  const root = await prisma.barbershop.findUnique({
    where: { id: rootId },
    select: { subscriptionStatus: true },
  });
  // Matriz borrada/inexistente: la sucursal se evalúa con su propia fila
  // (que el webhook mantiene sincronizada) antes que abrir la puerta.
  return { rootId, status: root?.subscriptionStatus ?? ctx.barbershop.subscriptionStatus };
}

/**
 * ¿El periodo pagado de la matriz ya venció? Si sí, la deja suspendida. Un
 * fallo al leer el registro NO cierra el panel (lo deja en el log): el cron de
 * barber vuelve a pasar cada 5 minutos y corta lo vencido.
 */
async function vencidaAlEntrar(rootId: string, status: string): Promise<boolean> {
  try {
    return await vencerSiTocaBarber(rootId, status);
  } catch (e) {
    console.error("[barber paid-access] no se pudo revisar el periodo pagado:", e);
    return false;
  }
}

/**
 * ¿Esta sesión puede USAR el panel? Sede activa Y suscripción de la matriz
 * al día (active | trialing | paid). No redirige: lo usa el layout para
 * decidir qué menú pintar.
 */
export async function hasBarberPaidAccess(ctx: BarberContext): Promise<boolean> {
  // Sede cerrada = la PROPIA de la persona (su lugar de trabajo). El dueño que
  // elige una sucursal cerrada no la opera (withActiveBranch no la adopta,
  // ronda 2 M1): se queda en su sede, sin quedar encerrado en Suscripción.
  if (!(ctx.homeBarbershop ?? ctx.barbershop).isActive) return false;
  const { rootId, status } = await rootSubscriptionStatus(ctx);
  if (!isBarbershopSubscriptionActive({ subscriptionStatus: status })) return false;
  return !(await vencidaAlEntrar(rootId, status));
}

/**
 * Candado de PÁGINA: sin acceso pagado, a /barber/suscripcion. Va como
 * primera línea de cada page.tsx del panel, justo después del guard de
 * sesión:
 *
 *   const ctx = await getBarberContext();
 *   if (!ctx) redirect("/login");
 *   await requireBarberPaidAccess(ctx);
 *
 * Excepciones (y son las únicas, escritas también en la prueba):
 *   · /barber/suscripcion — ahí se paga; bloquearla es un bucle infinito.
 *   · /barber/soporte     — una barbería impaga tiene que poder pedir ayuda.
 *
 * Lanza NEXT_REDIRECT: NO la envuelvas en un try/catch que se lo trague.
 */
export async function requireBarberPaidAccess(ctx: BarberContext): Promise<void> {
  if (await hasBarberPaidAccess(ctx)) return;
  redirect(BARBER_PAID_REDIRECT);
}
