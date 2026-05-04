import Link from "next/link";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { SuspendedPlanCards, type PlanCardData } from "./suspended-client";

const BANK_INFO = {
  nombre: "Efthymios Rafail Papanaklis",
  clabe:  "012910015008025244",
  banco:  "BBVA",
};

export const dynamic = "force-dynamic";

/**
 * URLs de suscripción de PayPal Business por plan. Son URLs públicas
 * (no secretos) que Rafael genera desde su panel de PayPal y configura
 * en Vercel como NEXT_PUBLIC_PAYPAL_LINK_<PLAN>. Si una env no está
 * configurada, el botón se renderiza disabled con texto
 * "PayPal — próximamente".
 *
 * Las leemos en el server component (no en el client) para que
 * Next.js no tenga que inlinear las vars en el bundle del cliente —
 * pasamos el resultado como props serializadas.
 */
function getPaypalUrl(plan: PlanId): string | null {
  const map: Record<PlanId, string | undefined> = {
    BASIC:  process.env.NEXT_PUBLIC_PAYPAL_LINK_BASIC,
    PRO:    process.env.NEXT_PUBLIC_PAYPAL_LINK_PRO,
    CLINIC: process.env.NEXT_PUBLIC_PAYPAL_LINK_CLINIC,
  };
  const url = map[plan];
  return url && url.length > 0 ? url : null;
}

export default function SuspendedPage() {
  const planCards: PlanCardData[] = PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    priceMxn: p.priceMxn,
    features: [...p.features],
    paypalUrl: getPaypalUrl(p.id),
  }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero bloqueante centrado */}
      <section className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/10 text-4xl">
          ⏰
        </div>
        <h1 className="mb-4 max-w-2xl text-4xl font-extrabold tracking-tight md:text-5xl">
          Tu plan expiró
        </h1>
        <p className="mb-8 max-w-xl text-base text-muted-foreground md:text-lg">
          Tu acceso al panel está bloqueado. Para seguir usando MediFlow y
          retomar tus citas, expedientes y facturación, renueva tu plan.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="#renovar-plan"
            className="inline-flex items-center justify-center rounded-xl px-8 py-4 text-base font-bold text-white shadow-lg transition hover:opacity-90"
            style={{
              background: "var(--brand)",
              boxShadow: "0 10px 30px -8px var(--brand-soft, rgba(124,58,237,0.4))",
            }}
          >
            Renovar plan ↓
          </a>
          <a
            href="mailto:soporte@mediflow.app"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-4 text-base font-semibold text-foreground transition hover:bg-muted"
          >
            Hablar con soporte
          </a>
        </div>
        <Link
          href="/login"
          className="mt-10 text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← Volver al login
        </Link>
      </section>

      {/* Sección de planes + datos de pago */}
      <section
        id="renovar-plan"
        className="mx-auto max-w-4xl scroll-mt-8 px-4 pb-20"
      >
        <h2 className="mb-2 text-center text-2xl font-bold tracking-tight">
          Elige tu plan
        </h2>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          Pago instantáneo con tarjeta o PayPal — tu cuenta se reactiva
          automáticamente. Si prefieres SPEI, los datos están más abajo.
        </p>

        <SuspendedPlanCards plans={planCards} />

        {/* Datos de pago SPEI (alternativa manual) */}
        <div
          className="rounded-2xl border-2 bg-card p-6"
          style={{ borderColor: "var(--brand)" }}
        >
          <div
            className="mb-5 text-xs font-bold uppercase tracking-wider"
            style={{ color: "var(--brand)" }}
          >
            💳 Alternativa: pago por transferencia SPEI
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                Nombre del beneficiario
              </div>
              <div className="text-sm font-semibold">{BANK_INFO.nombre}</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                CLABE interbancaria
              </div>
              <div
                className="font-mono text-xl font-extrabold tracking-wider"
                style={{ color: "var(--brand)" }}
              >
                {BANK_INFO.clabe}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Banco</div>
              <div className="text-sm font-semibold">{BANK_INFO.banco}</div>
            </div>
          </div>
          <div
            className="mt-5 rounded-lg border p-3 text-xs"
            style={{
              background: "rgba(245, 158, 11, 0.08)",
              borderColor: "rgba(245, 158, 11, 0.4)",
              color: "rgb(180, 83, 9)",
            }}
          >
            <strong>Importante:</strong> en el concepto de tu transferencia
            escribe el nombre de tu clínica. Por SPEI tu acceso se reactiva
            en máximo 24 horas hábiles después de confirmar el pago. Con
            tarjeta o PayPal la reactivación es inmediata.
          </div>
        </div>

        {/* Contacto */}
        <div className="mt-6 text-center text-sm text-muted-foreground">
          ¿Ya realizaste el pago por SPEI? Escríbenos a{" "}
          <a
            href="mailto:soporte@mediflow.app"
            className="font-semibold hover:underline"
            style={{ color: "var(--brand)" }}
          >
            soporte@mediflow.app
          </a>{" "}
          o por WhatsApp para activar tu cuenta de inmediato.
        </div>
      </section>
    </div>
  );
}
