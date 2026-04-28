import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

/**
 * PayrollDocument — PDF de nómina para /dashboard/analytics/doctors.
 *
 * Layout:
 *  - Header con título + clínica + período + fecha de emisión
 *  - Tabla con columnas Doctor / Citas / Completadas / Tiempo prom /
 *    Satisfacción / Ingresos
 *  - Totales agregados al final
 *  - Footer con disclaimer
 *
 * Fuentes: Helvetica (built-in @react-pdf, sin Font.register para evitar
 * dependencias externas y problemas de carga remota).
 */

export interface PayrollRow {
  name: string;
  apptsTotal: number;
  apptsCompleted: number;
  apptsPerDay: number;
  apptsNoShow: number;
  noShowRate: number;
  avgConsultMin: number | null;
  avgSatisfaction: number | null;
  satisfactionCount: number;
  revenueGenerated: number;
}

export interface PayrollDocumentProps {
  clinicName: string;
  periodLabel: string;        // ej. "Abril 2026" o "30 días al 28-abr"
  generatedAt: string;        // ISO date
  rows: PayrollRow[];
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
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
  meta: {
    fontSize: 9,
    color: "#6b6b78",
    textAlign: "right",
  },
  metaValue: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: "#14101f",
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  subtitle: {
    fontSize: 10,
    color: "#6b6b78",
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f2f8",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#d4d4dc",
  },
  th: {
    fontSize: 8.5,
    fontWeight: 700,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5ed",
  },
  td: {
    fontSize: 9.5,
    color: "#14101f",
  },
  tdMono: {
    fontSize: 9.5,
    color: "#14101f",
    fontFamily: "Helvetica",
  },
  tdBold: {
    fontFamily: "Helvetica-Bold",
  },
  tdMuted: {
    color: "#6b6b78",
  },
  tdRed: {
    color: "#dc2626",
  },
  cellName:    { width: "22%" },
  cellAppts:   { width: "10%", textAlign: "right" },
  cellCompl:   { width: "12%", textAlign: "right" },
  cellPerDay:  { width: "10%", textAlign: "right" },
  cellNoShow:  { width: "12%", textAlign: "right" },
  cellTime:    { width: "10%", textAlign: "right" },
  cellSatis:   { width: "10%", textAlign: "right" },
  cellRevenue: { width: "14%", textAlign: "right" },
  totalsBlock: {
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#f4f2f8",
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 10,
    color: "#6b6b78",
    fontFamily: "Helvetica-Bold",
  },
  totalValue: {
    fontSize: 13,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
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

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

export function PayrollDocument({ clinicName, periodLabel, generatedAt, rows }: PayrollDocumentProps) {
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenueGenerated,
      apptsTotal: acc.apptsTotal + r.apptsTotal,
      apptsCompleted: acc.apptsCompleted + r.apptsCompleted,
    }),
    { revenue: 0, apptsTotal: 0, apptsCompleted: 0 },
  );

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>MediFlow</Text>
            <Text style={styles.brandSub}>Reporte de nómina</Text>
          </View>
          <View>
            <Text style={styles.meta}>Clínica</Text>
            <Text style={styles.metaValue}>{clinicName}</Text>
            <Text style={[styles.meta, { marginTop: 6 }]}>Generado</Text>
            <Text style={styles.metaValue}>
              {new Date(generatedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
            </Text>
          </View>
        </View>

        <Text style={styles.title}>Performance de doctores · {periodLabel}</Text>
        <Text style={styles.subtitle}>
          Citas, ingresos generados, satisfacción de pacientes y tiempos promedio por doctor.
          Ingresos = facturas pagadas asociadas a citas del doctor en el período.
        </Text>

        <View style={styles.tableHeader} fixed>
          <Text style={[styles.th, styles.cellName]}>Doctor</Text>
          <Text style={[styles.th, styles.cellAppts]}>Citas</Text>
          <Text style={[styles.th, styles.cellCompl]}>Compl.</Text>
          <Text style={[styles.th, styles.cellPerDay]}>/día</Text>
          <Text style={[styles.th, styles.cellNoShow]}>No-show</Text>
          <Text style={[styles.th, styles.cellTime]}>Tiempo</Text>
          <Text style={[styles.th, styles.cellSatis]}>Satis.</Text>
          <Text style={[styles.th, styles.cellRevenue]}>Ingresos</Text>
        </View>

        {rows.map((r, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={[styles.td, styles.cellName, styles.tdBold]}>{r.name}</Text>
            <Text style={[styles.tdMono, styles.cellAppts]}>{r.apptsTotal}</Text>
            <Text style={[styles.tdMono, styles.cellCompl, styles.tdBold]}>{r.apptsCompleted}</Text>
            <Text style={[styles.tdMono, styles.cellPerDay, styles.tdMuted]}>{r.apptsPerDay}</Text>
            <Text style={[styles.tdMono, styles.cellNoShow, r.noShowRate > 10 ? styles.tdRed : styles.tdMuted]}>
              {r.apptsNoShow} ({r.noShowRate}%)
            </Text>
            <Text style={[styles.tdMono, styles.cellTime, styles.tdMuted]}>
              {r.avgConsultMin != null ? `${r.avgConsultMin}m` : "—"}
            </Text>
            <Text style={[styles.tdMono, styles.cellSatis]}>
              {r.avgSatisfaction != null ? `${r.avgSatisfaction.toFixed(1)} (${r.satisfactionCount})` : "—"}
            </Text>
            <Text style={[styles.tdMono, styles.cellRevenue, styles.tdBold]}>
              {fmtMXN(r.revenueGenerated)}
            </Text>
          </View>
        ))}

        {rows.length === 0 && (
          <View style={[styles.tableRow, { justifyContent: "center", paddingVertical: 24 }]}>
            <Text style={[styles.td, styles.tdMuted]}>Sin datos en el período seleccionado.</Text>
          </View>
        )}

        {rows.length > 0 && (
          <View style={styles.totalsBlock} wrap={false}>
            <View>
              <Text style={styles.totalLabel}>Total ingresos generados</Text>
              <Text style={[styles.totalValue, { marginTop: 2 }]}>{fmtMXN(totals.revenue)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.totalLabel}>{totals.apptsTotal} citas · {totals.apptsCompleted} completadas</Text>
              <Text style={[styles.brandSub, { marginTop: 2 }]}>
                {rows.length} doctor{rows.length === 1 ? "" : "es"} en el reporte
              </Text>
            </View>
          </View>
        )}

        <Text style={styles.footer} fixed>
          MediFlow · Reporte interno de nómina · Sin valor fiscal · Generado el{" "}
          {new Date(generatedAt).toLocaleString("es-MX")}
        </Text>
      </Page>
    </Document>
  );
}
