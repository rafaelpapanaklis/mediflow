import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/**
 * Estado de cuenta mensual del afiliado (PDF).
 *
 * Espeja el estilo de src/lib/pdf/payroll-document.tsx:
 *  - Header con marca "DaleControl" violeta #7c3aed + borde inferior violeta 2pt
 *  - Secciones con títulos uppercase pequeños
 *  - Tabla con View flexDirection row + anchos por flex, filas zebra (#f7f6fb)
 *  - Card de totales (generado / pagado / pendiente — pendiente en violeta)
 *  - Footer fijo con fecha de generación
 *
 * Fuentes: Helvetica/Helvetica-Bold built-in de @react-pdf (sin Font.register).
 * Español neutro con tú. Moneda es-MX a 2 decimales.
 */

export interface AffiliateStatementRow {
  date: string; // dd/mm/yyyy
  clinicName: string;
  baseMxn: number;
  commissionMxn: number;
  status: "pending" | "paid" | string;
}

export interface AffiliateStatementProps {
  affiliateName: string;
  referralCode: string;
  monthLabel: string; // p.ej. "junio de 2026"
  generatedAt: string; // dd/mm/yyyy HH:mm
  rows: AffiliateStatementRow[];
  totals: {
    count: number;
    totalMxn: number;
    paidMxn: number;
    pendingMxn: number;
  };
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 56,
    fontFamily: "Helvetica",
    fontSize: 9.5,
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
    fontWeight: 700,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
  },
  brandSub: {
    fontSize: 9,
    color: "#6b6b78",
    marginTop: 2,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  headerTitle: {
    fontSize: 12,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  headerMonth: {
    fontSize: 10,
    color: "#6b6b78",
    marginTop: 3,
    textAlign: "right",
  },
  infoRow: {
    flexDirection: "row",
    backgroundColor: "#f4f2f8",
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  infoCell: { flex: 1 },
  infoLabel: {
    fontSize: 7.5,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  infoValue: {
    fontSize: 10,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },
  sectionTitle: {
    fontSize: 8.5,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
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
  rowZebra: {
    backgroundColor: "#f7f6fb",
  },
  td: {
    fontSize: 9.5,
    color: "#14101f",
  },
  tdBold: {
    fontFamily: "Helvetica-Bold",
  },
  tdMuted: {
    color: "#6b6b78",
  },
  tdPending: {
    color: "#7c3aed",
  },
  colDate: { flex: 1 },
  colClinic: { flex: 2.2, paddingRight: 6 },
  colBase: { flex: 1, textAlign: "right" },
  colCommission: { flex: 1, textAlign: "right" },
  colStatus: { flex: 0.9, textAlign: "right" },
  emptyRow: {
    paddingVertical: 24,
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5ed",
  },
  totalsWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 18,
  },
  totalsCard: {
    backgroundColor: "#f4f2f8",
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    width: 240,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 9.5,
    color: "#6b6b78",
  },
  totalValue: {
    fontSize: 9.5,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
  },
  totalRowPending: {
    borderTopWidth: 0.5,
    borderTopColor: "#d4d4dc",
    marginTop: 8,
    paddingTop: 8,
  },
  totalLabelPending: {
    fontSize: 10,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
  },
  totalValuePending: {
    fontSize: 12,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
  },
  note: {
    marginTop: 14,
    fontSize: 8.5,
    color: "#6b6b78",
    lineHeight: 1.5,
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

/** Moneda es-MX a 2 decimales: $1,234.50 */
function fmtMxn(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string): string {
  return status === "paid" ? "Pagada" : "Pendiente";
}

export function AffiliateStatementDocument({
  affiliateName,
  referralCode,
  monthLabel,
  generatedAt,
  rows,
  totals,
}: AffiliateStatementProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Header con marca */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>DaleControl</Text>
            <Text style={styles.brandSub}>Programa de afiliados</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerTitle}>Estado de cuenta de afiliado</Text>
            <Text style={styles.headerMonth}>{monthLabel}</Text>
          </View>
        </View>

        {/* Datos del afiliado */}
        <View style={styles.infoRow}>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Afiliado</Text>
            <Text style={styles.infoValue}>{affiliateName}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Código de referido</Text>
            <Text style={styles.infoValue}>{referralCode}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Periodo</Text>
            <Text style={styles.infoValue}>{monthLabel}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Generado</Text>
            <Text style={styles.infoValue}>{generatedAt}</Text>
          </View>
        </View>

        {/* Tabla de comisiones */}
        <Text style={styles.sectionTitle}>Comisiones del periodo</Text>
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.th, styles.colDate]}>Fecha</Text>
          <Text style={[styles.th, styles.colClinic]}>Clínica</Text>
          <Text style={[styles.th, styles.colBase]}>Base MXN</Text>
          <Text style={[styles.th, styles.colCommission]}>Comisión MXN</Text>
          <Text style={[styles.th, styles.colStatus]}>Estado</Text>
        </View>

        {rows.map((r, i) => (
          <View key={i} style={i % 2 === 1 ? [styles.tableRow, styles.rowZebra] : styles.tableRow} wrap={false}>
            <Text style={[styles.td, styles.colDate]}>{r.date}</Text>
            <Text style={[styles.td, styles.colClinic]}>{r.clinicName}</Text>
            <Text style={[styles.td, styles.colBase, styles.tdMuted]}>{fmtMxn(r.baseMxn)}</Text>
            <Text style={[styles.td, styles.colCommission, styles.tdBold]}>{fmtMxn(r.commissionMxn)}</Text>
            <Text style={[styles.td, styles.colStatus, r.status === "paid" ? styles.tdMuted : styles.tdPending]}>
              {statusLabel(r.status)}
            </Text>
          </View>
        ))}

        {rows.length === 0 && (
          <View style={styles.emptyRow}>
            <Text style={[styles.td, styles.tdMuted]}>Sin comisiones en este periodo.</Text>
          </View>
        )}

        {/* Totales del mes */}
        <View style={styles.totalsWrap} wrap={false}>
          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Comisiones del mes</Text>
              <Text style={styles.totalValue}>{totals.count}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Generado</Text>
              <Text style={styles.totalValue}>{fmtMxn(totals.totalMxn)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Pagado</Text>
              <Text style={styles.totalValue}>{fmtMxn(totals.paidMxn)}</Text>
            </View>
            <View style={[styles.totalRow, styles.totalRowPending]}>
              <Text style={styles.totalLabelPending}>Pendiente</Text>
              <Text style={styles.totalValuePending}>{fmtMxn(totals.pendingMxn)}</Text>
            </View>
          </View>
        </View>

        {/* Nota informativa */}
        <Text style={styles.note}>
          Las comisiones pendientes se liquidan según el método de pago configurado en tu panel. Este
          documento es informativo y no es un CFDI.
        </Text>

        <Text style={styles.footer} fixed>
          DaleControl · Estado de cuenta de afiliado · Generado el {generatedAt}
        </Text>
      </Page>
    </Document>
  );
}
