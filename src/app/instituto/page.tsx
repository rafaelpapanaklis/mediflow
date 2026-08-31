export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";

// Índice de /instituto: enruta según el estado de la sesión (espejo de
// /barber/page.tsx).
//
// - Sin sesión de instituto → /instituto/login (login DEDICADO del
//   vertical, no el compartido del dental).
// - ALUMNO → /instituto/mi-dia (Ola 12). Lo que un alumno necesita al
//   llegar al piso clínico es SU AGENDA —qué paciente le toca, en qué
//   sillón, con qué docente—, no una pantalla de bienvenida con tarjetas.
//   Solo el alumno: dirección, caja y docentes conservan Inicio, que es
//   donde viven sus avisos (el contrato, los accesos rápidos).
// - Cualquier otro rol → /instituto/inicio.
//
// Aquí NO se corta por contrato. El contrato institucional avisa, no cierra
// la puerta: ver src/lib/edu/contract.ts.
export default async function InstitutoIndexPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");
  if (ctx.role === "ALUMNO") redirect("/instituto/mi-dia");
  redirect("/instituto/inicio");
}
