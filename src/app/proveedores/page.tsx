export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";

// Índice de /proveedores: enruta según el estado de la sesión para que la URL
// raíz no quede en 404. El panel real vive bajo el grupo de rutas (panel).
export default async function ProveedoresIndexPage() {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");
  if (ctx.status !== "APPROVED") redirect("/proveedores/pendiente");
  redirect("/proveedores/inicio");
}
