// Implants — Orden de laboratorio. Specs detallados por subtype para
// que llegue al lab con TODO lo crítico (marca implante, plataforma,
// torque, altura mucosa, oclusión, etc.).

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { ImplantLabOrderSubtype } from "@/lib/clinical-shared/types";

export interface ImplantLabOrderPdfData {
  patient: { firstName: string; lastName: string };
  doctor: { firstName: string; lastName: string };
  clinic: { name: string; phone: string | null };
  partner: { name: string; contactName: string | null; phone: string | null } | null;
  orderId: string;
  /** Subtipo implantológico — drives los renglones específicos. */
  subtype: ImplantLabOrderSubtype;
  /** Diente FDI o lista. */
  toothFdi: number | null;
  toothFdiList?: number[] | null;
  /** Specs como Record<string, unknown>; se renderizan como rows clave/valor. */
  spec: Record<string, unknown>;
  shadeGuide: string | null;
  dueDate: Date | null;
  notes: string | null;
  issuedAt: Date;
}

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0f172a",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#1e3a8a",
    paddingBottom: 10,
    marginBottom: 14,
  },
  brand: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
  },
  brandSub: { fontSize: 8, color: "#64748b", marginTop: 2 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 8, color: "#64748b" },
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 12 },
  colBox: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    borderRadius: 3,
    padding: 8,
    backgroundColor: "#f8fafc",
  },
  colLabel: { fontSize: 7, color: "#64748b", marginBottom: 2 },
  colValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  colMeta: { fontSize: 8, color: "#475569" },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 2,
  },
  specRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.25,
    borderBottomColor: "#e2e8f0",
  },
  specKey: {
    width: 160,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
  },
  specValue: { flex: 1, fontSize: 9 },
  notes: {
    fontSize: 9,
    padding: 6,
    backgroundColor: "#fefce8",
    borderWidth: 0.5,
    borderColor: "#fde68a",
    borderRadius: 3,
  },
  signatureBlock: { marginTop: 24 },
  signatureLine: {
    width: 240,
    borderTopWidth: 0.5,
    borderTopColor: "#0f172a",
    paddingTop: 4,
  },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    paddingTop: 6,
    textAlign: "center",
  },
});

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fmtSubtype(s: ImplantLabOrderSubtype): string {
  switch (s) {
    case "pilar_personalizado":
      return "Pilar personalizado";
    case "protesis_atornillada":
      return "Prótesis atornillada";
    case "protesis_cementada":
      return "Prótesis cementada";
    case "guia_quirurgica":
      return "Guía quirúrgica";
    case "modelo_estudio_digital":
      return "Modelo de estudio digital";
    default:
      return s;
  }
}

function fmtSpecKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function fmtSpecValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ImplantLabOrderDocument(props: {
  data: ImplantLabOrderPdfData;
}) {
  const d = props.data;
  const teeth = d.toothFdiList?.length
    ? d.toothFdiList.join(", ")
    : d.toothFdi != null
      ? String(d.toothFdi)
      : "—";

  // ordenar specs alfa, ocultar implantOrderSubtype que ya está en el header
  const specEntries = Object.entries(d.spec)
    .filter(([k]) => k !== "implantOrderSubtype")
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <Document
      title={`Orden de laboratorio — ${d.patient.firstName} ${d.patient.lastName}`}
      author={d.clinic.name}
      subject={fmtSubtype(d.subtype)}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{d.clinic.name}</Text>
            {d.clinic.phone ? (
              <Text style={styles.brandSub}>Tel {d.clinic.phone}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>Orden de laboratorio</Text>
            <Text style={styles.meta}>#{d.orderId.slice(0, 8)}</Text>
            <Text style={styles.meta}>{fmtDate(d.issuedAt)}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.colBox}>
            <Text style={styles.colLabel}>Paciente</Text>
            <Text style={styles.colValue}>
              {d.patient.firstName} {d.patient.lastName}
            </Text>
            <Text style={styles.colMeta}>FDI: {teeth}</Text>
          </View>
          <View style={styles.colBox}>
            <Text style={styles.colLabel}>Laboratorio</Text>
            <Text style={styles.colValue}>{d.partner?.name ?? "—"}</Text>
            {d.partner?.contactName ? (
              <Text style={styles.colMeta}>Contacto: {d.partner.contactName}</Text>
            ) : null}
            {d.partner?.phone ? (
              <Text style={styles.colMeta}>Tel {d.partner.phone}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.colBox}>
            <Text style={styles.colLabel}>Tipo de orden</Text>
            <Text style={styles.colValue}>{fmtSubtype(d.subtype)}</Text>
          </View>
          <View style={styles.colBox}>
            <Text style={styles.colLabel}>Color / Fecha entrega</Text>
            <Text style={styles.colValue}>
              {d.shadeGuide ?? "—"}
              {d.dueDate ? `  ·  ${fmtDate(d.dueDate)}` : ""}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Especificaciones técnicas</Text>
          {specEntries.length === 0 ? (
            <Text style={styles.specValue}>Sin especificaciones</Text>
          ) : (
            specEntries.map(([k, v]) => (
              <View key={k} style={styles.specRow}>
                <Text style={styles.specKey}>{fmtSpecKey(k)}</Text>
                <Text style={styles.specValue}>{fmtSpecValue(v)}</Text>
              </View>
            ))
          )}
        </View>

        {d.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notas adicionales</Text>
            <Text style={styles.notes}>{d.notes}</Text>
          </View>
        ) : null}

        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine}>
            <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>
              Dr. {d.doctor.firstName} {d.doctor.lastName}
            </Text>
            <Text style={{ fontSize: 8, color: "#64748b" }}>Solicitante</Text>
          </View>
        </View>

        <Text fixed style={styles.footer}>
          Orden de laboratorio · Trazabilidad COFEPRIS clase III
        </Text>
      </Page>
    </Document>
  );
}
