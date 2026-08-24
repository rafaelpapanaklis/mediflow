import { CheckCircle2, Loader2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/plan-status";
import { ConfirmingPoll } from "./confirming-poll";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { session_id?: string };
}

/**
 * A donde vuelve Stripe tras el checkout con tarjeta (success_url de
 * /api/billing/checkout). Vive en el hueco entre el pago y el webhook
 * checkout.session.completed, que es el que activa la clínica: Stripe puede
 * redirigir aquí en milisegundos, antes de procesar el webhook, así que la
 * clínica sigue "vencida" en la BD. Por eso:
 *  - isAllowedWhileSuspended deja pasar /dashboard/suspended/* (si no, el
 *    layout rebotaba a "elige tu plan" y el usuario pagaba dos veces);
 *  - NUNCA se afirma "activo" sin leerlo de la BD; mientras no llegue, se
 *    muestra "estamos confirmando" y <ConfirmingPoll/> vuelve a preguntar
 *    cada pocos segundos (router.refresh) hasta que el webhook aterrice.
 */
export default async function SuspendedSuccessPage({ searchParams }: PageProps) {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  const clinic = user.clinic;
  const sessionId = searchParams?.session_id ?? null;

  const subscriptionStatus = (clinic as { subscriptionStatus?: string | null }).subscriptionStatus ?? null;
  const subscriptionActive =
    subscriptionStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const trialEndsAt = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const trialActive = !!trialEndsAt && trialEndsAt > new Date();
  const isActivated = subscriptionActive || trialActive;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      {isActivated ? (
        <>
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl"
            style={{
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "rgb(16, 185, 129)",
            }}
          >
            <CheckCircle2 size={40} aria-hidden />
          </div>
          <h1 className="mb-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            {t("pages.suspended.paymentConfirmedTitle")}
          </h1>
          <p className="mb-8 max-w-md text-base text-muted-foreground">
            {t("pages.suspended.paymentConfirmedDescription")}
          </p>
          {/* <a> duro y no <Link>: la navegación suave reutilizaría el árbol del
              layout calculado con la clínica aún "vencida" (redirect a
              /suspended → pantalla en blanco). Una carga completa vuelve a
              evaluar el plan con la BD ya activada. */}
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl px-8 py-4 text-base font-bold text-white shadow-lg transition hover:opacity-90"
            style={{
              background: "var(--brand)",
              boxShadow: "0 10px 30px -8px rgba(124, 58, 237, 0.4)",
            }}
          >
            {t("pages.suspended.goToDashboard")}
          </a>
        </>
      ) : (
        <>
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl"
            style={{
              background: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              color: "rgb(245, 158, 11)",
            }}
          >
            <Loader2 size={40} aria-hidden className="animate-spin" />
          </div>
          <h1 className="mb-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            {t("pages.suspended.confirmingPaymentTitle")}
          </h1>
          <p className="mb-8 max-w-md text-base text-muted-foreground">
            {t("pages.suspended.confirmingPaymentDescription")}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ConfirmingPoll label={t("pages.suspended.checkAgain")} />
            <a
              href="mailto:soporte@dalecontrol.com"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-3 text-base font-semibold text-foreground transition hover:bg-muted"
            >
              {t("pages.suspended.contactSupport")}
            </a>
          </div>
        </>
      )}
      {sessionId && (
        <div className="mt-10 text-[10px] uppercase tracking-wider text-muted-foreground">
          {t("pages.suspended.reference")} {sessionId.slice(-12)}
        </div>
      )}
    </div>
  );
}
