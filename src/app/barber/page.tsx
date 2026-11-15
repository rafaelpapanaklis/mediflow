export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { BARBER_LOGIN_PATH } from "@/lib/barber/marketing";

// Índice de /barber: enruta según el estado de la sesión (espejo de
// /laboratorios/page.tsx). El panel real vive bajo el grupo (panel).
//
// - Sin sesión de barbería → /barber/entrar (BARBER_LOGIN_PATH: la entrada
//   propia del vertical, que al terminar regresa aquí).
// - Barbería inactiva o suscripción impaga → pantalla de suscripción.
// - Todo bien → /barber/inicio.
//
// La segunda regla NO se escribe aquí: es requireBarberPaidAccess, la misma
// que corta las 24 pantallas del panel. Tenía su propia copia y miraba la
// fila de la SESIÓN; el helper mira la de la MATRIZ, que es quien paga.
export default async function BarberIndexPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect(BARBER_LOGIN_PATH);
  await requireBarberPaidAccess(ctx);
  redirect("/barber/inicio");
}
