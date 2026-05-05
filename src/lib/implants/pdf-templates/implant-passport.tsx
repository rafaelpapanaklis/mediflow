// Implants — carnet del implante. PDF formato licencia HORIZONTAL
// landscape 85.6mm × 54mm (NO A4). Spec §1.15, §9.3.
//
// Es la pieza diferenciadora del módulo. Auto-generado al finalizar
// fase protésica. QR público OPT-IN (Spec §1.16).

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

// 1mm ≈ 2.834645669 pt → 85.6 × 54 mm = 242.6 × 153.1 pt
const LICENSE_SIZE: [number, number] = [242.6, 153.1];

export interface ImplantPassportData {
  // Paciente
  patient: { firstName: string; lastName: string; dob: Date | null };
  patientPhotoUrl: string | null;

  // Implante (COFEPRIS)
  brand: string;
  brandCustomName: string | null;
  modelName: string;
  diameterMm: string;
  lengthMm: string;
  lotNumber: string;
  placedAt: Date;
  expiryDate: Date | null;

  // Prótesis
  prosthesisType: string | null;
  prosthesisMaterial: string | null;
  prosthesisLabName: string | null;
  prosthesisLabLot: string | null;
  prosthesisDeliveredAt: Date | null;
  abutmentLot: string | null;

  // Doctor + clínica
  doctorName: string;
  doctorCedula: string | null;
  clinicName: string;
  clinicPhone: string | null;
  clinicLogoUrl: string | null;

  // QR (opt-in)
  qrDataUrl: string | null; // ya generado upstream con `qrcode`
}

const styles = StyleSheet.create({
  page: {
    padding: 8,
    fontFamily: "Helvetica",
    fontSize: 6,
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  card: {
    flex: 1,
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#1e3a8a",
    borderRadius: 6,
    overflow: "hidden",
  },
  // Banda lateral azul COFEPRIS
  band: {
    width: 12,
    backgroundColor: "#1e3a8a",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  bandText: {
    color: "#ffffff",
    fontSize: 4.5,
    fontFamily: "Helvetica-Bold",
    transform: "rotate(-90deg)",
    width: 80,
    textAlign: "center",
  },
  body: {
    flex: 1,
    flexDirection: "row",
    padding: 6,
  },
  leftCol: {
    width: 50,
    marginRight: 6,
    alignItems: "center",
  },
  photo: {
    width: 44,
    height: 44,
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    borderRadius: 2,
    objectFit: "cover",
    backgroundColor: "#f1f5f9",
  },
  photoPlaceholder: {
    width: 44,
    height: 44,
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    borderRadius: 2,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  qr: {
    width: 38,
    height: 38,
    marginTop: 4,
  },
  midCol: {
    flex: 1,
    flexDirection: "column",
  },
  brand: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    marginBottom: 1,
  },
  patientName: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
    color: "#0f172a",
  },
  label: {
    fontSize: 4.5,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 0.5,
  },
  value: {
    fontSize: 6,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  valueMono: {
    fontSize: 6,
    fontFamily: "Helvetica",
    color: "#b45309", // amber para destacar lote (COFEPRIS)
  },
  row: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 1,
  },
  cell: {
    flex: 1,
  },
  divider: {
    height: 0.5,
    backgroundColor: "#e2e8f0",
    marginVertical: 2,
  },
  footer: {
    fontSize: 4.5,
    color: "#64748b",
    marginTop: 2,
  },
});

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtBrand(brand: string, custom: string | null): string {
  if (brand === "OTRO" && custom) return custom;
  return brand
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtType(t: string | null): string {
  if (!t) return "—";
  return t.replaceAll("_", " ").toLowerCase();
}

export function ImplantPassportDocument(props: { data: ImplantPassportData }) {
  const d = props.data;
  const inFunctionDays = d.prosthesisDeliveredAt
    ? Math.floor((Date.now() - d.prosthesisDeliveredAt.getTime()) / 86_400_000)
    : null;

  return (
    <Document
      title={`Carnet implante — ${d.patient.firstName} ${d.patient.lastName}`}
      author={d.clinicName}
      subject="Carnet del implante dental"
    >
      <Page size={LICENSE_SIZE} style={styles.page} orientation="landscape">
        <View style={styles.card}>
          <View style={styles.band}>
            <Text style={styles.bandText}>CARNET IMPLANTE</Text>
          </View>

          <View style={styles.body}>
            {/* Columna izquierda: foto + QR */}
            <View style={styles.leftCol}>
              {d.patientPhotoUrl ? (
                <Image src={d.patientPhotoUrl} style={styles.photo} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={{ fontSize: 4, color: "#94a3b8" }}>SIN FOTO</Text>
                </View>
              )}
              {d.qrDataUrl && <Image src={d.qrDataUrl} style={styles.qr} />}
            </View>

            {/* Columna media: datos clínicos */}
            <View style={styles.midCol}>
              <Text style={styles.brand}>{d.clinicName.toUpperCase()}</Text>
              <Text style={styles.patientName}>
                {d.patient.firstName} {d.patient.lastName}
              </Text>

              <View style={styles.row}>
                <View style={styles.cell}>
                  <Text style={styles.label}>Marca / Modelo</Text>
                  <Text style={styles.value}>
                    {fmtBrand(d.brand, d.brandCustomName)} {d.modelName}
                  </Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.label}>⌀ × Longitud</Text>
                  <Text style={styles.value}>
                    {d.diameterMm} × {d.lengthMm} mm
                  </Text>
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.cell}>
                  <Text style={styles.label}>Lote (COFEPRIS)</Text>
                  <Text style={styles.valueMono}>{d.lotNumber}</Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.label}>Colocado</Text>
                  <Text style={styles.value}>{fmtDate(d.placedAt)}</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.row}>
                <View style={styles.cell}>
                  <Text style={styles.label}>Prótesis</Text>
                  <Text style={styles.value}>
                    {fmtType(d.prosthesisType)} · {fmtType(d.prosthesisMaterial)}
                  </Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.label}>Lab · Lote</Text>
                  <Text style={styles.value}>
                    {d.prosthesisLabName ?? "—"}
                    {d.prosthesisLabLot ? (
                      <Text style={styles.valueMono}> · {d.prosthesisLabLot}</Text>
                    ) : null}
                  </Text>
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.cell}>
                  <Text style={styles.label}>Lote pilar</Text>
                  <Text style={styles.valueMono}>{d.abutmentLot ?? "—"}</Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.label}>Entrega prótesis</Text>
                  <Text style={styles.value}>{fmtDate(d.prosthesisDeliveredAt)}</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <Text style={styles.footer}>
                Dr/a. {d.doctorName}
                {d.doctorCedula ? ` · Céd. ${d.doctorCedula}` : ""} · {d.clinicName}
                {d.clinicPhone ? ` · ${d.clinicPhone}` : ""}
                {inFunctionDays !== null ? ` · En función ${inFunctionDays} días` : ""}
              </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
