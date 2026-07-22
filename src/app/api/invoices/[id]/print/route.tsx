import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import {
  renderToBuffer,
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export const runtime = "nodejs"; // @react-pdf/renderer no corre en edge
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Comprobante de pago A4 (CARTA) — NO fiscal. Reusa el stack del recibo del
// paciente. Azul de marca en acentos. Multi-tenant por clinicId (getAuthContext).

const BRAND = "#2563eb";

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", debit: "Tarjeta de débito", credit: "Tarjeta de crédito",
  transfer: "Transferencia", check: "Cheque", refund: "Reembolso",
  other: "Otro", online: "Pago en línea (tarjeta)",
};

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtFecha(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

// status/saldo → sello de estado grande
function estadoSello(status: string, paid: number, balance: number): { label: string; color: string; bg: string } {
  if (status === "PAID") return { label: "PAGADO", color: "#047857", bg: "#ecfdf5" };
  if (status === "CANCELLED") return { label: "CANCELADA", color: "#6b7280", bg: "#f3f4f6" };
  if (status === "PARTIAL" || (paid > 0 && balance > 0)) return { label: "PARCIAL", color: "#b45309", bg: "#fffbeb" };
  return { label: "PENDIENTE", color: "#b91c1c", bg: "#fef2f2" };
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#0f172a" },

  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 12, marginBottom: 16,
  },
  brand: { fontSize: 18, color: BRAND, fontFamily: "Helvetica-Bold" },
  clinicLine: { fontSize: 9, color: "#475569", marginTop: 2 },

  metaBox: { textAlign: "right", maxWidth: 220 },
  metaTitle: { fontSize: 12, color: "#0f172a", fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  metaLabel: { fontSize: 8.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  metaValue: { fontSize: 10.5, color: "#0f172a", fontFamily: "Helvetica-Bold" },
  sello: {
    marginTop: 8, alignSelf: "flex-end", fontSize: 12, fontFamily: "Helvetica-Bold",
    borderRadius: 5, paddingVertical: 4, paddingHorizontal: 10, letterSpacing: 1,
  },

  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  infoCol: { width: "48%" },
  infoTitle: {
    fontSize: 8.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold", marginBottom: 4,
  },
  infoStrong: { fontSize: 11, color: "#0f172a", fontFamily: "Helvetica-Bold" },
  infoLine: { fontSize: 9.5, color: "#334155", marginTop: 2 },

  tableHeader: {
    flexDirection: "row", backgroundColor: "#eff6ff", paddingVertical: 6, paddingHorizontal: 6,
    borderBottomWidth: 1, borderBottomColor: "#bfdbfe",
  },
  th: { fontSize: 8.5, color: "#1e3a8a", textTransform: "uppercase", letterSpacing: 0.4, fontFamily: "Helvetica-Bold" },
  tableRow: {
    flexDirection: "row", paddingVertical: 7, paddingHorizontal: 6,
    borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0",
  },
  td: { fontSize: 9.5, color: "#0f172a" },
  tdMuted: { color: "#64748b" },
  colDesc: { width: "46%" },
  colQty: { width: "12%", textAlign: "center" },
  colUnit: { width: "21%", textAlign: "right" },
  colAmount: { width: "21%", textAlign: "right" },

  totals: { marginTop: 14, alignItems: "flex-end" },
  totalLine: { flexDirection: "row", justifyContent: "flex-end", width: "60%", paddingVertical: 2.5 },
  totalLabel: { fontSize: 10, color: "#64748b", width: "55%", textAlign: "right", paddingRight: 10 },
  totalValue: { fontSize: 10, color: "#0f172a", width: "45%", textAlign: "right" },
  grandRow: {
    flexDirection: "row", justifyContent: "flex-end", width: "60%", marginTop: 4, paddingTop: 6,
    borderTopWidth: 1, borderTopColor: "#cbd5e1",
  },
  grandLabel: { fontSize: 11, color: "#0f172a", fontFamily: "Helvetica-Bold", width: "55%", textAlign: "right", paddingRight: 10 },
  grandValue: { fontSize: 14, color: BRAND, fontFamily: "Helvetica-Bold", width: "45%", textAlign: "right" },

  sectionTitle: {
    fontSize: 8.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold", marginTop: 20, marginBottom: 6,
  },
  payRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0",
  },
  payLeft: { fontSize: 9.5, color: "#0f172a" },
  paySub: { fontSize: 8.5, color: "#64748b", marginTop: 1 },
  payAmount: { fontSize: 9.5, color: "#047857", fontFamily: "Helvetica-Bold" },

  footer: {
    position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#94a3b8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 8,
  },
});

interface ComprobanteProps {
  clinic: { name: string; address: string | null; city: string | null; state: string | null; phone: string | null; email: string | null; rfcEmisor: string | null };
  invoice: { invoiceNumber: string; createdAt: Date; status: string; subtotal: number; discount: number; total: number; paid: number; balance: number; cfdiUuid: string | null };
  patient: { name: string; rfc: string | null; razonSocial: string | null; regimen: string | null; cp: string | null };
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  payments: { amount: number; method: string; reference: string | null; paidAt: Date }[];
}

function ComprobanteDocument(p: ComprobanteProps) {
  const sello = estadoSello(p.invoice.status, p.invoice.paid, p.invoice.balance);
  const clinicAddr = [p.clinic.address, [p.clinic.city, p.clinic.state].filter(Boolean).join(", ")].filter(Boolean);

  return (
    <Document title={`Comprobante ${p.invoice.invoiceNumber}`} author={p.clinic.name} subject="Comprobante de pago">
      <Page size="LETTER" style={styles.page} wrap>
        {/* Encabezado */}
        <View style={styles.header}>
          <View style={{ maxWidth: 300 }}>
            <Text style={styles.brand}>{p.clinic.name}</Text>
            {clinicAddr.map((l, i) => <Text key={i} style={styles.clinicLine}>{l}</Text>)}
            {p.clinic.phone ? <Text style={styles.clinicLine}>Tel: {p.clinic.phone}</Text> : null}
            {p.clinic.email ? <Text style={styles.clinicLine}>{p.clinic.email}</Text> : null}
            {p.clinic.rfcEmisor ? <Text style={styles.clinicLine}>RFC: {p.clinic.rfcEmisor}</Text> : null}
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaTitle}>COMPROBANTE DE PAGO</Text>
            <Text style={styles.metaLabel}>Folio</Text>
            <Text style={styles.metaValue}>{p.invoice.invoiceNumber}</Text>
            <Text style={styles.metaLabel}>Fecha</Text>
            <Text style={styles.metaValue}>{fmtFecha(p.invoice.createdAt)}</Text>
            <Text style={[styles.sello, { color: sello.color, backgroundColor: sello.bg }]}>{sello.label}</Text>
          </View>
        </View>

        {/* Paciente + fiscales */}
        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Paciente</Text>
            <Text style={styles.infoStrong}>{p.patient.name}</Text>
            {p.patient.razonSocial ? <Text style={styles.infoLine}>{p.patient.razonSocial}</Text> : null}
            {p.patient.rfc ? <Text style={styles.infoLine}>RFC: {p.patient.rfc}</Text> : null}
            {(p.patient.regimen || p.patient.cp) ? (
              <Text style={styles.infoLine}>
                {p.patient.regimen ? `Régimen: ${p.patient.regimen}` : ""}
                {p.patient.regimen && p.patient.cp ? "  ·  " : ""}
                {p.patient.cp ? `CP: ${p.patient.cp}` : ""}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Conceptos */}
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.th, styles.colDesc]}>Descripción</Text>
          <Text style={[styles.th, styles.colQty]}>Cant.</Text>
          <Text style={[styles.th, styles.colUnit]}>P. Unitario</Text>
          <Text style={[styles.th, styles.colAmount]}>Importe</Text>
        </View>
        {p.items.length === 0 ? (
          <View style={styles.tableRow}><Text style={[styles.td, styles.tdMuted]}>Sin conceptos</Text></View>
        ) : p.items.map((it, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={[styles.td, styles.colDesc]}>{it.description}</Text>
            <Text style={[styles.td, styles.colQty]}>{it.quantity}</Text>
            <Text style={[styles.td, styles.colUnit]}>{fmtMXN(it.unitPrice)}</Text>
            <Text style={[styles.td, styles.colAmount]}>{fmtMXN(it.total)}</Text>
          </View>
        ))}

        {/* Totales */}
        <View style={styles.totals}>
          {p.invoice.discount > 0 ? (
            <>
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>{fmtMXN(p.invoice.subtotal)}</Text>
              </View>
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Descuento</Text>
                <Text style={[styles.totalValue, { color: "#b45309" }]}>−{fmtMXN(p.invoice.discount)}</Text>
              </View>
            </>
          ) : null}
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>TOTAL</Text>
            <Text style={styles.grandValue}>{fmtMXN(p.invoice.total)}</Text>
          </View>
        </View>

        {/* Pagos */}
        <Text style={styles.sectionTitle}>Pagos realizados</Text>
        {p.payments.length === 0 ? (
          <Text style={[styles.td, styles.tdMuted]}>Sin pagos registrados.</Text>
        ) : p.payments.map((pay, i) => (
          <View key={i} style={styles.payRow} wrap={false}>
            <View>
              <Text style={styles.payLeft}>{METHOD_LABELS[pay.method] ?? pay.method}</Text>
              <Text style={styles.paySub}>{fmtFecha(pay.paidAt)}{pay.reference ? `  ·  Ref: ${pay.reference}` : ""}</Text>
            </View>
            <Text style={styles.payAmount}>{fmtMXN(pay.amount)}</Text>
          </View>
        ))}
        <View style={[styles.totalLine, { marginTop: 8 }]}>
          <Text style={styles.totalLabel}>Saldo pendiente</Text>
          <Text style={[styles.totalValue, { fontFamily: "Helvetica-Bold", color: p.invoice.balance > 0 ? "#b91c1c" : "#047857" }]}>
            {fmtMXN(p.invoice.balance)}
          </Text>
        </View>

        {/* Pie */}
        <Text style={styles.footer} fixed>
          Este documento es un comprobante de pago, NO es una factura fiscal (CFDI).
          {p.invoice.cfdiUuid ? `\nCFDI timbrado · UUID: ${p.invoice.cfdiUuid}` : ""}
        </Text>
      </Page>
    </Document>
  );
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId }, // scope multi-tenant
    select: {
      patientId: true,
      invoiceNumber: true, createdAt: true, status: true,
      subtotal: true, discount: true, total: true, paid: true, balance: true, cfdiUuid: true,
      items: true,
      clinic:  { select: { name: true, address: true, city: true, state: true, phone: true, email: true, rfcEmisor: true } },
      patient: { select: { firstName: true, lastName: true, rfcPaciente: true, razonSocialPac: true, regimenFiscalPac: true, cpPaciente: true } },
      payments: { orderBy: { paidAt: "asc" }, select: { amount: true, method: true, reference: true, paidAt: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  // Visibilidad: el comprobante PDF renderiza nombre + RFC + razón social del
  // paciente. Si este usuario no puede verlo, 404 — no generar el PDF.
  if (invoice.patientId) {
    const denied = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  try {
    const rawItems = Array.isArray(invoice.items) ? (invoice.items as any[]) : [];
    const items = rawItems.map((it: any) => {
      const quantity  = Number(it.quantity ?? 1) || 1;
      const total     = Number(it.total ?? it.unitPrice ?? it.price ?? 0) || 0;
      const unitPrice = Number(it.unitPrice ?? it.price ?? (quantity ? total / quantity : total)) || 0;
      return { description: String(it.description ?? it.name ?? "Servicio médico"), quantity, unitPrice, total };
    });

    const props: ComprobanteProps = {
      clinic: {
        name:    invoice.clinic?.name ?? "Clínica",
        address: invoice.clinic?.address ?? null,
        city:    invoice.clinic?.city ?? null,
        state:   invoice.clinic?.state ?? null,
        phone:   invoice.clinic?.phone ?? null,
        email:   invoice.clinic?.email ?? null,
        rfcEmisor: invoice.clinic?.rfcEmisor ?? null,
      },
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        createdAt:     invoice.createdAt,
        status:        invoice.status,
        subtotal:      invoice.subtotal,
        discount:      invoice.discount,
        total:         invoice.total,
        paid:          invoice.paid,
        balance:       invoice.balance,
        cfdiUuid:      invoice.cfdiUuid,
      },
      patient: {
        name:        `${invoice.patient?.firstName ?? ""} ${invoice.patient?.lastName ?? ""}`.trim() || "Paciente",
        rfc:         invoice.patient?.rfcPaciente ?? null,
        razonSocial: invoice.patient?.razonSocialPac ?? null,
        regimen:     invoice.patient?.regimenFiscalPac ?? null,
        cp:          invoice.patient?.cpPaciente ?? null,
      },
      items,
      payments: (invoice.payments ?? []).map((pay) => ({
        amount: pay.amount, method: pay.method, reference: pay.reference, paidAt: pay.paidAt,
      })),
    };

    const buffer = await renderToBuffer(<ComprobanteDocument {...props} />);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `inline; filename="comprobante-${invoice.invoiceNumber}.pdf"`,
        "Cache-Control":       "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Comprobante PDF error:", err);
    return NextResponse.json({ error: "Error generando el comprobante" }, { status: 500 });
  }
}
