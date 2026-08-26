export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { assertBarberFeature, BarberPlanGateError } from "@/lib/barber/gating";
import { getBarberAffiliateSummary } from "@/lib/barber/affiliates";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import { AfiliadosScreen } from "@/components/barber/afiliados/afiliados-screen";
import "@/components/barber/afiliados/afiliados.css";

/**
 * /barber/afiliados — programa de socios.
 *
 * EL GATE ESTÁ AQUÍ, EN EL SERVIDOR, y otra vez en cada endpoint
 * (/api/barber/affiliates/_lib): ocultar el item del menú no es gating.
 * Se exige plan con la feature "affiliates" (Profesional, según
 * barber_plan_configs) Y suscripción al día — exactamente lo que hace
 * assertBarberFeature; el mensaje ya trae qué plan la incluye y su precio
 * leído de la tabla.
 *
 * Si las tablas del programa aún no existen, getBarberAffiliateSummary
 * devuelve blocker "SCHEMA_MISSING" y la pantalla lo explica; nada truena.
 */
export default async function BarberAfiliadosPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

  const locale = ctx.barbershop.locale;
  const t = getBarberT(locale);

  // Mismo permiso que la suscripción: es dinero de la barbería frente a
  // DaleControl. Sin él, ni se pinta ni las APIs contestan.
  const canView = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "billing.manage",
  );
  if (!canView) {
    return (
      <Locked
        title={t("barber.afiliados.title")}
        message={t("barber.suscripcion.hero.onlyOwner")}
      />
    );
  }

  try {
    await assertBarberFeature(ctx, "affiliates");
  } catch (err) {
    if (err instanceof BarberPlanGateError) {
      return (
        <Locked
          title={t("barber.afiliados.blocker.lockedTitle")}
          message={err.message}
          hint={t("barber.afiliados.blocker.lockedBody")}
          ctaHref="/barber/suscripcion"
          ctaLabel={t("barber.shell.nav.suscripcion")}
        />
      );
    }
    throw err;
  }

  const summary = await getBarberAffiliateSummary(ctx);

  return <AfiliadosScreen locale={locale} dict={getBarberDict(locale)} summary={summary} />;
}

/** Pantalla de "no puedes entrar aquí", con el camino claro a la salida. */
function Locked({
  title,
  message,
  hint,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  message: string;
  hint?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="dcba-root">
      <header className="dcba-header">
        <h1 className="dcba-title">{title}</h1>
      </header>
      <div className="dcba-alert" role="status">
        <Lock size={18} className="dcba-alert__icon" aria-hidden />
        <div>
          <p className="dcba-alert__title">{message}</p>
          {hint ? <p className="dcba-alert__body">{hint}</p> : null}
          {ctaHref && ctaLabel ? (
            <p style={{ marginTop: 10 }}>
              <Link className="dcba-btn dcba-btn--primary" href={ctaHref}>
                {ctaLabel}
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
