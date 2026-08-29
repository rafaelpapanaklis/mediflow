export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";

// Índice de /instituto: enruta según el estado de la sesión (espejo de
// /barber/page.tsx).
//
// - Sin sesión de instituto → /instituto/login (login DEDICADO del
//   vertical, no el compartido del dental).
// - Con sesión → /instituto/inicio.
//
// Aquí NO se corta por contrato. El contrato institucional avisa, no cierra
// la puerta: ver src/lib/edu/contract.ts.
export default async function InstitutoIndexPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");
  redirect("/instituto/inicio");
}
