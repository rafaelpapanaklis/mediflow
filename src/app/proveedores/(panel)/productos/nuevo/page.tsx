export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { ProductoForm } from "../producto-form";

export const metadata: Metadata = {
  title: "Nuevo producto · Proveedor — DaleControl",
  robots: { index: false, follow: false },
};

export default async function NuevoProductoPage() {
  // El layout del panel ya exige sesión + APPROVED; revalidamos por defensa.
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");
  if (ctx.status !== "APPROVED") redirect("/proveedores/pendiente");

  return <ProductoForm mode="create" />;
}
