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
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <Link href="/admin/payments" className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white">
        <ArrowLeft className="w-3.5 h-3.5" />
        Volver a pagos
      </Link>

      <div>
        <h1 className="text-2xl font-extrabold">Generar CFDI</h1>
        <p className="text-slate-400 text-sm">Factura fiscal SAT para el pago #{payment.id.slice(0, 8)}</p>
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
