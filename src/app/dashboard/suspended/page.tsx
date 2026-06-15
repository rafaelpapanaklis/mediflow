import Link from "next/link";
import { Lock } from "lucide-react";
import { PLANS, isPlanId, type PlanId } from "@/lib/billing/plans";
import { SuspendedPlanCards, type PlanCardData } from "./suspended-client";
import { getServerT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: { pending?: string };
}) {
  const { t } = await getServerT();
  // Vuelta de un Checkout SPEI/OXXO (asíncrono): el pago aún no se acredita.
  const pending = searchParams?.pending;
  const showPending = pending === "spei" || pending === "oxxo";
  const planCards: PlanCardData[] = PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    priceMxn: p.priceMxn,
    features: [...p.features],
  }));

  // Plan elegido en el registro (Clinic.plan): preselección + base del upsell.
  const user = await getCurrentUser();
  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: { plan: true },
  });
  const currentPlan: PlanId | null = clinic && isPlanId(clinic.plan) ? clinic.plan : null;

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
        {/* Encabezado: pill "en pausa" + título + subcopy */}
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-card py-1.5 pl-2 pr-3.5 dark:border-violet-500/30"
            style={{ boxShadow: "0 2px 8px -2px rgba(124,58,237,0.18)" }}
          >
            <span
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]"
              style={{ background: "linear-gradient(135deg,#8B5CF6,#7C3AED)" }}
            >
              <Lock size={14} className="text-white" aria-hidden />
            </span>
            <span className="text-[12.5px] font-bold text-violet-700 dark:text-violet-300">
              Tu panel está en pausa
            </span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight md:text-[40px]">Activa tu plan</h1>
          <p className="max-w-[560px] text-base leading-relaxed text-muted-foreground">
            Desbloquea tu panel completo —agenda, expedientes y facturación—. Pago seguro con
            tarjeta, SPEI u OXXO; tu cuenta se reactiva al instante.
          </p>
        </div>

        <SuspendedPlanCards plans={planCards} currentPlan={currentPlan} />

        <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
          <Link href="/login" className="transition hover:text-foreground">
            ← {t("pages.suspended.backToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}
