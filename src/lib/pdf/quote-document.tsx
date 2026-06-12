import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from "@react-pdf/renderer";

/**
 * QuoteDocument — PDF de presupuesto / cotización para el paciente.
 * Membrete de la clínica (logo si existe), datos del paciente, tabla de ítems
 * agrupada por fase, subtotal/descuento/total, vigencia, espacio de firma y la
 * leyenda informativa. Mismo lenguaje visual que la receta (PrescriptionDocument).
 */

export interface QuotePdfItem {
  name: string;
  toothFdi: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  phase: number | null;
  notes: string | null;
}

export interface QuoteDocumentProps {
  clinicName: string;
  clinicAddress: string | null;
  clinicCity: string | null;
  clinicPhone: string | null;
  clinicEmail: string | null;
  logoDataUrl: string | null;
  patientName: string;
  folio: string;
  title: string;
  statusLabel: string;
  issuedAt: string;
  validUntil: string | null;
  items: QuotePdfItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  notes: string | null;
  acceptedAt: string | null;
  signatureDataUrl: string | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 64,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#14101f",
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#7c3aed",
    paddingBottom: 12,
    marginBottom: 16,
  },
  headerLeft: { flexDirection: "row", gap: 10, alignItems: "flex-start", maxWidth: 330 },
  logo: { width: 44, height: 44, objectFit: "contain" },
  brand: { fontSize: 16, color: "#7c3aed", fontFamily: "Helvetica-Bold" },
  brandSub: { fontSize: 8.5, color: "#6b6b78", marginTop: 1 },
  rxTitle: { fontSize: 13, color: "#7c3aed", fontFamily: "Helvetica-Bold", textAlign: "right" },
  metaRight: { fontSize: 8, color: "#6b6b78", textAlign: "right", marginTop: 4 },
  metaValue: { fontSize: 10, color: "#14101f", fontFamily: "Helvetica-Bold", textAlign: "right" },
  folioMono: { fontSize: 9, color: "#14101f", fontFamily: "Helvetica-Bold", textAlign: "right" },
  block: { backgroundColor: "#f4f2f8", padding: 12, borderRadius: 6, marginBottom: 12 },
  twoCol: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },
  label: {
    fontSize: 8, color: "#6b6b78", textTransform: "uppercase",
    letterSpacing: 0.5, fontFamily: "Helvetica-Bold",
  },
  value: { fontSize: 11, color: "#14101f", fontFamily: "Helvetica-Bold", marginTop: 2 },
  sub: { fontSize: 9, color: "#6b6b78", marginTop: 1 },
  sectionTitle: {
    fontSize: 10, color: "#7c3aed", fontFamily: "Helvetica-Bold",
    textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10, marginBottom: 6,
  },
  // Tabla
  tHead: {
    flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#7c3aed",
    paddingBottom: 4, marginBottom: 2,
  },
  th: { fontSize: 8, color: "#6b6b78", fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  tRow: {
    flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e5ed",
    paddingVertical: 4,
  },
  td: { fontSize: 9.5, color: "#14101f" },
  tdConcept: { fontSize: 9.5, color: "#14101f", fontFamily: "Helvetica-Bold" },
  tdMutedSmall: { fontSize: 8, color: "#6b6b78", marginTop: 1 },
  cConcept: { width: "40%", paddingRight: 6 },
  cTeeth: { width: "13%", paddingRight: 4, textAlign: "left" },
  cQty: { width: "9%", textAlign: "center" },
  cUnit: { width: "13%", textAlign: "right" },
  cDisc: { width: "11%", textAlign: "right" },
  cTotal: { width: "14%", textAlign: "right" },
  totalsBox: { marginTop: 12, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", justifyContent: "flex-end", gap: 16, paddingVertical: 1.5 },
  totalsLabel: { fontSize: 10, color: "#6b6b78", textAlign: "right", width: 120 },
  totalsValue: { fontSize: 10, color: "#14101f", fontFamily: "Helvetica-Bold", textAlign: "right", width: 90 },
  grandLabel: { fontSize: 12, color: "#7c3aed", fontFamily: "Helvetica-Bold", textAlign: "right", width: 120 },
  grandValue: { fontSize: 12, color: "#7c3aed", fontFamily: "Helvetica-Bold", textAlign: "right", width: 90 },
  bottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 30 },
  legendBox: { maxWidth: 280 },
  legend: { fontSize: 8, color: "#6b6b78" },
  signature: { borderTopWidth: 0.5, borderTopColor: "#14101f", paddingTop: 6, width: 200, alignItems: "center" },
  signatureImg: { width: 150, height: 56, objectFit: "contain", marginBottom: 2 },
  signedBadge: { fontSize: 8, color: "#047857", fontFamily: "Helvetica-Bold", marginTop: 3 },
  footer: {
    position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: "#9b9aa8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 8,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtMoney(n: number): string {
  const v = isFinite(Number(n)) ? Number(n) : 0;
  return `$${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface PhaseGroup {
  phase: number | null;
  items: QuotePdfItem[];
}

function groupByPhase(items: QuotePdfItem[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  items.forEach((it) => {
    const key = it.phase == null ? null : it.phase;
    let g = groups.find((x) => x.phase === key);
    if (!g) {
      g = { phase: key, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  });
  // Fases numeradas ascendentes; "sin fase" al final.
  groups.sort((a, b) => {
    if (a.phase == null) return 1;
    if (b.phase == null) return -1;
    return a.phase - b.phase;
  });
  return groups;
}

function ItemsTableHead() {
  return (
    <View style={styles.tHead}>
      <Text style={[styles.th, styles.cConcept]}>Concepto</Text>
      <Text style={[styles.th, styles.cTeeth]}>Dientes</Text>
      <Text style={[styles.th, styles.cQty]}>Cant.</Text>
      <Text style={[styles.th, styles.cUnit]}>P. unit.</Text>
      <Text style={[styles.th, styles.cDisc]}>Desc.</Text>
      <Text style={[styles.th, styles.cTotal]}>Importe</Text>
    </View>
  );
}

export function QuoteDocument(props: QuoteDocumentProps) {
  const clinicLine2 = [props.clinicAddress, props.clinicCity].filter(Boolean).join(", ");
  const clinicLine3 = [
    props.clinicPhone ? `Tel: ${props.clinicPhone}` : null,
    props.clinicEmail,
  ].filter(Boolean).join(" · ");

  const groups = groupByPhase(props.items);
  const showPhases = groups.length > 1 || (groups[0] && groups[0].phase != null);

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Membrete */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {props.logoDataUrl ? <PdfImage style={styles.logo} src={props.logoDataUrl} /> : null}
            <View>
              <Text style={styles.brand}>{props.clinicName}</Text>
              {clinicLine2 ? <Text style={styles.brandSub}>{clinicLine2}</Text> : null}
              {clinicLine3 ? <Text style={styles.brandSub}>{clinicLine3}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={styles.rxTitle}>PRESUPUESTO</Text>
            <Text style={styles.metaRight}>Folio</Text>
            <Text style={styles.folioMono}>{props.folio}</Text>
            <Text style={styles.metaRight}>Fecha</Text>
            <Text style={styles.metaValue}>{fmtDate(props.issuedAt)}</Text>
          </View>
        </View>

        {/* Paciente + título */}
        <View style={styles.block}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Paciente</Text>
              <Text style={styles.value}>{props.patientName}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Concepto</Text>
              <Text style={styles.value}>{props.title}</Text>
              <Text style={styles.sub}>Estado: {props.statusLabel}</Text>
            </View>
          </View>
        </View>

        {/* Ítems */}
        <Text style={styles.sectionTitle}>Detalle del presupuesto</Text>
        {props.items.length === 0 ? (
          <Text style={styles.sub}>Sin conceptos.</Text>
        ) : (
          groups.map((g, gi) => (
            <View key={gi} wrap={false}>
              {showPhases ? (
                <Text style={[styles.label, { marginTop: gi === 0 ? 2 : 8, marginBottom: 2 }]}>
                  {g.phase == null ? "Sin fase" : `Fase ${g.phase}`}
                </Text>
              ) : null}
              <ItemsTableHead />
              {g.items.map((it, idx) => (
                <View key={idx} style={styles.tRow} wrap={false}>
                  <View style={styles.cConcept}>
                    <Text style={styles.tdConcept}>{it.name}</Text>
                    {it.notes ? <Text style={styles.tdMutedSmall}>{it.notes}</Text> : null}
                  </View>
                  <Text style={[styles.td, styles.cTeeth]}>{it.toothFdi || "—"}</Text>
                  <Text style={[styles.td, styles.cQty]}>{it.quantity}</Text>
                  <Text style={[styles.td, styles.cUnit]}>{fmtMoney(it.unitPrice)}</Text>
                  <Text style={[styles.td, styles.cDisc]}>
                    {it.discount > 0 ? `-${fmtMoney(it.discount)}` : "—"}
                  </Text>
                  <Text style={[styles.tdConcept, styles.cTotal]}>{fmtMoney(it.lineTotal)}</Text>
                </View>
              ))}
            </View>
          ))
        )}

        {/* Totales */}
        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{fmtMoney(props.subtotal)}</Text>
          </View>
          {props.discountAmount > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Descuento</Text>
              <Text style={styles.totalsValue}>-{fmtMoney(props.discountAmount)}</Text>
            </View>
          ) : null}
          <View style={[styles.totalsRow, { marginTop: 3 }]}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>{fmtMoney(props.total)}</Text>
          </View>
        </View>

        {/* Vigencia + notas */}
        <View style={[styles.block, { marginTop: 14 }]}>
          <Text style={styles.label}>Vigencia</Text>
          <Text style={styles.sub}>
            {props.validUntil
              ? `Este presupuesto es válido hasta el ${fmtDate(props.validUntil)}.`
              : "Sujeto a confirmación."}
          </Text>
          {props.notes ? <Text style={[styles.sub, { marginTop: 4 }]}>{props.notes}</Text> : null}
        </View>

        {/* Leyenda + firma */}
        <View style={styles.bottomRow} wrap={false}>
          <View style={styles.legendBox}>
            <Text style={styles.legend}>
              Presupuesto informativo, sujeto a valoración clínica. Precios en MXN.
            </Text>
          </View>
          <View style={styles.signature}>
            {props.signatureDataUrl ? (
              <PdfImage style={styles.signatureImg} src={props.signatureDataUrl} />
            ) : null}
            <Text style={styles.sub}>Firma de aceptación del paciente</Text>
            {props.acceptedAt ? (
              <Text style={styles.signedBadge}>Aceptado el {fmtDate(props.acceptedAt)}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Presupuesto generado en DaleControl · {props.clinicName}
        </Text>
      </Page>
    </Document>
  );
}
