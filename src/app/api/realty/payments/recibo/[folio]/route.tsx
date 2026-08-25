// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/payments/recibo/[folio] → el RECIBO en PDF
//
// 🔴 ES UN RECIBO DE RENTA. NO es una factura, no es un CFDI, no está
// timbrado ante el SAT y el pie lo dice con esas palabras. Este vertical no
// tiene facturación: si una pantalla dijera "factura", estaría mal.
//
// El folio ES la dirección del documento: RealtyPayment.receiptUrl guarda
// justo esta ruta (/api/realty/payments/recibo/REC-000123), así que el
// número que ve el inquilino y la liga que abre son lo mismo. El folio se
// emitió con un MAX (nunca un count+1) — ver emitReceipt.
//
// Multi-tenant: el pago se busca por (accountId de la sesión + folio). Una
// cuenta no puede descargar el recibo de otra ni adivinando el folio.
//
// Stack de PDF del repo: @react-pdf/renderer + renderToBuffer, fuentes
// Helvetica built-in (cubren los acentos del español), runtime nodejs
// porque @react-pdf no corre en edge.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  findPaymentByFolio,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
} from "@/lib/realty/leases";
import { formatLongDate, formatMoney, monthLabel, toCents, centsToNumber } from "@/lib/realty/rent-charges";
import { REALTY_PAYMENT_METHOD_LABELS, type RealtyCurrency } from "@/lib/realty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verde pino del vertical (el mismo #2F6B4D del tema del panel).
const PINE = "#2F6B4D";
const INK = "#14201A";
const MUTED = "#5B6B62";
const RULE = "#D8E2DB";

const styles = StyleSheet.create({
  page: {
    padding: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    backgroundColor: "#FFFFFF",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: PINE,
    paddingBottom: 12,
    marginBottom: 20,
  },
  title: { fontSize: 19, color: PINE, fontFamily: "Helvetica-Bold" },
  titleSub: { fontSize: 9, color: MUTED, marginTop: 3 },
  metaBox: { textAlign: "right" },
  metaLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  metaValue: { fontSize: 14, color: INK, fontFamily: "Helvetica-Bold", marginTop: 2 },
  metaSmall: { fontSize: 9, color: MUTED, marginTop: 3 },

  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  infoCol: { width: "48%" },
  infoTitle: {
    fontSize: 8,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  infoStrong: { fontSize: 11, color: INK, fontFamily: "Helvetica-Bold" },
  infoLine: { fontSize: 9.5, color: MUTED, marginTop: 2 },

  sectionTitle: {
    fontSize: 8,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  detailRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  detailLabel: { width: "40%", fontSize: 9.5, color: MUTED },
  detailValue: { width: "60%", fontSize: 9.5, color: INK },

  amountBox: { marginTop: 22, alignItems: "flex-end" },
  amountRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "62%",
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  amountLabel: {
    fontSize: 11,
    color: INK,
    fontFamily: "Helvetica-Bold",
    width: "52%",
    textAlign: "right",
    paddingRight: 10,
  },
  amountValue: {
    fontSize: 16,
    color: PINE,
    fontFamily: "Helvetica-Bold",
    width: "48%",
    textAlign: "right",
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "62%",
    paddingTop: 6,
  },
  balanceLabel: { fontSize: 9.5, color: MUTED, width: "52%", textAlign: "right", paddingRight: 10 },
  balanceValue: { fontSize: 9.5, width: "48%", textAlign: "right", fontFamily: "Helvetica-Bold" },

  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 54 },
  signCol: { width: "45%" },
  signLine: { borderTopWidth: 0.8, borderTopColor: INK, marginBottom: 4 },
  signLabel: { fontSize: 8.5, color: MUTED, textAlign: "center" },

  footer: {
    position: "absolute",
    bottom: 30,
    left: 44,
    right: 44,
    fontSize: 7.5,
    color: "#94A39A",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 8,
  },
  footerLine: { marginTop: 2 },
});

interface ReceiptProps {
  folio: string;
  accountName: string;
  accountPhone: string | null;
  accountEmail: string | null;
  tenantName: string;
  propertyTitle: string;
  propertyAddress: string;
  periodLabel: string | null;
  paidAt: string;
  methodLabel: string;
  reference: string | null;
  amountLabel: string;
  chargeLabel: string | null;
  balanceLabel: string | null;
  partial: boolean;
}

function ReciboRentaDocument(p: ReceiptProps) {
  return (
    <Document
      title={`Recibo de renta ${p.folio}`}
      author={p.accountName}
      subject={`Recibo de pago de renta — ${p.folio}`}
    >
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header}>
          <View style={{ maxWidth: 300 }}>
            <Text style={styles.title}>Recibo de renta</Text>
            <Text style={styles.titleSub}>{p.accountName}</Text>
            {p.accountPhone ? <Text style={styles.titleSub}>Tel: {p.accountPhone}</Text> : null}
            {p.accountEmail ? <Text style={styles.titleSub}>{p.accountEmail}</Text> : null}
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Folio</Text>
            <Text style={styles.metaValue}>{p.folio}</Text>
            <Text style={styles.metaSmall}>{formatLongDate(p.paidAt)}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Recibí de</Text>
            <Text style={styles.infoStrong}>{p.tenantName}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoTitle}>Por el inmueble</Text>
            <Text style={styles.infoStrong}>{p.propertyTitle}</Text>
            {p.propertyAddress ? (
              <Text style={styles.infoLine}>{p.propertyAddress}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Detalle del pago</Text>
        {p.periodLabel ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Periodo que cubre</Text>
            <Text style={styles.detailValue}>{p.periodLabel}</Text>
          </View>
        ) : null}
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Fecha de pago</Text>
          <Text style={styles.detailValue}>{formatLongDate(p.paidAt)}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Forma de pago</Text>
          <Text style={styles.detailValue}>{p.methodLabel}</Text>
        </View>
        {p.reference ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Referencia</Text>
            <Text style={styles.detailValue}>{p.reference}</Text>
          </View>
        ) : null}
        {p.chargeLabel ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Renta del periodo</Text>
            <Text style={styles.detailValue}>{p.chargeLabel}</Text>
          </View>
        ) : null}

        <View style={styles.amountBox}>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Cantidad recibida</Text>
            <Text style={styles.amountValue}>{p.amountLabel}</Text>
          </View>
          {p.balanceLabel ? (
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>
                {p.partial ? "Saldo que queda pendiente" : "Saldo del periodo"}
              </Text>
              <Text
                style={[
                  styles.balanceValue,
                  { color: p.partial ? "#B45309" : "#047857" },
                ]}
              >
                {p.balanceLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.signRow}>
          <View style={styles.signCol}>
            <View style={styles.signLine} />
            <Text style={styles.signLabel}>Recibió</Text>
          </View>
          <View style={styles.signCol}>
            <View style={styles.signLine} />
            <Text style={styles.signLabel}>Entregó</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            Este documento es un recibo de pago de renta. No es un comprobante fiscal.
          </Text>
          <Text style={styles.footerLine}>
            {p.accountName} · Folio {p.folio} · Generado con DaleControl Inmuebles
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function GET(_req: NextRequest, { params }: { params: { folio: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "payments.manage");
  } catch {
    return realtyForbidden("payments.manage");
  }

  try {
    const payment = await findPaymentByFolio(ctx, params.folio);
    if (!payment) {
      return NextResponse.json({ error: "No encontramos ese recibo." }, { status: 404 });
    }

    const currency: RealtyCurrency = payment.lease?.currency ?? "MXN";
    const tenant =
      (payment.lease?.parties ?? []).find((p) => p.role === "INQUILINO") ??
      (payment.lease?.parties ?? [])[0] ??
      null;

    const prop = payment.lease?.property;
    const address = [prop?.address, prop?.colonia, prop?.city, prop?.state]
      .filter(Boolean)
      .join(", ");

    const amountCents = toCents(payment.amount);
    const chargeCents = payment.charge ? toCents(payment.charge.amount) : 0;

    // El saldo del periodo se calcula con los abonos ANTERIORES más este,
    // no con todos los que existan hoy. Dos motivos:
    //  · Un recibo que ignore los abonos previos diría que se debe de más, y
    //    el inquilino llega con razón a reclamar.
    //  · 🔴 Un RECIBO CON FOLIO ES UN DOCUMENTO CONGELADO. Sumando también
    //    los pagos POSTERIORES, reimprimir REC-000123 después de liquidar
    //    imprimía "Saldo $0.00" donde el día que se entregó decía "$7,000.00":
    //    el mismo folio enseñando números distintos según cuándo lo abras.
    //    El corte va por (paidAt, createdAt, id) para que sea estable aunque
    //    dos abonos caigan el mismo día.
    let paidAllCents = amountCents;
    if (payment.chargeId) {
      const { prisma } = await import("@/lib/prisma");
      const siblings = await prisma.realtyPayment.findMany({
        where: {
          accountId: ctx.accountId,
          chargeId: payment.chargeId,
          OR: [
            { paidAt: { lt: payment.paidAt } },
            {
              paidAt: payment.paidAt,
              OR: [
                { createdAt: { lt: payment.createdAt } },
                { createdAt: payment.createdAt, id: { lte: payment.id } },
              ],
            },
          ],
        },
        select: { amount: true },
      });
      paidAllCents = siblings.reduce((sum, s) => sum + toCents(s.amount), 0);
    }
    const balanceCents = payment.charge ? Math.max(0, chargeCents - paidAllCents) : 0;

    const props: ReceiptProps = {
      folio: params.folio,
      accountName: ctx.account.name,
      accountPhone: ctx.account.phone,
      accountEmail: ctx.account.email,
      tenantName: tenant?.contact?.name ?? "Inquilino",
      propertyTitle: prop?.title ?? "Inmueble",
      propertyAddress: address,
      periodLabel: payment.charge ? monthLabel(payment.charge.periodMonth) : null,
      paidAt: payment.paidAt.toISOString(),
      methodLabel: REALTY_PAYMENT_METHOD_LABELS[payment.method] ?? payment.method,
      reference: payment.reference,
      amountLabel: formatMoney(centsToNumber(amountCents), currency),
      chargeLabel: payment.charge ? formatMoney(centsToNumber(chargeCents), currency) : null,
      balanceLabel: payment.charge ? formatMoney(centsToNumber(balanceCents), currency) : null,
      partial: balanceCents > 0,
    };

    const buffer = await renderToBuffer(<ReciboRentaDocument {...props} />);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="recibo-${params.folio}.pdf"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    return realtyApiError(err, "payments:receipt-pdf");
  }
}
