export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import type { DentalLabBankAccountDTO, DentalLabFiscalDataDTO } from "@/lib/laboratorios/types";
import { PerfilForm } from "./perfil-form";
import { FiscalForm } from "./fiscal-form";
import { BancoForm } from "./banco-form";
import { PagosForm } from "./pagos-form";

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
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -28,
            left: -32,
            width: 240,
            height: 160,
            pointerEvents: "none",
            background:
              "radial-gradient(closest-side, rgba(124,58,237,0.18), transparent 75%)",
            filter: "blur(4px)",
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <Settings size={22} />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Configuración
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Administra el perfil de tu laboratorio, los datos fiscales y las cuentas para recibir pagos.
          </p>
        </div>
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

      <PagosForm
        canEdit={canEdit}
        initial={{
          paySpeiEnabled: lab.paySpeiEnabled,
          payMercadoPagoEnabled: lab.payMercadoPagoEnabled,
          payCashEnabled: lab.payCashEnabled,
          mpConnected: Boolean(lab.mpAccessToken),
        }}
      />

      <BancoForm canEdit={canEdit} initial={accountsInitial} />
    </div>
  );
}
