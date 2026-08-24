import { redirect } from "next/navigation";
import Link from "next/link";
import { Crown, Lock } from "lucide-react";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import {
  getMembershipStats,
  listClientMemberships,
  listMembershipPlans,
} from "@/lib/barber/memberships";
import {
  getBarberPaymentSettings,
  isBarberStripeConfigured,
  listDeposits,
} from "@/lib/barber/payments";
import { MembershipsPanel } from "@/components/barber/memberships/memberships-panel";

export const dynamic = "force-dynamic";

/**
 * /barber/membresias — membresías del cliente final y anticipos anti no-show.
 *
 * Los tres candados se resuelven AQUÍ, en el servidor: sesión de barbería →
 * feature del plan (memberships / deposits, ambas Avanzado+) → permiso del
 * rol. El cliente solo pinta lo que le llega.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  // ── Candado de plan ──────────────────────────────────────────────────
  if (plan.features.memberships !== true) {
    return (
      <GateCard
        icon={<Crown size={26} />}
        title={t("barber.membresias.locked.title")}
        body={t("barber.membresias.locked.body")}
        cta={{ href: "/barber/suscripcion", label: t("barber.membresias.locked.cta") }}
      />
    );
  }

  // ── Candado de permiso ───────────────────────────────────────────────
  if (!hasBarberPermission(permUser, "memberships.manage")) {
    return (
      <GateCard
        icon={<Lock size={26} />}
        title={t("barber.shell.nav.membresias")}
        body={t("barber.membresias.subtitle")}
      />
    );
  }

  const depositsFeature = plan.features.deposits === true;
  const canViewDeposits = depositsFeature && hasBarberPermission(permUser, "cash.view");
  const canManageDeposits = depositsFeature && hasBarberPermission(permUser, "cash.manage");
  const canEditPolicy = depositsFeature && hasBarberPermission(permUser, "settings.edit");

  const [plans, items, stats, settings, deposits] = await Promise.all([
    listMembershipPlans(ctx.barbershopId, { includeInactive: true }),
    listClientMemberships(ctx.barbershopId, { filter: "all" }),
    getMembershipStats(ctx.barbershopId),
    getBarberPaymentSettings(ctx.barbershopId),
    canViewDeposits ? listDeposits(ctx.barbershopId, { filter: "all" }) : Promise.resolve([]),
  ]);

  return (
    <MembershipsPanel
      messages={getBarberDict(ctx.barbershop.locale)}
      locale={ctx.barbershop.locale}
      initialPlans={plans}
      initialItems={items}
      initialStats={stats}
      initialDeposits={deposits}
      depositPolicy={settings.policy}
      storageReady={settings.storageReady}
      stripeConfigured={isBarberStripeConfigured()}
      depositsFeature={depositsFeature}
      canEditPolicy={canEditPolicy}
      canViewDeposits={canViewDeposits}
      canManageDeposits={canManageDeposits}
    />
  );
}

/** Tarjeta de "no puedes entrar aquí" (por plan o por permiso). */
function GateCard({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "clamp(16px, 3vw, 40px)" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(24px, 4vw, 40px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
          boxShadow: "var(--shadow-2)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--brand-grad, linear-gradient(135deg, #A2612F, #BE7A3C))",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            boxShadow: "var(--shadow-2)",
          }}
        >
          {icon}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: 0 }}>{body}</p>
        {cta ? (
          <Link
            href={cta.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 18px",
              borderRadius: 10,
              background: "var(--caramel-600)",
              border: "1px solid var(--caramel-700)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {cta.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
