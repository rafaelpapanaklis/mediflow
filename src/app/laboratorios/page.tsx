export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getDentalLabContext } from "@/lib/lab-auth";

// Índice de /laboratorios: enruta según el estado de la sesión para que la URL
// raíz no quede en 404. El panel real vive bajo el grupo de rutas (panel).
export default async function LaboratoriosIndexPage() {
  const ctx = await getDentalLabContext();
  if (!ctx) redirect("/laboratorios/login");
  if (ctx.status !== "APPROVED") redirect("/laboratorios/pendiente");
  redirect("/laboratorios/inicio");
}
