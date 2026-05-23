export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "./profile-form";

export default async function SupplierConfigPage() {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");

  const supplier = await prisma.supplier.findUnique({ where: { id: ctx.supplierId } });
  if (!supplier) redirect("/proveedores/login");

  const canEdit = ctx.role === "OWNER" || ctx.role === "MANAGER";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
      <div>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Configuración
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
          Administra los datos de tu negocio que ven las clínicas.
        </p>
      </div>

      <ProfileForm
        canEdit={canEdit}
        initial={{
          businessName: supplier.businessName,
          email: supplier.email,
          slug: supplier.slug,
          status: supplier.status,
          rfc: supplier.rfc ?? "",
          phone: supplier.phone ?? "",
          address: supplier.address ?? "",
          city: supplier.city ?? "",
          state: supplier.state ?? "",
          description: supplier.description ?? "",
          categories: supplier.categories,
          paymentMethods: supplier.paymentMethods,
        }}
      />
    </div>
  );
}
