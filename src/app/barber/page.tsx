export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";

// Índice de /barber: enruta según el estado de la sesión (espejo de
// /laboratorios/page.tsx). El panel real vive bajo el grupo (panel).
//
// - Sin sesión de barbería → /login (el login COMPARTIDO; getCurrentUser en
//   src/lib/auth.ts sabe regresar aquí a los BarberUser).
// - Barbería inactiva o suscripción impaga → pantalla de suscripción.
// - Todo bien → /barber/inicio.
export default async function BarberIndexPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  if (!ctx.barbershop.isActive || !isBarbershopSubscriptionActive(ctx.barbershop)) {
    redirect("/barber/suscripcion");
  }
  redirect("/barber/inicio");
}
