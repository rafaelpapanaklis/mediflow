import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { BarberRegistroVisual } from "@/components/barber/barber-registro-visual";
import { getBarberContext } from "@/lib/barber-auth";
import { isBarberPlanId } from "@/lib/barber/plan-shared";
import {
  BARBER_BILLING_PATH,
  BARBER_FORGOT_PASSWORD_PATH,
  BARBER_REGISTER_PATH,
  DALECONTROL_CLINIC_LOGIN_PATH,
  barberPathWithPlan,
} from "@/lib/barber/marketing";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { BarberEntrarForm } from "./entrar-form";

// La página lee la sesión (cookies): nunca se prerenderiza.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar · DaleControl Barber",
  description: "Entra al panel de tu barbería en DaleControl Barber.",
  robots: { index: false, follow: false },
};

/**
 * /barber/entrar — la entrada PROPIA del vertical (auditoría 14-nov, G5).
 *
 * Es el inicio de sesión de siempre con la cara de Barber: el formulario
 * llama al MISMO POST /api/auth/login que /login (bloqueo por intentos,
 * cookies de Supabase escritas por el servidor) y al terminar manda a
 * /barber. /login y src/lib/auth.ts no se tocan: /login sigue sirviendo a
 * una barbería igual que antes, solo que ya nadie del vertical apunta ahí.
 *
 * NO es una pantalla del panel: vive fuera del grupo (panel), no lleva el
 * candado de pago (requireBarberPaidAccess) ni el menú. Por aquí entra
 * también quien todavía no ha pagado.
 *
 * `?plan=` — quien eligió plan en la portada lo trae hasta aquí; al entrar
 * cae en Suscripción con ese plan a la vista en vez de en el índice.
 */
export default async function BarberEntrarPage(props: {
  searchParams?: Promise<{ plan?: string | string[] }>;
}) {
  const sp = (await props.searchParams) ?? {};
  const plan = isBarberPlanId(sp.plan) ? sp.plan : null;
  const destino = plan ? barberPathWithPlan(BARBER_BILLING_PATH, plan) : "/barber";

  // Con sesión de barbería no hay nada que pedir: adentro.
  const ctx = await getBarberContext();
  if (ctx) redirect(destino);

  const aviso = await avisoDeSesion();

  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<BarberRegistroVisual />}
      form={
        <BarberEntrarForm
          destino={destino}
          registerHref={barberPathWithPlan(BARBER_REGISTER_PATH, plan)}
          forgotHref={BARBER_FORGOT_PASSWORD_PATH}
          aviso={aviso?.texto ?? null}
          // Solo para la cuenta que NO es de barbería: su puerta es la otra.
          otraEntradaHref={aviso?.cuentaAjena ? DALECONTROL_CLINIC_LOGIN_PATH : null}
        />
      }
    />
  );
}

/**
 * Hay sesión abierta pero NO entra al panel. Sin este aviso, quien inicia
 * sesión con una cuenta dada de baja (o con una que no es de barbería) vuelve
 * a ver este mismo formulario, vacío y sin explicación: /barber lo regresa
 * aquí. Solo textos fijos; nunca se pinta nada que venga de la URL.
 */
async function avisoDeSesion(): Promise<{ texto: string; cuentaAjena: boolean } | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    // getBarberContext ya dijo que no hay un usuario ACTIVO: si existe una
    // fila con esta cuenta, es que está dada de baja.
    const fila = await prisma.barberUser.findFirst({
      where: { supabaseId: user.id },
      select: { id: true },
    });
    return fila
      ? {
          texto: "Tu acceso a esta barbería está dado de baja. Pídele al dueño que lo reactive.",
          cuentaAjena: false,
        }
      : {
          texto:
            "La cuenta con la que entraste no es de una barbería. Entra aquí con el correo de tu barbería.",
          // Sin una salida, quien es de otra parte de DaleControl se quedaba
          // aquí dando vueltas: el formulario le ofrece su entrada.
          cuentaAjena: true,
        };
  } catch {
    // Base caída o sesión ilegible: el formulario se pinta sin aviso.
    return null;
  }
}
