import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { isPlanId, type PlanId } from "@/lib/billing/plans";
import { getResolvedPlans } from "@/lib/plans";
import { applyClinicOverrides } from "@/lib/billing/plan-overrides";
import { isFirstContract } from "@/lib/billing/first-month-promo";
import { SuspendedPlanCards, type PlanCardData } from "./suspended-client";
import { localeFromClinic, serverTForLocale } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";
import {
  CabeceraSuspendida,
  PaginaSuspendida,
  VolverAlLogin,
} from "@/components/dashboard/cuenta-rediseno/suspendida";

export const dynamic = "force-dynamic";

export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: { pending?: string };
}) {
  // Vuelta de un Checkout SPEI/OXXO (asíncrono): el pago aún no se acredita.
  const pending = searchParams?.pending;
  const showPending = pending === "spei" || pending === "oxxo";

  // Sesión y catálogo de planes son INDEPENDIENTES: una sola ronda en paralelo
  // en vez de dos awaits en serie. getCurrentUser() puede hacer redirect()
  // (onboarding / proveedores / laboratorios) y eso SIGUE funcionando dentro del
  // Promise.all: redirect() lanza NEXT_REDIRECT, Promise.all propaga el primer
  // rechazo y el await de aquí lo re-lanza, que es justo lo que Next intercepta.
  const [user, resolvedPlans] = await Promise.all([
    getCurrentUser(),
    getResolvedPlans(),
  ]);

  // El plan PROPIO de la clínica sale con lo que conserva (si es de antes de los
  // planes de sep-2026), porque es lo que /api/billing/checkout le cobrará al
  // reactivarlo; los demás, con las condiciones vigentes.
  const planCards: PlanCardData[] = resolvedPlans.map((plan) => applyClinicOverrides(plan, user.clinic)).map((p) => ({
    id: p.id,
    name: p.name,
    priceMxn: p.priceMxn,
    priceMxnAnnual: p.priceMxnAnnual,
    features: [...p.features],
    cfdiMonthly: p.cfdiMonthly,
    cfdiOverageCents: p.cfdiOverageCents,
  }));

  // Plan elegido en el registro (Clinic.plan): preselección + base del upsell.
  // La clínica YA viene con la sesión (getCurrentUser usa include:{clinic:true}),
  // así que plan / subscriptionStatus / los tres campos de la promo salen de ahí
  // SIN una segunda consulta.
  const clinic = user.clinic;
  // t con la clínica en mano: getServerT() volvería a resolver la sesión para
  // sacar el locale. Este atajo es síncrono y no añade await al camino crítico.
  const { t } = serverTForLocale(localeFromClinic(clinic));
  const currentPlan: PlanId | null = isPlanId(clinic.plan) ? clinic.plan : null;
  // Promo 1er mes: solo PRIMERA contratación (el checkout re-valida server-side).
  const firstMonthEligible = isFirstContract(clinic);

  // Copy adaptativo según el estado de la cuenta:
  //  - Reactivación = cuenta que YA tuvo acceso y se pausó por un pago
  //    pendiente (past_due / cancelled / unpaid) → tono "reactiva tu plan".
  //  - Cualquier otro caso (pending_payment o sin estado) = compra nueva
  //    recién creada en el wizard → tono "último paso", SIN "bloqueado".
  const status = clinic.subscriptionStatus ?? null;
  const isReactivation = !!status && ["past_due", "cancelled", "unpaid"].includes(status);
  const pillText = isReactivation ? "Tu panel está en pausa" : "Último paso";
  const heading = isReactivation ? "Reactiva tu plan" : "Último paso: activa tu cuenta";
  const subcopy = isReactivation
    ? "Tu acceso se pausó por un pago pendiente. Reactívalo para continuar."
    : "Elige cómo pagar tu plan y empieza a usar DaleControl. Pago seguro con tarjeta, SPEI u OXXO.";

  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno propio.
  // Esta pantalla cuelga del layout completo, que ya lo pidió para esta misma
  // clínica en este mismo request: la lectura de aquí comparte esa consulta en
  // vuelo o cae en la caché de 60 s del interruptor. No es un viaje más a la
  // base. Falla cerrado: apagado, sin tabla o con error → la pantalla de hoy.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);

  if (rediseno) {
    // Mismos textos, mismo orden y mismos elementos que abajo: aviso de pago
    // pendiente, píldora + título + texto, las tres tarjetas con su pago
    // (misma lógica: SuspendedPlanCards con `rediseno`), y la vuelta al login.
    return (
      <RaizCuenta>
        <PaginaSuspendida>
          <CabeceraSuspendida
            avisoPendiente={
              showPending
                ? t("pages.suspended.pendingPaymentBanner", { method: (pending ?? "").toUpperCase() })
                : null
            }
            reactivacion={isReactivation}
            pildora={pillText}
            titulo={heading}
            texto={subcopy}
          />
          <SuspendedPlanCards
            plans={planCards}
            currentPlan={currentPlan}
            firstMonthEligible={firstMonthEligible}
            rediseno
          />
          <VolverAlLogin texto={t("pages.suspended.backToLogin")} />
        </PaginaSuspendida>
      </RaizCuenta>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {showPending && (
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <div
            className="rounded-xl border p-4 text-center text-sm font-semibold"
            style={{
              background: "rgba(245,158,11,0.08)",
              borderColor: "rgba(245,158,11,0.4)",
              color: "rgb(180,83,9)",
            }}
          >
            {t("pages.suspended.pendingPaymentBanner", { method: (pending ?? "").toUpperCase() })}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1000px] px-6 pb-20 pt-12">
        {/* Encabezado adaptativo: pill + título + subcopy (compra vs. reactivación) */}
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-card py-1.5 pl-2 pr-3.5 dark:border-violet-500/30"
            style={{ boxShadow: "0 2px 8px -2px rgba(124,58,237,0.18)" }}
          >
            <span
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]"
              style={{ background: "linear-gradient(135deg,#8B5CF6,#7C3AED)" }}
            >
              {isReactivation ? (
                <Lock size={14} className="text-white" aria-hidden />
              ) : (
                <Sparkles size={14} className="text-white" aria-hidden />
              )}
            </span>
            <span className="text-[12.5px] font-bold text-violet-700 dark:text-violet-300">
              {pillText}
            </span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight md:text-[40px]">{heading}</h1>
          <p className="max-w-[560px] text-base leading-relaxed text-muted-foreground">
            {subcopy}
          </p>
        </div>

        <SuspendedPlanCards plans={planCards} currentPlan={currentPlan} firstMonthEligible={firstMonthEligible} />

        <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
          <Link href="/login" className="transition hover:text-foreground">
            ← {t("pages.suspended.backToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}
