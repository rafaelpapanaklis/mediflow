import { notFound, redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getBarberClientDetail } from "@/lib/barber/loyalty";
import { getStaffStarsView } from "@/lib/barber/stars";
import { listClientSales } from "@/lib/barber/client-sales";
import { barberCanSeeClient, barberClientScopeWhere } from "@/lib/barber/clients";
import { clientsViewScope, scopeUserFromCtx } from "@/lib/barber/own-visits";
import { BarberClientDetailScreen } from "@/components/barber/clients/client-detail";

export const dynamic = "force-dynamic";

/**
 * /barber/clientes/[id] — la ficha.
 *
 * getBarberClientDetail filtra por el barbershopId de la SESIÓN, así que un
 * id de otra barbería no devuelve nada y esto cae en notFound(). Desde
 * fuera, "ajeno" y "no existe" se ven exactamente igual: la URL no revela
 * ni siquiera que la ficha exista.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = ((getBarberDict(locale).barber as Dictionary).clientes ?? {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const plan = await getBarberPlan(ctx.barbershop.plan);

  // Rol Barbero: solo la ficha de SUS clientes (G1). La de otro → «Sin acceso».
  const noAccess =
    plan.features.clients !== true || !hasBarberPermission(permUser, "clients.view")
      ? t("barber.clientes.errors.noPermission")
      : clientsViewScope(scopeUserFromCtx(ctx)).kind === "none"
        ? t("barber.clientes.errors.notLinked")
        : barberClientScopeWhere(ctx) && !(await barberCanSeeClient(ctx, params.id))
          ? t("barber.clientes.errors.notYourClient")
          : null;
  if (noAccess) {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: "12vh auto 0",
          padding: "clamp(20px, 4vw, 32px)",
          borderRadius: 16,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          textAlign: "center",
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-2)",
        }}
      >
        {noAccess}
      </div>
    );
  }

  const detail = await getBarberClientDetail(ctx, params.id);
  if (!detail) notFound();
  // Tarjeta de estrellas (si fallara la lectura, la ficha cae a la de sellos).
  const stars = await getStaffStarsView(ctx, params.id).catch((e) => {
    console.warn("[barber/clientes] no se pudo leer la tarjeta de estrellas:", (e as Error).message);
    return null;
  });
  const starsDict = ((getBarberDict(locale).barber as Dictionary).estrellas ?? {}) as Dictionary;
  // Cobros del cliente (sus tickets de Caja). Sin permiso, la sección no sale.
  const sales = await listClientSales(ctx, params.id).catch((e) => {
    console.warn("[barber/clientes] no se pudieron leer los cobros:", (e as Error).message);
    return null;
  });
  const cobrosDict = ((getBarberDict(locale).barber as Dictionary).cobros ?? {}) as Dictionary;

  return (
    <BarberClientDetailScreen
      dict={dict}
      locale={locale}
      detail={detail}
      canEdit={hasBarberPermission(permUser, "clients.edit")}
      canPublish={hasBarberPermission(permUser, "portal.manage")}
      stars={stars}
      starsDict={starsDict}
      canHandleStars={hasBarberPermission(permUser, "cash.manage")}
      timezone={ctx.barbershop.timezone || "America/Mexico_City"}
      sales={sales?.allowed ? sales : null}
      cobrosDict={cobrosDict}
      canPrintSales={hasBarberPermission(permUser, "cash.view")}
    />
  );
}
