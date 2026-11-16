// ═══════════════════════════════════════════════════════════════════════
// /barber/agenda — la pantalla que la barbería tiene abierta todo el día.
//
// El gate REAL vive en el servidor (aquí y en cada endpoint), no en el
// sidebar: esconder un botón no es un permiso.
//
// Trae también lo que hace falta para COBRAR desde aquí: el sub-diccionario
// de la caja y si el plan la incluye. El cobro en sí no se reimplementa —
// se monta el mismo modal de ticket de /barber/caja (ver charge-bridge), y
// por eso hay que cargar su hoja de estilos, igual que hace esa pantalla.
// ═══════════════════════════════════════════════════════════════════════
import "@/components/barber/cash/money.css";
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { agendaViewScope, scopeUserFromCtx } from "@/lib/barber/own-visits";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { shopDateISO } from "@/lib/barber/agenda";
import { AgendaClient } from "@/components/barber/agenda/agenda-client";
import { barberCanSeeClient } from "@/lib/barber/clients";
import { prisma } from "@/lib/prisma";
import { BarberAreaLocked } from "@/components/barber/agenda/area-locked";

export const dynamic = "force-dynamic";

/** El «Su barbero» de la ficha (preferences.favoriteBarberId), si lo tiene. */
function favoriteBarberIdOf(preferences: unknown): string | null {
  if (!preferences || typeof preferences !== "object") return null;
  const v = (preferences as Record<string, unknown>).favoriteBarberId;
  return typeof v === "string" && v ? v : null;
}

export default async function BarberAgendaPage(props: {
  searchParams: Promise<{ fecha?: string | string[]; visita?: string | string[]; nueva?: string | string[] }>;
}) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  // Desde Inicio: ?fecha=2026-11-15&visita=<id> abre ese día con la visita
  // resaltada. Se lee DESPUÉS del candado (candado-suscripcion).
  const { fecha, visita, nueva } = await props.searchParams;
  const fechaValida = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;

  const dict = getBarberDict(ctx.barbershop.locale);
  const plan = await getBarberPlan(ctx.barbershop.plan);

  if (!barberPlanHasFeature(plan, "agenda")) {
    return <BarberAreaLocked reason="plan" areaKey="agenda" planName={plan.name} />;
  }
  if (!hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "agenda.view",
  )) {
    return <BarberAreaLocked reason="permission" areaKey="agenda" />;
  }
  // Rol Barbero sin su ficha ligada: no ve la agenda de nadie (la API
  // tampoco se la da) y se le dice qué hacer.
  if (agendaViewScope(scopeUserFromCtx(ctx)).kind === "none") {
    return <BarberAreaLocked reason="unlinked" areaKey="agenda" />;
  }

  // Desde la ficha del cliente o Mensajes: ?nueva=<clientId> abre «Nueva
  // visita» con ese cliente ya puesto (y su barbero de siempre). Solo si
  // quien entra puede crear citas y VER a ese cliente: misma barbería de la
  // sesión y el mismo recorte por rol que su ficha. Si no, la agenda abre
  // normal, sin decir si el cliente existe.
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const nuevaId = typeof nueva === "string" ? nueva.trim() : "";
  const newFor =
    nuevaId &&
    hasBarberPermission(permUser, "agenda.edit") &&
    hasBarberPermission(permUser, "clients.view") &&
    (await barberCanSeeClient(ctx, nuevaId))
      ? await prisma.barberClient
          .findFirst({
            where: { id: nuevaId, barbershopId: ctx.barbershopId },
            select: { id: true, name: true, phone: true, preferences: true },
          })
          .then((c) =>
            c
              ? {
                  clientId: c.id,
                  clientName: c.name,
                  clientPhone: c.phone,
                  barberId: favoriteBarberIdOf(c.preferences),
                }
              : null,
          )
      : null;

  return (
    <AgendaClient
      newFor={newFor}
      dict={dict}
      cajaDict={(dict.barber as Dictionary).caja as Dictionary}
      starsDict={((dict.barber as Dictionary).estrellas ?? {}) as Dictionary}
      locale={ctx.barbershop.locale}
      timezone={ctx.barbershop.timezone}
      branchId={ctx.barbershopId}
      initialDateISO={fechaValida ?? shopDateISO(new Date(), ctx.barbershop.timezone)}
      highlightId={typeof visita === "string" && visita ? visita : null}
      cashEnabled={barberPlanHasFeature(plan, "cash")}
    />
  );
}
