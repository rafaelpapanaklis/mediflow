// Implants — Reporte quirúrgico (post-cirugía, expediente legal).
// A4 vertical, lenguaje médico. La pieza más sensible legalmente del
// módulo — principal evidencia en disputas por mala praxis. Spec §9.2.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface SurgicalReportPdfData {
  // Paciente
  patientName: string;
  patientId: string;

  // Implante COFEPRIS
  toothFdi: number;
  brand: string;
  brandCustomName: string | null;
  modelName: string;
  diameterMm: string;
  lengthMm: string;
  lotNumber: string;
  manufactureDate: Date | null;
  expiryDate: Date | null;
  placedAt: Date;
  protocol: string;

  // Cirugía
  surgical: {
    performedAt: Date;
    asaClassification: string;
    insertionTorqueNcm: number;
    isqMesiodistal: number;
    isqVestibulolingual: number;
    boneDensity: string;
    flapType: string;
    drillingProtocol: string;
    healingAbutmentLot: string | null;
    sutureMaterial: string | null;
    durationMinutes: number;
    complications: string | null;
    postOpInstructions: string | null;
  } | null;

  // Doctor + clínica
  doctorName: string;
  doctorCedula: string | null;
  clinicName: string;
  clinicPhone: string | null;

  generatedAt: Date;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0f172a",
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#1e3a8a",
    paddingBottom: 12,
    marginBottom: 16,
  },
  brand: {
    fontSize: 16,
    color: "#1e3a8a",
    fontFamily: "Helvetica-Bold",
  },
  brandSub: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 2,
  },
  rightHeader: {
    textAlign: "right",
  },
  title: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  meta: {
    fontSize: 8,
    color: "#64748b",
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 2,
  },
  row: {
    flexDirection: "row",
    marginBottom: 4,
  },
  label: {
    width: 130,
    color: "#64748b",
    fontSize: 9,
  },
  value: {
    flex: 1,
    fontSize: 10,
  },
  valueMono: {
    flex: 1,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#b45309",
  },
  cofeprisBox: {
    backgroundColor: "#fffbeb",
    borderWidth: 0.5,
    borderColor: "#fde68a",
    padding: 8,
    borderRadius: 3,
    marginBottom: 12,
  },
  cofeprisTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#92400e",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  text: {
    marginBottom: 4,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#64748b",
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    paddingTop: 8,
  },
  signatureRow: {
    flexDirection: "row",
    marginTop: 30,
    justifyContent: "space-between",
  },
  signatureBox: {
    width: 220,
    borderTopWidth: 0.5,
    borderTopColor: "#0f172a",
    paddingTop: 4,
  },
  signatureLabel: {
    fontSize: 8,
    color: "#64748b",
  },
});

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtBrand(brand: string, custom: string | null): string {
  if (brand === "OTRO" && custom) return custom;
  return brand
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtProtocol(p: string): string {
  return p.replaceAll("_", " ").toLowerCase();
}

export function SurgicalReportDocument(props: { data: SurgicalReportPdfData }) {
  const d = props.data;
  const s = d.surgical;

  return (
    <Document
      title={`Reporte quirúrgico — ${d.patientName} — Diente ${d.toothFdi}`}
      author={d.clinicName}
      subject="Reporte quirúrgico implantológico — NOM-024-SSA3-2012"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{d.clinicName}</Text>
            <Text style={styles.brandSub}>
              {d.clinicPhone ? `Tel ${d.clinicPhone}` : ""}
            </Text>
          </View>
          <View style={styles.rightHeader}>
            <Text style={styles.title}>Reporte quirúrgico</Text>
            <Text style={styles.meta}>NOM-024-SSA3-2012</Text>
            <Text style={styles.meta}>
              Generado {fmtDate(d.generatedAt)}
            </Text>
          </View>
        </View>

        {/* Datos del paciente */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Datos del paciente</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Paciente</Text>
            <Text style={styles.value}>{d.patientName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Identificador</Text>
            <Text style={styles.value}>{d.patientId}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Diente intervenido</Text>
            <Text style={styles.value}>FDI {d.toothFdi}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Fecha de cirugía</Text>
            <Text style={styles.value}>
              {fmtDate(s?.performedAt ?? d.placedAt)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Cirujano</Text>
            <Text style={styles.value}>
              Dr/a. {d.doctorName}
              {d.doctorCedula ? ` · Cédula ${d.doctorCedula}` : ""}
            </Text>
          </View>
          {s && (
            <View style={styles.row}>
              <Text style={styles.label}>Clasificación ASA</Text>
              <Text style={styles.value}>{s.asaClassification}</Text>
            </View>
          )}
        </View>

        {/* Trazabilidad COFEPRIS */}
        <View style={styles.cofeprisBox}>
          <Text style={styles.cofeprisTitle}>Trazabilidad COFEPRIS clase III</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Marca</Text>
            <Text style={styles.value}>{fmtBrand(d.brand, d.brandCustomName)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Modelo</Text>
            <Text style={styles.value}>{d.modelName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>⌀ × Longitud</Text>
            <Text style={styles.value}>{d.diameterMm} × {d.lengthMm} mm</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Lote</Text>
            <Text style={styles.valueMono}>{d.lotNumber}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Manufactura</Text>
            <Text style={styles.value}>{fmtDate(d.manufactureDate)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Caducidad</Text>
            <Text style={styles.value}>{fmtDate(d.expiryDate)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Protocolo</Text>
            <Text style={styles.value}>{fmtProtocol(d.protocol)}</Text>
          </View>
        </View>

        {/* Datos quirúrgicos */}
        {s && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Datos quirúrgicos</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Densidad ósea</Text>
                <Text style={styles.value}>
                  {s.boneDensity} (Lekholm-Zarb 1985)
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Torque inserción</Text>
                <Text style={styles.value}>{s.insertionTorqueNcm} Ncm</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>ISQ (MD / VL)</Text>
                <Text style={styles.value}>
                  {s.isqMesiodistal} / {s.isqVestibulolingual}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Tipo de colgajo</Text>
                <Text style={styles.value}>{s.flapType}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Protocolo de fresado</Text>
                <Text style={styles.value}>{s.drillingProtocol}</Text>
              </View>
              {s.healingAbutmentLot && (
                <View style={styles.row}>
                  <Text style={styles.label}>Lote pilar cic.</Text>
                  <Text style={styles.valueMono}>{s.healingAbutmentLot}</Text>
                </View>
              )}
              {s.sutureMaterial && (
                <View style={styles.row}>
                  <Text style={styles.label}>Sutura</Text>
                  <Text style={styles.value}>{s.sutureMaterial}</Text>
                </View>
              )}
              <View style={styles.row}>
                <Text style={styles.label}>Duración</Text>
                <Text style={styles.value}>{s.durationMinutes} min</Text>
              </View>
            </View>

            {s.complications && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Complicaciones intraoperatorias</Text>
                <Text style={styles.text}>{s.complications}</Text>
              </View>
            )}

            {s.postOpInstructions && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Instrucciones post-operatorias</Text>
                <Text style={styles.text}>{s.postOpInstructions}</Text>
              </View>
            )}
          </>
        )}

        {/* Firma */}
        <View style={styles.signatureRow}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>
              Dr/a. {d.doctorName}
              {d.doctorCedula ? `\nCédula profesional ${d.doctorCedula}` : ""}
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Documento generado por MediFlow · Conservación recomendada 10
          años (NOM-024-SSA3-2012). Trazabilidad COFEPRIS clase III
          preservada. Cualquier modificación posterior queda registrada
          en el audit log.
        </Text>
      </Page>
    </Document>
  );
}
