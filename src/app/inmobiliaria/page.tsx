export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { isRealtySubscriptionActive } from "@/lib/realty/plan-shared";

// Índice de /inmobiliaria: enruta según el estado de la sesión (espejo de
// /barber/page.tsx). El panel real vive bajo el grupo (panel).
//
// - Sin sesión de inmobiliaria → /login (el login COMPARTIDO; getCurrentUser
//   en src/lib/auth.ts sabe regresar aquí a los RealtyUser).
// - Cuenta inactiva o suscripción impaga → pantalla de suscripción.
// - Todo bien → /inmobiliaria/inicio.
export default async function RealtyIndexPage() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");
  if (!ctx.account.isActive || !isRealtySubscriptionActive(ctx.account)) {
    redirect("/inmobiliaria/suscripcion");
  }
  redirect("/inmobiliaria/inicio");
}
