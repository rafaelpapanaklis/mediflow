import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import {
  renderToBuffer,
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
} from "@/lib/suppliers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/compras/orders/[orderId]/receipt — comprobante PDF de un pedido de
// la clínica. Reusa el stack de PDF del repo (@react-pdf/renderer +
// renderToBuffer, fuentes Helvetica built-in, sin dependencias nuevas).
//
// SEGURIDAD MULTI-TENANT: el clinicId SIEMPRE sale de la sesión; el pedido se
// busca por (clinicId + orderId) → una clínica jamás descarga el comprobante
// de otra.

// El pedido guarda el método de pago B2B como string libre
// (TRANSFER/MERCADOPAGO/CASH). Lo mapeamos a una etiqueta presentable.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  TRANSFER: "Transferencia (SPEI)",
  MERCADOPAGO: "MercadoPago",
  CASH: "Efectivo",
};

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ReceiptProps {
  clinicName: string;
  orderNumber: string;
  createdAt: string; // ISO
  statusLabel: string;
  paymentStatusLabel: string;
  paymentMethodLabel: string;
  supplierName: string;
  supplierRfc: string | null;
  supplierEmail: string;
  supplierPhone: string | null;
  items: ReceiptItem[];
  subtotal: number;
  total: number;
  notes: string | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#14101f",
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
  brand: {
    fontSize: 18,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
  },
  brandSub: {
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
  colName: { width: "46%" },
  colQty: { width: "12%", textAlign: "right" },
  colUnit: { width: "21%", textAlign: "right" },
  colTotal: { width: "21%", textAlign: "right" },
  totals: {
    marginTop: 16,
    alignItems: "flex-end",
  },
  totalLine: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "55%",
    paddingVertical: 3,
  },
  totalLabel: { fontSize: 10, color: "#6b6b78", width: "55%", textAlign: "right", paddingRight: 10 },
  totalValue: { fontSize: 10, color: "#14101f", width: "45%", textAlign: "right" },
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
  grandRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "55%",
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#d4d4dc",
  },
  notesBox: {
    marginTop: 22,
    padding: 10,
    backgroundColor: "#faf9fc",
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#7c3aed",
  },
  notesTitle: {
    fontSize: 8.5,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  notesText: { fontSize: 9.5, color: "#3f3a4a" },
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

function SupplierReceiptDocument(props: ReceiptProps) {
  const generatedAt = new Date(props.createdAt).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Document
      title={`Comprobante ${props.orderNumber}`}
      author="MediFlow"
      subject={`Pedido ${props.orderNumber}`}
    >
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>MediFlow</Text>
            <Text style={styles.brandSub}>Comprobante de compra</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Pedido</Text>
            <Text style={styles.metaValue}>{props.orderNumber}</Text>
            <Text style={styles.metaSmall}>{generatedAt}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Proveedor</Text>
            <Text style={styles.infoStrong}>{props.supplierName}</Text>
            {props.supplierRfc ? (
              <Text style={styles.infoLine}>RFC: {props.supplierRfc}</Text>
            ) : null}
            <Text style={styles.infoLine}>{props.supplierEmail}</Text>
            {props.supplierPhone ? (
              <Text style={styles.infoLine}>Tel: {props.supplierPhone}</Text>
            ) : null}
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Clínica</Text>
            <Text style={styles.infoStrong}>{props.clinicName}</Text>
            <Text style={styles.infoLine}>Método de pago: {props.paymentMethodLabel}</Text>
            <View style={styles.badgeRow}>
              <Text style={styles.badge}>Estatus: {props.statusLabel}</Text>
              <Text style={styles.badge}>Pago: {props.paymentStatusLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tableHeader} fixed>
          <Text style={[styles.th, styles.colName]}>Producto</Text>
          <Text style={[styles.th, styles.colQty]}>Cant.</Text>
          <Text style={[styles.th, styles.colUnit]}>P. unitario</Text>
          <Text style={[styles.th, styles.colTotal]}>Subtotal</Text>
        </View>

        {props.items.map((it, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={[styles.td, styles.colName]}>{it.name}</Text>
            <Text style={[styles.td, styles.colQty]}>{it.quantity}</Text>
            <Text style={[styles.td, styles.colUnit, styles.tdMuted]}>{fmtMXN(it.unitPrice)}</Text>
            <Text style={[styles.td, styles.colTotal]}>{fmtMXN(it.lineTotal)}</Text>
          </View>
        ))}

        {props.items.length === 0 && (
          <View style={[styles.tableRow, { justifyContent: "center", paddingVertical: 20 }]}>
            <Text style={[styles.td, styles.tdMuted]}>Este pedido no tiene partidas.</Text>
          </View>
        )}

        <View style={styles.totals}>
          <View style={styles.totalLine}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{fmtMXN(props.subtotal)}</Text>
          </View>
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>{fmtMXN(props.total)}</Text>
          </View>
        </View>

        {props.notes ? (
          <View style={styles.notesBox} wrap={false}>
            <Text style={styles.notesTitle}>Notas</Text>
            <Text style={styles.notesText}>{props.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          MediFlow · Comprobante de compra · Documento informativo sin valor fiscal ·
          Pedido {props.orderNumber}
        </Text>
      </Page>
    </Document>
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const order = await prisma.supplierOrder.findFirst({
    where: { id: params.orderId, clinicId: ctx.clinicId },
    include: {
      supplier: true,
      items: true,
      clinic: { select: { name: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const props: ReceiptProps = {
    clinicName: order.clinic?.name ?? "Clínica",
    orderNumber: order.orderNumber,
    createdAt: order.createdAt.toISOString(),
    statusLabel: SUPPLIER_ORDER_STATUS_LABELS[order.status] ?? order.status,
    paymentStatusLabel:
      SUPPLIER_PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus,
    paymentMethodLabel: order.paymentMethod
      ? PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod
      : "—",
    supplierName: order.supplier.businessName,
    supplierRfc: order.supplier.rfc,
    supplierEmail: order.supplier.email,
    supplierPhone: order.supplier.phone,
    items: order.items.map((it) => ({
      name: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.lineTotal,
    })),
    subtotal: order.subtotal,
    total: order.total,
    notes: order.notes,
  };

  const buffer = await renderToBuffer(<SupplierReceiptDocument {...props} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="comprobante-${order.orderNumber}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
