// Comprobante de pago A4 (CARTA) — NO fiscal. Server-only (@react-pdf no corre
// en edge ni en el cliente).
//
// Extraído de GET /api/invoices/[id]/print para poder REUSAR el mismo PDF como
// adjunto del aviso de saldo por WhatsApp (send-whatsapp) sin duplicar ni el
// query ni el mapeo de conceptos. El endpoint print conserva su auth, permiso
// y visibilidad por paciente; aquí solo se genera el documento con el scope de
// clínica que pase el caller (mismo patrón que lib/quotes/quote-pdf).

import { prisma } from "@/lib/prisma";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import {
  ZONA_POR_DEFECTO,
  diaEnZona,
  fechaDeMovimiento,
  planParaComprobante,
  type PlanDelComprobante,
} from "@/lib/invoices/plan-en-comprobante";
import { itemQuantity, itemUnitPrice, itemLineTotal, invoicePrintTotals, round2 } from "@/lib/invoice-totals";
import {
  ClinicLetterhead,
  CLINIC_LETTERHEAD_SELECT,
  clinicLetterheadProps,
  type ClinicLetterheadClinic,
} from "@/lib/pdf/clinic-letterhead";
import {
  renderToBuffer,
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

const BRAND = "#2563eb";

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", debit: "Tarjeta de débito", credit: "Tarjeta de crédito",
  transfer: "Transferencia", check: "Cheque", refund: "Reembolso",
  other: "Otro", online: "Pago en línea (tarjeta)",
  mercadopago: "Mercado Pago",
  anticipo: "Anticipo (saldo a favor)",
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
  // paddingBottom: colchón para el pie fijo, que puede llevar tres renglones
  // (leyenda, UUID del CFDI y «Página N de M»). Sin él, en un comprobante que
  // pagina, el filete del pie tachaba el último renglón del cuerpo —medido: el
  // «Subtotal» de una factura de 45 conceptos—.
  page: { padding: 40, paddingBottom: 80, fontFamily: "Helvetica", fontSize: 10, color: "#0f172a" },

  metaBox: { textAlign: "right" },
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

  // ws1-t10 — factura a plazos: la forma de pago y el calendario de cuotas.
  formaPago: { fontSize: 10, color: "#0f172a", lineHeight: 1.4, marginTop: 16 },
  formaPagoLabel: { fontFamily: "Helvetica-Bold" },
  planHeader: {
    flexDirection: "row", backgroundColor: "#eff6ff", paddingVertical: 5, paddingHorizontal: 6,
    borderBottomWidth: 1, borderBottomColor: "#bfdbfe",
  },
  planRow: {
    flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6,
    borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0",
  },
  planColEtiqueta: { width: "26%" },
  planColFecha: { width: "20%" },
  planColMonto: { width: "22%", textAlign: "right" },
  planColEstado: { width: "32%", textAlign: "right" },

  footer: {
    position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#94a3b8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 8,
  },
  pageNum: { fontSize: 7.5, color: "#94a3b8", textAlign: "center", marginTop: 2 },
});

interface ComprobanteProps {
  clinic: ClinicLetterheadClinic;
  invoice: { invoiceNumber: string; createdAt: Date; status: string; subtotal: number; discount: number; total: number; paid: number; balance: number; cfdiUuid: string | null; taxRate: number | null; taxIncluded: boolean | null };
  patient: { name: string; rfc: string | null; razonSocial: string | null; regimen: string | null; cp: string | null };
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  payments: { amount: number; method: string; reference: string | null; paidAt: Date }[];
  /** ws1-t10: solo una factura A PLAZOS lo trae; sin él el comprobante sale como siempre. */
  plan?: PlanDelComprobante | null;
  /** Zona de la clínica, para las fechas de los movimientos del plan. */
  zona?: string;
}

const ESTADO_COLOR: Record<string, string> = { pagada: "#047857", porVencer: "#64748b", vencida: "#b91c1c" };

/** Un renglón de «Pagos realizados / recibidos». */
function FilaDePago({ pay, plan, zona }: { pay: ComprobanteProps["payments"][number]; plan: boolean; zona?: string }) {
  const reembolso = plan && pay.method === "refund";
  return (
    <View style={styles.payRow} wrap={false}>
      <View>
        <Text style={styles.payLeft}>{METHOD_LABELS[pay.method] ?? pay.method}</Text>
        <Text style={styles.paySub}>
          {plan ? fechaDeMovimiento(pay.paidAt, zona) : fmtFecha(pay.paidAt)}
          {pay.reference ? `  ·  Ref: ${pay.reference}` : ""}
        </Text>
      </View>
      <Text style={[styles.payAmount, reembolso ? { color: "#b45309" } : {}]}>
        {reembolso ? "−" : ""}{fmtMXN(pay.amount)}
      </Text>
    </View>
  );
}

function ComprobanteDocument(p: ComprobanteProps) {
  const plan = p.plan ?? null;
  const sello = estadoSello(p.invoice.status, p.invoice.paid, p.invoice.balance);
  // Renglones de dinero que hacen cuadrar el documento: con "IVA agregado" las
  // líneas suman la base y el TOTAL trae el impuesto encima.
  const totales = invoicePrintTotals(p.invoice);

  return (
    <Document title={`Comprobante ${p.invoice.invoiceNumber}`} author={p.clinic.clinicName} subject="Comprobante de pago">
      <Page size="LETTER" style={styles.page} wrap>
        {/* Encabezado — membrete común (logo + clínica) y, a la derecha, folio,
            fecha y sello de estado. El RFC del emisor entra por el membrete:
            este comprobante NO es fiscal, pero quien lo recibe necesita saber
            de qué clínica sale. */}
        <ClinicLetterhead
          {...p.clinic}
          accent={BRAND}
          right={
            <View style={styles.metaBox}>
              <Text style={styles.metaTitle}>COMPROBANTE DE PAGO</Text>
              <Text style={styles.metaLabel}>Folio</Text>
              <Text style={styles.metaValue}>{p.invoice.invoiceNumber}</Text>
              <Text style={styles.metaLabel}>Fecha</Text>
              <Text style={styles.metaValue}>{fmtFecha(p.invoice.createdAt)}</Text>
              <Text style={[styles.sello, { color: sello.color, backgroundColor: sello.bg }]}>{sello.label}</Text>
            </View>
          }
        />

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
        {/* Con plan de pagos el encabezado NO se repite: en la hoja 2 quedaría
            «Descripción / Cant. / P. Unitario» sobre las cuotas. */}
        <View style={styles.tableHeader} fixed={!p.plan}>
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
          {/* El Subtotal se imprime en cuanto hay ALGO entre las líneas y el
              TOTAL: un descuento o el IVA agregado. Sin el renglón de IVA el
              comprobante no cuadraba (conceptos $1,000, descuento $100 → TOTAL
              $1,044) y nada en la hoja explicaba la diferencia. */}
          {(p.invoice.discount > 0 || totales.tax > 0) ? (
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{fmtMXN(p.invoice.subtotal)}</Text>
            </View>
          ) : null}
          {p.invoice.discount > 0 ? (
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Descuento</Text>
              <Text style={[styles.totalValue, { color: "#b45309" }]}>−{fmtMXN(p.invoice.discount)}</Text>
            </View>
          ) : null}
          {totales.tax > 0 ? (
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>IVA ({totales.rate}%)</Text>
              <Text style={styles.totalValue}>{fmtMXN(totales.tax)}</Text>
            </View>
          ) : null}
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>TOTAL</Text>
            <Text style={styles.grandValue}>{fmtMXN(p.invoice.total)}</Text>
          </View>
        </View>

        {/* Forma de pago y calendario — SOLO en una factura a plazos (ws1-t10).
            La frase es la de la tarjeta de la factura; el estado de cada cuota
            sale de lo realmente cobrado, no de una tabla aparte. */}
        {plan ? (
          <View>
            <Text style={styles.formaPago}>
              <Text style={styles.formaPagoLabel}>Forma de pago: </Text>
              {plan.frase}
            </Text>

            <Text style={styles.sectionTitle} minPresenceAhead={70}>Plan de pagos</Text>
            <View style={styles.planHeader} wrap={false}>
              <Text style={[styles.th, styles.planColEtiqueta]}>Pago</Text>
              <Text style={[styles.th, styles.planColFecha]}>Fecha</Text>
              <Text style={[styles.th, styles.planColMonto]}>Monto</Text>
              <Text style={[styles.th, styles.planColEstado]}>Estado</Text>
            </View>
            {plan.filas.map((f, i) => (
              <View key={i} style={styles.planRow} wrap={false}>
                <Text style={[styles.td, styles.planColEtiqueta]}>{f.etiqueta}</Text>
                <Text style={[styles.td, styles.planColFecha]}>{f.fecha}</Text>
                <Text style={[styles.td, styles.planColMonto]}>{fmtMXN(f.monto)}</Text>
                <Text style={[styles.td, styles.planColEstado, { color: ESTADO_COLOR[f.estado] }]}>{f.texto}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Pagos. El resumen (Pagado / Saldo) NO se parte ni queda solo en la hoja
            siguiente (ws1-t10, fallo 5 de la revisión en panel.108: la hoja 2 de MF-1031
            llevaba únicamente «Saldo»): se agrupa con el ÚLTIMO pago, así que si no cabe
            en la hoja pasan juntos; y el título no se queda solo al pie de una hoja. */}
        <Text style={styles.sectionTitle} minPresenceAhead={70}>{plan ? "Pagos recibidos" : "Pagos realizados"}</Text>
        {p.payments.length === 0 ? null : p.payments.slice(0, -1).map((pay, i) => <FilaDePago key={i} pay={pay} plan={!!plan} zona={p.zona} />)}
        <View wrap={false}>
          {p.payments.length === 0
            ? <Text style={[styles.td, styles.tdMuted]}>Sin pagos registrados.</Text>
            : <FilaDePago pay={p.payments[p.payments.length - 1]} plan={!!plan} zona={p.zona} />}
          {plan ? (
            <View style={[styles.totalLine, { marginTop: 8 }]}>
              <Text style={styles.totalLabel}>Pagado</Text>
              <Text style={[styles.totalValue, { fontFamily: "Helvetica-Bold", color: "#047857" }]}>{fmtMXN(p.invoice.paid)}</Text>
            </View>
          ) : null}
          <View style={[styles.totalLine, { marginTop: plan ? 0 : 8 }]}>
            <Text style={styles.totalLabel}>{plan ? "Saldo" : "Saldo pendiente"}</Text>
            <Text style={[styles.totalValue, { fontFamily: "Helvetica-Bold", color: p.invoice.balance > 0 ? "#b91c1c" : "#047857" }]}>
              {fmtMXN(p.invoice.balance)}
            </Text>
          </View>
        </View>

        {/* Pie — va `fixed`, así que es lo que sostiene la identidad en la
            página 2 y siguientes: el membrete solo sale en la primera. */}
        <View style={styles.footer} fixed>
          <Text>
            {p.clinic.clinicName} · Comprobante {p.invoice.invoiceNumber} · Este documento es un
            comprobante de pago, NO es una factura fiscal (CFDI).
            {p.invoice.cfdiUuid ? `\nCFDI timbrado · UUID: ${p.invoice.cfdiUuid}` : ""}
          </Text>
          <Text
            style={styles.pageNum}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/**
 * Genera el comprobante PDF de una factura, con scope multi-tenant por
 * `clinicId`. Devuelve null si la factura no existe en esa clínica.
 *
 * La VISIBILIDAD por paciente NO se verifica aquí: el caller la comprueba
 * ANTES de llamar (igual que hacen las rutas con buildQuotePdf), porque el
 * comprobante renderiza nombre + RFC del paciente y no debe generarse para
 * quien no puede verlo.
 */
export async function buildInvoicePrintPdf(
  id: string,
  clinicId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, clinicId }, // scope multi-tenant
    select: {
      invoiceNumber: true, createdAt: true, status: true,
      subtotal: true, discount: true, total: true, paid: true, balance: true, cfdiUuid: true,
      // Sin estas dos el comprobante no sabía si el TOTAL trae IVA agregado.
      taxRate: true, taxIncluded: true,
      items: true,
      // logoUrl entra por CLINIC_LETTERHEAD_SELECT; rfcEmisor se suma aparte
      // porque el membrete solo pinta el fiscal donde corresponde y aquí sí.
      clinic:  { select: { ...CLINIC_LETTERHEAD_SELECT, rfcEmisor: true, timezone: true } },
      patient: { select: { firstName: true, lastName: true, rfcPaciente: true, razonSocialPac: true, regimenFiscalPac: true, cpPaciente: true } },
      payments: { orderBy: { paidAt: "asc" }, select: { amount: true, method: true, reference: true, paidAt: true } },
    },
  });
  if (!invoice) return null;

  const rawItems = Array.isArray(invoice.items) ? (invoice.items as any[]) : [];
  // Cantidad/precio/importe con los MISMOS fallbacks que el mapeo de conceptos
  // del CFDI (invoice-totals). Los que había aquí eran propios y no espejaban
  // itemLineTotal: una línea con cantidad ≠ 1 o con descuento de línea se
  // imprimía por un importe distinto al que se timbra.
  const items = rawItems.map((it: any) => {
    // Facturas ANTERIORES al descuento de línea explícito: zod stripeaba la
    // llave `discount` del item y el cliente mandaba `total` ya NETO, así que
    // el importe histórico de esa línea solo vive en `total` y no se puede
    // recomputar (su `invoice.total` también se sumó de esos netos). Solo en
    // ese caso —sin descuento propio y con un `total` guardado MENOR al
    // bruto— se respeta lo guardado, para que el comprobante impreso de una
    // factura vieja siga cuadrando con su total. El resto usa itemLineTotal,
    // que es exactamente lo que se timbra.
    const gross  = round2(itemQuantity(it) * itemUnitPrice(it));
    const stored = Number(it?.total);
    const legacyNet = it?.discount == null && isFinite(stored) && stored >= 0 && stored < gross;
    return {
      // Las facturas viejas guardaban el concepto en `name`; se sigue leyendo.
      description: String(it.description ?? it.name ?? "Servicio médico"),
      quantity:  itemQuantity(it),
      unitPrice: itemUnitPrice(it),
      total:     legacyNet ? round2(stored) : itemLineTotal(it),
    };
  });

  const props: ComprobanteProps = {
    // El logo se baja aquí (data URL + proporción). Si el bucket falla, tarda o
    // guarda un formato que @react-pdf no pinta, esto devuelve null y la
    // cabecera saca el nombre en grande: el comprobante SIEMPRE se genera.
    clinic: {
      ...(await clinicLetterheadProps(invoice.clinic)),
      clinicTaxId: invoice.clinic?.rfcEmisor ?? null,
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
      taxRate:       invoice.taxRate,
      taxIncluded:   invoice.taxIncluded,
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

  // ws1-t10 — una factura A PLAZOS (invoice_payment_terms) explica cómo se paga.
  // Nunca tumba el comprobante: sin la tabla, sin condiciones o con un fallo de
  // lectura sale como siempre.
  const zona = invoice.clinic?.timezone || ZONA_POR_DEFECTO;
  try {
    const { porFactura } = await leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds: [id] });
    props.plan = planParaComprobante({
      total: invoice.total,
      condiciones: porFactura.get(id),
      movimientos: props.payments.map((pay) => ({ amount: pay.amount, method: pay.method, paidAt: pay.paidAt })),
      hoy: diaEnZona(new Date(), zona),
      zona,
    });
    props.zona = zona;
  } catch (e) {
    console.warn("[comprobante] no se pudo leer el plan de pagos:", e);
  }

  const buffer = await renderToBuffer(<ComprobanteDocument {...props} />);
  return { buffer, fileName: `comprobante-${invoice.invoiceNumber}.pdf` };
}
