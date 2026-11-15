import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { BarberRegistroVisual } from "@/components/barber/barber-registro-visual";
import { BarberRegistroForm } from "@/components/barber/barber-registro-form";
import { barberCaptchaSiteKey } from "@/lib/barber/captcha";
import { getBarberContext } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { isBarberPlanId } from "@/lib/barber/plan-shared";
import {
  BARBER_BILLING_PATH,
  BARBER_FORGOT_PASSWORD_PATH,
  BARBER_LOGIN_PATH,
  barberPathWithPlan,
} from "@/lib/barber/marketing";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registra tu barbería · DaleControl Barber",
  description:
    "Crea la cuenta de tu barbería en DaleControl Barber: agenda, fila virtual, WhatsApp y caja.",
  robots: { index: false, follow: false },
};

/**
 * `?plan=` — los botones «Empezar con …» de la portada traen el plan elegido.
 *
 * CON SESIÓN DE BARBERÍA NO SE REGISTRA OTRA (auditoría 14-nov, G5): quien ya
 * tiene cuenta y vuelve a la portada a contratar caía otra vez en el alta y
 * acababa con dos barberías. Ahora va a su panel — o directo a Suscripción,
 * con el plan a la vista, si venía de un botón de plan.
 */
export default async function BarberRegistroPage(props: {
  searchParams?: Promise<{ plan?: string | string[] }>;
}) {
  const sp = (await props.searchParams) ?? {};
  const plan = isBarberPlanId(sp.plan) ? sp.plan : null;

  const ctx = await getBarberContext();
  if (ctx) redirect(plan ? barberPathWithPlan(BARBER_BILLING_PATH, plan) : "/barber");

  // El nombre sale de la tabla de planes; aquí no se escribe ninguno a mano.
  const planName = plan ? (await getBarberPlan(plan)).name : null;

  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<BarberRegistroVisual />}
      form={
        <BarberRegistroForm
          loginHref={barberPathWithPlan(BARBER_LOGIN_PATH, plan)}
          forgotHref={BARBER_FORGOT_PASSWORD_PATH}
          planName={planName}
          captchaSiteKey={barberCaptchaSiteKey()}
        />
      }
    />
  );
}
