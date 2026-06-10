// GET /api/paciente/recibos/[id]/pdf — Implementa D4 (WS1-T6).
// Recibo de pago individual en PDF (@react-pdf/renderer) para el portal del
// paciente. [id] = Payment.id. Generado on-demand, no se persiste.
//
// PATRÓN A SEGUIR: src/app/api/compras/orders/[orderId]/receipt/route.tsx
// (léelo antes: mismo enfoque route.tsx + StyleSheet + renderToBuffer +
// Document/Page/View/Text inline, y mismo manejo del buffer en NextResponse).
//
// Seguridad / paciente-safe:
// · getPatientPortalContext() | pacienteUnauthorized().
// · prisma.payment.findUnique({ where: { id: params.id }, select: {
//     id: true, amount: true, method: true, paidAt: true,
//     invoice: { select: { invoiceNumber: true, clinicId: true,
//       patientId: true, status: true,
//       patient: { select: { firstName: true, lastName: true, deletedAt: true } },
//       clinic: { select: { name: true, phone: true, city: true } } } } } })
// · 404 GENÉRICO { error: "No encontrado" } si: no existe, O
//   invoice.patientId ∉ ctx.links, O patient soft-deleted, O
//   invoice.status === "DRAFT". Mismo 404 siempre (sin oráculo).
// · ⚠️ NUNCA seleccionar Payment.notes ni Payment.reference (internos).
//
// Contenido del PDF (es-MX, español neutro con tú, dark NO — fondo blanco
// imprimible): título "Recibo de pago" + nombre de la clínica (y city/phone si
// hay), paciente (firstName lastName), folio del recibo (últimos 8 de
// payment.id en mayúsculas), "Factura {invoiceNumber}", fecha de pago
// (toLocaleDateString es-MX día/mes largo/año), método mapeado a español
// (cash|efectivo→Efectivo, card|tarjeta→Tarjeta, transfer|transferencia→
// Transferencia, refund|reembolso→Reembolso; otro → capitalizado tal cual),
// monto en MXN (Intl.NumberFormat es-MX currency MXN). Al pie, leyenda:
// "Este recibo es un comprobante interno de la clínica y no es un comprobante
// fiscal (CFDI)." y "Generado por DaleControl".
// fileName: `recibo-YYYY-MM-DD-{id8}.pdf` (fecha del pago).
// Respuesta: Content-Type application/pdf, Content-Disposition attachment con
// fileName, Cache-Control private, no-store. try/catch → 500 con
// console.error("[paciente/recibos/pdf] error:", err).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  renderToBuffer,
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Payment.method es string libre. Mapeo a etiqueta en español (case-insensitive).
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  efectivo: "Efectivo",
  card: "Tarjeta",
  tarjeta: "Tarjeta",
  transfer: "Transferencia",
  transferencia: "Transferencia",
  refund: "Reembolso",
  reembolso: "Reembolso",
};

function mapMethodLabel(method: string): string {
  const raw = (method ?? "").trim();
  if (!raw) return "—";
  const mapped = PAYMENT_METHOD_LABELS[raw.toLowerCase()];
  if (mapped) return mapped;
  // Otro método: capitalizado tal cual.
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

interface ReciboProps {
  clinicName: string;
  clinicCity: string | null;
  clinicPhone: string | null;
  patientName: string;
  folio: string;
  invoiceNumber: string;
  paidAt: string; // ISO
  paymentMethodLabel: string;
  amount: number;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#14101f",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#7c3aed",
    paddingBottom: 12,
    marginBottom: 18,
  },
  title: {
    fontSize: 18,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
  },
  titleSub: {
    fontSize: 9,
    color: "#6b6b78",
    marginTop: 2,
  },
  metaBox: { textAlign: "right" },
  metaLabel: { fontSize: 8.5, color: "#6b6b78", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 12, color: "#14101f", fontFamily: "Helvetica-Bold", marginTop: 1 },
  metaSmall: { fontSize: 9, color: "#6b6b78", marginTop: 2 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  infoCol: { width: "48%" },
  infoTitle: {
    fontSize: 8.5,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  infoStrong: { fontSize: 11, color: "#14101f", fontFamily: "Helvetica-Bold" },
  infoLine: { fontSize: 9.5, color: "#3f3a4a", marginTop: 2 },
  sectionTitle: {
    fontSize: 8.5,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5ed",
  },
  detailLabel: { width: "40%", fontSize: 9.5, color: "#6b6b78" },
  detailValue: { width: "60%", fontSize: 9.5, color: "#14101f" },
  amountBox: {
    marginTop: 20,
    alignItems: "flex-end",
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "55%",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#d4d4dc",
  },
  amountLabel: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    width: "55%",
    textAlign: "right",
    paddingRight: 10,
  },
  amountValue: {
    fontSize: 14,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
    width: "45%",
    textAlign: "right",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#9b9aa8",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5ed",
    paddingTop: 8,
  },
  footerLine: { marginTop: 2 },
});

function ReciboPagoDocument(props: ReciboProps) {
  const fechaPago = new Date(props.paidAt).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Document
      title={`Recibo de pago ${props.folio}`}
      author="DaleControl"
      subject={`Recibo de pago — Factura ${props.invoiceNumber}`}
    >
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Recibo de pago</Text>
            <Text style={styles.titleSub}>{props.clinicName}</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Folio</Text>
            <Text style={styles.metaValue}>{props.folio}</Text>
            <Text style={styles.metaSmall}>{fechaPago}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Clínica</Text>
            <Text style={styles.infoStrong}>{props.clinicName}</Text>
            {props.clinicCity ? (
              <Text style={styles.infoLine}>{props.clinicCity}</Text>
            ) : null}
            {props.clinicPhone ? (
              <Text style={styles.infoLine}>Tel: {props.clinicPhone}</Text>
            ) : null}
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Paciente</Text>
            <Text style={styles.infoStrong}>{props.patientName}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Detalle del pago</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Documento</Text>
          <Text style={styles.detailValue}>Factura {props.invoiceNumber}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Fecha de pago</Text>
          <Text style={styles.detailValue}>{fechaPago}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Método de pago</Text>
          <Text style={styles.detailValue}>{props.paymentMethodLabel}</Text>
        </View>

        <View style={styles.amountBox}>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Monto pagado</Text>
            <Text style={styles.amountValue}>{fmtMXN(props.amount)}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            Este recibo es un comprobante interno de la clínica y no es un comprobante
            fiscal (CFDI).
          </Text>
          <Text style={styles.footerLine}>Generado por DaleControl</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    // Select paciente-safe. ⚠️ NUNCA Payment.notes ni Payment.reference (internos).
    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        amount: true,
        method: true,
        paidAt: true,
        invoice: {
          select: {
            invoiceNumber: true,
            clinicId: true,
            patientId: true,
            status: true,
            patient: { select: { firstName: true, lastName: true, deletedAt: true } },
            clinic: { select: { name: true, phone: true, city: true } },
          },
        },
      },
    });

    // 404 GENÉRICO, SIEMPRE igual (sin oráculo de existencia/ownership):
    // no existe, no está vinculado a la cuenta, paciente soft-deleted o borrador.
    const owned =
      payment != null &&
      ctx.links.some((l) => l.patientId === payment.invoice.patientId);
    if (
      !payment ||
      !owned ||
      payment.invoice.patient.deletedAt !== null ||
      payment.invoice.status === "DRAFT"
    ) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const id8 = payment.id.slice(-8);
    const props: ReciboProps = {
      clinicName: payment.invoice.clinic?.name ?? "Clínica",
      clinicCity: payment.invoice.clinic?.city ?? null,
      clinicPhone: payment.invoice.clinic?.phone ?? null,
      patientName: `${payment.invoice.patient.firstName} ${payment.invoice.patient.lastName}`,
      folio: id8.toUpperCase(),
      invoiceNumber: payment.invoice.invoiceNumber,
      paidAt: payment.paidAt.toISOString(),
      paymentMethodLabel: mapMethodLabel(payment.method),
      amount: payment.amount,
    };

    const fileName = `recibo-${payment.paidAt.toISOString().slice(0, 10)}-${id8}.pdf`;
    const buffer = await renderToBuffer(<ReciboPagoDocument {...props} />);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[paciente/recibos/pdf] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
