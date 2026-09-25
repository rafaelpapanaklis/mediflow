import { CheckCircle2, Loader2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { isPlanExpired } from "@/lib/plan-status";
import { ConfirmingPoll } from "./confirming-poll";
import { conversionPagoConfirmada } from "./conversion-pago.server";
import { ConversionPagoCompletadoGads } from "./conversion-pago-cliente";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";
import {
  CLASE_BOTON,
  CLASE_BOTON_PRINCIPAL,
  ResultadoPago,
} from "@/components/dashboard/cuenta-rediseno/suspendida";

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

  // "Activada" = exactamente lo contrario de lo que bloquea el gate
  // (isPlanExpired): suscripción viva O periodo por delante. Misma fuente que
  // el layout, sin recalcular la fecha a mano.
  const isActivated = !isPlanExpired(clinic);

  // CONVERSIÓN «Pago completado» de Google Ads (WS1-T3). Solo con la clínica ya
  // activada en la BD, y con Stripe confirmando server-to-server que ESA sesión
  // está pagada, es de ESTA clínica (clinicId de la sesión del usuario, no de la
  // URL) y es su primera contratación (metadata.firstContract del checkout). Si
  // algo no cuadra devuelve null y esta página se pinta exactamente igual. El
  // ping lo manda <ConversionPagoCompletadoGads/> una sola vez (marca local +
  // transaction_id); sin gtag o sin etiqueta, no hace nada.
  const conversion = await conversionPagoConfirmada({
    clinicId: user.clinicId,
    sessionId,
    activada: isActivated,
  });
  const conversionGads = conversion ? <ConversionPagoCompletadoGads {...conversion} /> : null;

  // REDISEÑO — mismo interruptor por clínica que el menú de dos niveles (ver
  // ../page.tsx): el layout completo ya lo pidió en este request, esto comparte
  // esa consulta o cae en su caché de 60 s. Falla cerrado → la pantalla de hoy.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);

  if (rediseno) {
    // Mismas dos caras, mismos textos y mismos botones que abajo. El enlace al
    // panel sigue siendo un <a> duro y «Volver a verificar» sigue siendo
    // <ConfirmingPoll/> (router.refresh, sin polling nuevo): solo cambia la ropa.
    return (
      <RaizCuenta>
        {conversionGads}
        <ResultadoPago
          activada={isActivated}
          titulo={isActivated ? t("pages.suspended.paymentConfirmedTitle") : t("pages.suspended.confirmingPaymentTitle")}
          texto={
            isActivated
              ? t("pages.suspended.paymentConfirmedDescription")
              : t("pages.suspended.confirmingPaymentDescription")
          }
          acciones={
            isActivated ? (
              <a href="/dashboard" className={CLASE_BOTON_PRINCIPAL}>
                {t("pages.suspended.goToDashboard")}
              </a>
            ) : (
              <>
                <ConfirmingPoll label={t("pages.suspended.checkAgain")} className={CLASE_BOTON_PRINCIPAL} />
                <a href="mailto:soporte@dalecontrol.com" className={CLASE_BOTON}>
                  {t("pages.suspended.contactSupport")}
                </a>
              </>
            )
          }
          referencia={sessionId ? `${t("pages.suspended.reference")} ${sessionId.slice(-12)}` : null}
        />
      </RaizCuenta>
    );
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      {conversionGads}
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
