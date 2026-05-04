import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { session_id?: string };
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid"]);

export default async function SuspendedSuccessPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  const clinic = user.clinic;
  const sessionId = searchParams?.session_id ?? null;

  // El webhook /api/webhooks/stripe activa la clínica. Stripe puede
  // redirigir aquí en milisegundos, antes de procesar el webhook → en
  // ese hueco mostramos un mensaje de "estamos confirmando" en vez de
  // declarar el éxito prematuro.
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
            ¡Pago confirmado!
          </h1>
          <p className="mb-8 max-w-md text-base text-muted-foreground">
            Tu plan está activo. Ya puedes volver al dashboard y seguir usando
            MediFlow sin interrupciones.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl px-8 py-4 text-base font-bold text-white shadow-lg transition hover:opacity-90"
            style={{
              background: "var(--brand)",
              boxShadow: "0 10px 30px -8px rgba(124, 58, 237, 0.4)",
            }}
          >
            Ir al dashboard →
          </Link>
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
            Estamos confirmando tu pago
          </h1>
          <p className="mb-8 max-w-md text-base text-muted-foreground">
            En unos segundos podrás acceder al panel. Si tarda más de un
            minuto, recarga esta página o escríbenos a soporte.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/dashboard/suspended/success"
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-base font-bold text-white shadow-lg transition hover:opacity-90"
              style={{
                background: "var(--brand)",
                boxShadow: "0 10px 30px -8px rgba(124, 58, 237, 0.4)",
              }}
            >
              Volver a verificar
            </Link>
            <a
              href="mailto:soporte@mediflow.app"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-3 text-base font-semibold text-foreground transition hover:bg-muted"
            >
              Hablar con soporte
            </a>
          </div>
        </>
      )}
      {sessionId && (
        <div className="mt-10 text-[10px] uppercase tracking-wider text-muted-foreground">
          Referencia: {sessionId.slice(-12)}
        </div>
      )}
    </div>
  );
}
