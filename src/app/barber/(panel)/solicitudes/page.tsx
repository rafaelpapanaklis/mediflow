import { redirect } from "next/navigation";
import { getAccessibleBranchIds, getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { listBookingRequests, resolveBookingPolicy } from "@/lib/barber/booking";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { SolicitudesClient } from "./solicitudes-client";

/* ═══════════════════════════════════════════════════════════════════════
   /barber/solicitudes — la bandeja de la reserva pública.

   Tres puertas, en este orden: sesión de barbería, feature del plan
   (publicBooking) y permiso del rol (requests.manage). El sidebar ya oculta
   el item cuando falta alguna, pero entrar por la URL directa tiene que
   toparse con lo mismo.

   Multisucursal: las sedes salen de getAccessibleBranchIds(ctx) — punto
   único del vertical. Nunca de la query.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function SolicitudesPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

  const t = getBarberT(ctx.barbershop.locale);
  const plan = await getBarberPlan(ctx.barbershop.plan);

  if (plan.features.publicBooking !== true) {
    return <Aviso texto={t("barber.reserva.cerrado.body")} />;
  }
  if (!hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "requests.manage",
  )) {
    return <Aviso texto={t("barber.reserva.solicitudes.sinPermiso")} />;
  }

  const barbershopIds = await getAccessibleBranchIds(ctx);
  const [pendientes, resueltas, policy] = await Promise.all([
    listBookingRequests({ barbershopIds, scope: "pendientes" }),
    listBookingRequests({ barbershopIds, scope: "resueltas", limit: 40 }),
    resolveBookingPolicy(ctx.barbershopId),
  ]);

  return (
    <SolicitudesClient
      locale={ctx.barbershop.locale}
      timezone={ctx.barbershop.timezone}
      policy={policy}
      bookingPath={`/b/${ctx.barbershop.slug}/reservar`}
      showBranch={barbershopIds.length > 1}
      pendientes={pendientes}
      resueltas={resueltas}
    />
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div style={{ minHeight: "50vh", display: "grid", placeItems: "center", padding: 24 }}>
      <p
        style={{
          maxWidth: 420,
          textAlign: "center",
          fontSize: 14,
          color: "var(--text-2)",
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          padding: 24,
          margin: 0,
        }}
      >
        {texto}
      </p>
    </div>
  );
}
