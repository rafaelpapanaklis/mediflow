export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import type { SupplierBankAccountDTO } from "@/lib/suppliers/types";
import { ProfileForm } from "./profile-form";
import { BancoForm } from "./banco-form";

export default async function SupplierConfigPage() {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");

  const [supplier, bankAccounts] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: ctx.supplierId } }),
    prisma.supplierBankAccount.findMany({
      where: { supplierId: ctx.supplierId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  if (!supplier) redirect("/proveedores/login");

  const canEdit = ctx.role === "OWNER" || ctx.role === "MANAGER";

  const bankAccountDTOs: SupplierBankAccountDTO[] = bankAccounts.map((a) => ({
    id: a.id,
    bank: a.bank,
    clabe: a.clabe,
    accountNumber: a.accountNumber ?? null,
    holderName: a.holderName,
    isPrimary: a.isPrimary,
  }));

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
          payTransferEnabled: supplier.payTransferEnabled,
          payMercadoPagoEnabled: supplier.payMercadoPagoEnabled,
          payCashEnabled: supplier.payCashEnabled,
          mpConnected: Boolean(supplier.mpAccessToken),
        }}
      />

      <BancoForm canEdit={canEdit} initial={bankAccountDTOs} />
    </div>
  );
}
