// Implants — Plan implantológico al paciente (pre-cirugía).
// A4 vertical, lenguaje accesible. Spec §9.1.
//
// Soporta 1 implante o N (All-on-4) — la action exportImplantPlanPdf
// agrupa por patientId cuando se quiere un plan completo.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface ImplantPlanPdfData {
  patient: { firstName: string; lastName: string };
  doctor: {
    firstName: string;
    lastName: string;
    cedulaProfesional: string | null;
  } | null;
  clinic: { name: string; phone: string | null };
  implants: Array<{
    toothFdi: number;
    brand: string;
    modelName: string;
    diameterMm: string;
    lengthMm: string;
    lotNumber: string;
    placedAt: Date;
    currentStatus: string;
    protocol: string;
  }>;
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
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    marginBottom: 6,
  },
  paragraph: {
    fontSize: 10,
    marginBottom: 6,
    textAlign: "justify",
  },
  table: {
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    borderRadius: 3,
    marginTop: 6,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
  },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    textTransform: "uppercase",
  },
  td: {
    fontSize: 9,
    color: "#0f172a",
  },
  colFdi: { width: 50 },
  colBrand: { flex: 2 },
  colDim: { width: 70 },
  colLot: { width: 80 },
  colDate: { width: 70 },
  bullet: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bulletDot: {
    width: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
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
});

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fmtBrand(brand: string): string {
  return brand
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ImplantPlanDocument(props: { data: ImplantPlanPdfData }) {
  const d = props.data;
  const isMulti = d.implants.length > 1;

  return (
    <Document
      title={`Plan implantológico — ${d.patient.firstName} ${d.patient.lastName}`}
      author={d.clinic.name}
      subject="Plan implantológico personalizado"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{d.clinic.name}</Text>
            <Text style={styles.brandSub}>
              {d.clinic.phone ? `Tel ${d.clinic.phone}` : ""}
            </Text>
          </View>
          <View style={styles.rightHeader}>
            <Text style={styles.title}>Plan implantológico</Text>
            <Text style={styles.meta}>
              {d.patient.firstName} {d.patient.lastName}
            </Text>
            <Text style={styles.meta}>Generado {fmtDate(d.generatedAt)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tu plan de tratamiento</Text>
          <Text style={styles.paragraph}>
            Hola {d.patient.firstName}, este documento resume el plan
            implantológico que diseñamos para ti.{" "}
            {isMulti
              ? `Vamos a colocar ${d.implants.length} implantes para devolverle función y estética a tu boca.`
              : `Vamos a colocar un implante en la zona del diente FDI ${d.implants[0]?.toothFdi}.`}
            Léelo con calma y guárdalo — vas a necesitar la información
            durante los controles.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>¿Qué es un implante dental?</Text>
          <Text style={styles.paragraph}>
            Un implante dental es un pequeño tornillo de titanio que se
            integra a tu hueso (osteointegración) y reemplaza la raíz
            del diente perdido. Sobre él colocamos una corona, puente o
            prótesis. La técnica tiene más de 50 años de respaldo
            clínico y una tasa de éxito del 90 al 95% a 10 años cuando
            se cumple el plan de mantenimiento.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Implantes en tu plan ({d.implants.length})
          </Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colFdi]}>Diente</Text>
              <Text style={[styles.th, styles.colBrand]}>Marca / Modelo</Text>
              <Text style={[styles.th, styles.colDim]}>Tamaño</Text>
              <Text style={[styles.th, styles.colLot]}>Lote</Text>
              <Text style={[styles.th, styles.colDate]}>Fecha</Text>
            </View>
            {d.implants.map((i, idx) => (
              <View key={idx} style={styles.tableRow}>
                <Text style={[styles.td, styles.colFdi]}>{i.toothFdi}</Text>
                <Text style={[styles.td, styles.colBrand]}>
                  {fmtBrand(i.brand)} {i.modelName}
                </Text>
                <Text style={[styles.td, styles.colDim]}>
                  {i.diameterMm} × {i.lengthMm} mm
                </Text>
                <Text style={[styles.td, styles.colLot]}>{i.lotNumber}</Text>
                <Text style={[styles.td, styles.colDate]}>
                  {fmtDate(i.placedAt)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cronograma estimado</Text>
          {[
            "Consulta de planeación + estudios (CBCT si aplica)",
            "Cirugía de colocación + instrucciones post-operatorias",
            "Periodo de cicatrización (osteointegración) — 8 a 16 semanas según tu hueso",
            "Toma de impresión y diseño de la prótesis con el laboratorio",
            "Prueba de prótesis y ajustes",
            "Colocación final + entrega del carnet de tu implante",
            "Plan de mantenimiento periimplantario cada 6 meses (DE POR VIDA)",
          ].map((step, i) => (
            <View key={i} style={styles.bullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Plan de mantenimiento de por vida</Text>
          <Text style={styles.paragraph}>
            La principal causa de fracaso a largo plazo es el
            incumplimiento del mantenimiento. Vas a necesitar:
          </Text>
          {[
            "Excelente higiene oral diaria (cepillado + cepillo interdental + irrigador).",
            "Visitas profesionales cada 6 meses (o con la cadencia que indique tu doctor).",
            "Controles radiográficos a los 6, 12 y 24 meses, y luego con la frecuencia indicada.",
            "Si fumas, considera dejarlo — el tabaco reduce la tasa de éxito.",
            "Si tienes diabetes, mantén HbA1c por debajo de 7%.",
          ].map((item, i) => (
            <View key={i} style={styles.bullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed>
          {d.doctor
            ? `Dr/a. ${d.doctor.firstName} ${d.doctor.lastName}${
                d.doctor.cedulaProfesional
                  ? ` · Cédula ${d.doctor.cedulaProfesional}`
                  : ""
              }`
            : ""}
          {" · "}
          {d.clinic.name}
          {d.clinic.phone ? ` · ${d.clinic.phone}` : ""}
        </Text>
      </Page>
    </Document>
  );
}
