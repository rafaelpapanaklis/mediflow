import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { isCFDIConfigured, cfdiNotConfiguredInstructions } from "@/lib/cfdi";
import { CfdiClient } from "./cfdi-client";

export const metadata: Metadata = { title: "CFDI — Admin MediFlow" };

export default async function CfdiPaymentPage({ params }: { params: { id: string } }) {
  const payment = await prisma.subscriptionInvoice.findUnique({
    where: { id: params.id },
    include: {
      clinic: {
        select: {
          id: true,
          name: true,
          email: true,
          taxId: true,
          rfcEmisor: true,
          regimenFiscal: true,
          cpEmisor: true,
          city: true,
          address: true,
        },
      },
    },
  });
  if (!payment) notFound();

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <Link
        href="/admin/payments"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", textDecoration: "none" }}
      >
        <ArrowLeft size={14} />
        Volver a pagos
      </Link>

      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-1)", margin: 0 }}>
          Generar CFDI
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
          Factura fiscal SAT para el pago <span className="mono">#{payment.id.slice(0, 8)}</span>
        </p>
      </div>

      <CfdiClient
        paymentId={payment.id}
        clinic={payment.clinic as any}
        amount={payment.amount}
        currency={payment.currency}
        periodStart={payment.periodStart.toISOString()}
        periodEnd={payment.periodEnd.toISOString()}
        cfdiConfigured={isCFDIConfigured()}
        cfdiInstructions={cfdiNotConfiguredInstructions()}
      />
    </div>
  );
}
