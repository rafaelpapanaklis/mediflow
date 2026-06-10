import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
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
export const maxDuration = 60;

// GET /api/paciente/invoices/[id]/receipt — recibo PDF de los pagos de una
// factura, descargable por el paciente desde su portal (WS1-T4). Mismo stack
// que /api/compras/orders/[orderId]/receipt (@react-pdf/renderer, Helvetica
// built-in, sin dependencias nuevas).
//
// SEGURIDAD MULTI-TENANT: la factura se busca SIEMPRE por (id + patientId en
// ctx.links) — una cuenta jamás descarga recibos de facturas ajenas.
//
// VISIBILIDAD PACIENTE-SAFE (contrato de types.ts): NUNCA Invoice.items ni
// Invoice.notes (traen notas internas de la clínica). El recibo muestra solo
// folio, totales y la lista de pagos (fecha, método, referencia, monto).

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  debit: "Tarjeta de débito",
  credit: "Tarjeta de crédito",
  transfer: "Transferencia",
  check: "Cheque",
  other: "Otro",
  online: "Pago en línea (tarjeta)",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Pago parcial",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  CANCELLED: "Cancelada",
};

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtFecha(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

interface ReceiptPayment {
  paidAt: string; // ya formateada
  methodLabel: string;
  reference: string;
  amount: number;
}

interface ReceiptProps {
  invoiceNumber: string;
  createdAt: string; // ya formateada
  statusLabel: string;
  clinicName: string;
  clinicCity: string | null;
  clinicPhone: string | null;
  patientName: string;
  payments: ReceiptPayment[];
  total: number;
  paid: number;
  balance: number;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#14101f" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#7c3aed",
    paddingBottom: 12,
    marginBottom: 18,
  },
  brand: { fontSize: 18, color: "#7c3aed", fontFamily: "Helvetica-Bold" },
  brandSub: { fontSize: 9, color: "#6b6b78", marginTop: 2 },
  metaBox: { textAlign: "right" },
  metaLabel: { fontSize: 8.5, color: "#6b6b78", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 12, color: "#14101f", fontFamily: "Helvetica-Bold", marginTop: 1 },
  metaSmall: { fontSize: 9, color: "#6b6b78", marginTop: 2 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
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
  badgeRow: { flexDirection: "row", marginTop: 6 },
  badge: {
    fontSize: 8.5,
    color: "#4c1d95",
    backgroundColor: "#f4f2f8",
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginRight: 6,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f2f8",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#d4d4dc",
  },
  th: {
    fontSize: 8.5,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5ed",
  },
  td: { fontSize: 9.5, color: "#14101f" },
  tdMuted: { color: "#6b6b78" },
  colDate: { width: "30%" },
  colMethod: { width: "26%" },
  colRef: { width: "24%" },
  colAmount: { width: "20%", textAlign: "right" },
  totals: { marginTop: 16, alignItems: "flex-end" },
  totalLine: { flexDirection: "row", justifyContent: "flex-end", width: "55%", paddingVertical: 3 },
  totalLabel: { fontSize: 10, color: "#6b6b78", width: "55%", textAlign: "right", paddingRight: 10 },
  totalValue: { fontSize: 10, color: "#14101f", width: "45%", textAlign: "right" },
  grandRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "55%",
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#d4d4dc",
  },
  grandLabel: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    width: "55%",
    textAlign: "right",
    paddingRight: 10,
  },
  grandValue: {
    fontSize: 13,
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
});

function PatientReceiptDocument(props: ReceiptProps) {
  return (
    <Document
      title={`Recibo ${props.invoiceNumber}`}
      author="DaleControl"
      subject={`Pagos de la factura ${props.invoiceNumber}`}
    >
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>DaleControl</Text>
            <Text style={styles.brandSub}>Recibo de pago · Portal del paciente</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Factura</Text>
            <Text style={styles.metaValue}>{props.invoiceNumber}</Text>
            <Text style={styles.metaSmall}>{props.createdAt}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Clínica</Text>
            <Text style={styles.infoStrong}>{props.clinicName}</Text>
            {props.clinicCity ? <Text style={styles.infoLine}>{props.clinicCity}</Text> : null}
            {props.clinicPhone ? <Text style={styles.infoLine}>Tel: {props.clinicPhone}</Text> : null}
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Paciente</Text>
            <Text style={styles.infoStrong}>{props.patientName}</Text>
            <View style={styles.badgeRow}>
              <Text style={styles.badge}>Estatus: {props.statusLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tableHeader} fixed>
          <Text style={[styles.th, styles.colDate]}>Fecha</Text>
          <Text style={[styles.th, styles.colMethod]}>Método</Text>
          <Text style={[styles.th, styles.colRef]}>Referencia</Text>
          <Text style={[styles.th, styles.colAmount]}>Monto</Text>
        </View>

        {props.payments.map((p, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={[styles.td, styles.colDate]}>{p.paidAt}</Text>
            <Text style={[styles.td, styles.colMethod]}>{p.methodLabel}</Text>
            <Text style={[styles.td, styles.colRef, styles.tdMuted]}>{p.reference}</Text>
            <Text style={[styles.td, styles.colAmount]}>{fmtMXN(p.amount)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalLine}>
            <Text style={styles.totalLabel}>Total de la factura</Text>
            <Text style={styles.totalValue}>{fmtMXN(props.total)}</Text>
          </View>
          <View style={styles.totalLine}>
            <Text style={styles.totalLabel}>Saldo pendiente</Text>
            <Text style={styles.totalValue}>{fmtMXN(props.balance)}</Text>
          </View>
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Total pagado</Text>
            <Text style={styles.grandValue}>{fmtMXN(props.paid)}</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          DaleControl · Recibo de pago · Documento informativo sin valor fiscal ·
          Factura {props.invoiceNumber}
        </Text>
      </Page>
    </Document>
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // renderToBuffer es CPU-intensivo: rate limit por IP contra spam.
  const limited = rateLimit(req, 15);
  if (limited) return limited;

  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const patientIds = ctx.links.map((l) => l.patientId);
    if (patientIds.length === 0) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        patientId: { in: patientIds },
        status: { not: "DRAFT" },
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        paid: true,
        balance: true,
        createdAt: true,
        clinic: { select: { name: true, city: true, phone: true } },
        patient: { select: { firstName: true, lastName: true } },
        payments: {
          orderBy: { paidAt: "asc" },
          select: { amount: true, method: true, reference: true, paidAt: true },
        },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }
    if (invoice.payments.length === 0) {
      return NextResponse.json(
        { error: "Esta factura aún no tiene pagos registrados" },
        { status: 400 },
      );
    }

    const props: ReceiptProps = {
      invoiceNumber: invoice.invoiceNumber,
      createdAt: fmtFecha(invoice.createdAt),
      statusLabel: STATUS_LABELS[invoice.status] ?? invoice.status,
      clinicName: invoice.clinic?.name ?? "Clínica",
      clinicCity: invoice.clinic?.city ?? null,
      clinicPhone: invoice.clinic?.phone ?? null,
      patientName: `${invoice.patient.firstName} ${invoice.patient.lastName}`,
      payments: invoice.payments.map((p) => ({
        paidAt: fmtFecha(p.paidAt),
        methodLabel: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
        reference: p.reference ?? "—",
        amount: p.amount,
      })),
      total: invoice.total,
      paid: invoice.paid,
      balance: invoice.balance,
    };

    const buffer = await renderToBuffer(<PatientReceiptDocument {...props} />);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="recibo-${invoice.invoiceNumber}.pdf"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[paciente/invoices/receipt] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
