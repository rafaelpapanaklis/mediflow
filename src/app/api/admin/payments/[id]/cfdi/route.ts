import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCFDIProvider, cfdiNotConfiguredInstructions, isCFDIConfigured } from "@/lib/cfdi";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isCFDIConfigured()) {
    return NextResponse.json(
      { error: "PAC no configurado", instructions: cfdiNotConfiguredInstructions() },
      { status: 503 },
    );
  }

  const payment = await prisma.subscriptionInvoice.findUnique({
    where: { id: params.id },
    include: { clinic: true },
  });
  if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });

  const provider = getCFDIProvider();
  const clinic = payment.clinic;

  try {
    const result = await provider.generateInvoice({
      emisor: {
        rfc: clinic.rfcEmisor ?? "",
        razonSocial: clinic.name,
        regimenFiscal: clinic.regimenFiscal ?? "",
        cpEmisor: clinic.cpEmisor ?? "",
      },
      receptor: {
        rfc: "XAXX010101000", // público en general por default — ajustar cuando el consumo final lo requiera
        razonSocial: "Público en general",
        regimenFiscal: "616",
        cpReceptor: clinic.cpEmisor ?? "00000",
      },
      conceptos: [{
        claveProdServ: "81112101",
        cantidad: 1,
        claveUnidad: "E48",
        descripcion: `Suscripción MediFlow ${clinic.plan} · ${payment.periodStart.toISOString().slice(0,10)} → ${payment.periodEnd.toISOString().slice(0,10)}`,
        valorUnitario: payment.amount,
        importe: payment.amount,
      }],
      metodoPago: "PUE",
      formaPago:  "03",
      moneda:     payment.currency,
      tipoComprobante: "I",
    });

    // Persiste el CFDI en la tabla cfdi_records para trazabilidad.
    await prisma.cfdiRecord.create({
      data: {
        clinicId: clinic.id,
        invoiceId: null,
        facturapiId: result.uuid, // mientras no haya PAC real, quedará el uuid placeholder
        uuid: result.uuid,
        tipoComprobante: "I",
        receptor: { rfc: "XAXX010101000", razonSocial: "Público en general" },
        conceptos: [{ descripcion: "Suscripción MediFlow", importe: payment.amount }],
        total: payment.amount,
        status: result.status,
        xmlUrl: result.xmlUrl,
        pdfUrl: result.pdfUrl,
      },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Error", instructions: err.instructions },
      { status: 503 },
    );
  }
}
