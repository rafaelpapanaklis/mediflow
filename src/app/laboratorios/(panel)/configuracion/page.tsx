export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import type { DentalLabBankAccountDTO, DentalLabFiscalDataDTO } from "@/lib/laboratorios/types";
import { PerfilForm } from "./perfil-form";
import { FiscalForm } from "./fiscal-form";
import { BancoForm } from "./banco-form";

export const metadata: Metadata = {
  title: "Configuración · Laboratorio — MediFlow",
  robots: { index: false, follow: false },
};

export default async function LabConfiguracionPage() {
  const ctx = await getDentalLabContext();
  if (!ctx) redirect("/laboratorios/login");

  const lab = ctx.lab;
  const canEdit = ctx.role === "OWNER" || ctx.role === "MANAGER";

  const [fiscal, accounts] = await Promise.all([
    prisma.dentalLabFiscalData.findUnique({ where: { labId: ctx.labId } }),
    prisma.dentalLabBankAccount.findMany({
      where: { labId: ctx.labId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  const fiscalInitial: DentalLabFiscalDataDTO | null = fiscal
    ? {
        legalName: fiscal.legalName,
        rfc: fiscal.rfc,
        taxRegime: { code: fiscal.taxRegimeCode, label: fiscal.taxRegimeLabel },
        zipCode: fiscal.zipCode,
        cfdiUse: { code: fiscal.cfdiUseCode, label: fiscal.cfdiUseLabel },
        state: fiscal.state ?? null,
        certificateUrl: fiscal.certificateUrl ?? null,
        certificateValidUntil: fiscal.certificateValidUntil
          ? fiscal.certificateValidUntil.toISOString()
          : null,
      }
    : null;

  const accountsInitial: DentalLabBankAccountDTO[] = accounts.map((a) => ({
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
          Administra el perfil de tu laboratorio, los datos fiscales y las cuentas para recibir pagos.
        </p>
      </div>

      <PerfilForm
        canEdit={canEdit}
        initial={{
          name: lab.name,
          email: lab.email,
          slug: lab.slug,
          status: lab.status,
          rfc: lab.rfc ?? "",
          phone: lab.phone ?? "",
          whatsapp: lab.whatsapp ?? "",
          website: lab.website ?? "",
          description: lab.description ?? "",
          address: lab.address ?? "",
          city: lab.city ?? "",
          state: lab.state ?? "",
          founded: lab.founded ?? null,
        }}
      />

      <FiscalForm canEdit={canEdit} initial={fiscalInitial} />

      <BancoForm canEdit={canEdit} initial={accountsInitial} />
    </div>
  );
}
