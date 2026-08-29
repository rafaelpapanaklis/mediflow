export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduCorte } from "@/lib/edu/caja";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduCorteScreen } from "@/components/edu/dinero/corte-screen";

export const metadata: Metadata = {
  title: "Corte de caja · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/caja/corte — el corte del TURNO.
 *
 * 🔴 La ventana va de la apertura a ahora, no de medianoche a medianoche.
 * Las fechas se formatean AQUÍ, en el servidor y en la zona del instituto:
 * formatearlas en el cliente pintaría la zona del navegador y rompería la
 * hidratación con un texto distinto en cada máquina.
 */
export default async function InstitutoCortePage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "caja.view")) {
    return (
      <EduDenied
        permission="caja.view"
        what="El corte de caja: cuánto entró en el turno, por qué método, y si el cajón cuadra."
      />
    );
  }

  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Corte de caja</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
    );
  }

  const canCorte = hasEduPermission(permUser, "caja.corte");
  const zona = eduSafeTimeZone(ctx.institution.timezone);
  const corte = await getEduCorte(ctx, ctx.institution.timezone);

  const fmt = new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const labels = {
    openedAt: corte.session ? fmt.format(new Date(corte.session.openedAt)) : null,
    previous: Object.fromEntries(
      corte.previous.map((s) => [
        s.id,
        {
          openedAt: fmt.format(new Date(s.openedAt)),
          closedAt: s.closedAt ? fmt.format(new Date(s.closedAt)) : "—",
        },
      ]),
    ),
  };

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Corte de caja</h1>
          <p className="edu-page__lead">
            Es el corte del <strong>turno</strong>, no el del día: la ventana va de la apertura
            hasta ahora. Si el turno lleva varios días abierto, esta pantalla te lo dice.
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link href="/instituto/caja" className="edu-btn edu-btn--ghost edu-btn--sm">
            Volver a Caja
          </Link>
        </div>
      </header>

      <EduCorteScreen corte={corte} labels={labels} canCorte={canCorte} />
    </div>
  );
}
