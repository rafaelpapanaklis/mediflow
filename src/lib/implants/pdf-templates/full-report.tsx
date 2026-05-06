// Implants — Reporte completo del expediente del implante.
// Generador integral por implante. Spec: portada + datos paciente +
// planificación + cirugía con ficha técnica del implante (marca, lote,
// torque) + cicatrización + segunda fase + prótesis + controles
// oseointegración + complicaciones + fotos por fase.
//
// Uso clínico/legal: entrega al paciente, soporte en disputas, traslado
// a otro doctor. A4 vertical, multi-página.

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface ImplantFullReportPdfData {
  // Cabecera
  clinic: {
    name: string;
    phone: string | null;
    address: string | null;
  };
  doctor: {
    firstName: string;
    lastName: string;
    cedulaProfesional: string | null;
  };
  patient: {
    firstName: string;
    lastName: string;
    age: number | null;
    sex: string | null;
  };
  generatedAt: Date;

  // Implante (ficha técnica COFEPRIS)
  implant: {
    id: string;
    toothFdi: number;
    brand: string;
    brandCustomName: string | null;
    modelName: string;
    diameterMm: string;
    lengthMm: string;
    connectionType: string;
    surfaceTreatment: string | null;
    lotNumber: string;
    manufactureDate: Date | null;
    expiryDate: Date | null;
    placedAt: Date;
    protocol: string;
    currentStatus: string;
  };

  // Planificación
  planning: {
    plannedAt: Date;
    asaClassification: string | null;
    medicalHistory: string | null;
    notes: string | null;
  } | null;

  // Cirugía
  surgical: {
    performedAt: Date;
    insertionTorqueNcm: number;
    isqMesiodistal: number;
    isqVestibulolingual: number;
    boneDensity: string;
    flapType: string;
    drillingProtocol: string;
    healingAbutmentLot: string | null;
    healingAbutmentDiameterMm: string | null;
    healingAbutmentHeightMm: string | null;
    sutureMaterial: string | null;
    durationMinutes: number;
    complications: string | null;
  } | null;

  // Cicatrización
  healing: {
    startedAt: Date;
    expectedDurationWeeks: number;
    isqLatest: number | null;
    isqLatestAt: Date | null;
    completedAt: Date | null;
    notes: string | null;
  } | null;

  // Segunda fase
  secondStage: {
    performedAt: Date;
    technique: string;
    healingAbutmentLot: string;
    isqAtUncovering: number | null;
    durationMinutes: number;
    notes: string | null;
  } | null;

  // Prótesis
  prosthetic: {
    abutmentType: string;
    abutmentBrand: string | null;
    abutmentLot: string;
    abutmentTorqueNcm: number;
    prosthesisType: string;
    prosthesisMaterial: string;
    prosthesisLabName: string;
    prosthesisLabLot: string;
    screwLot: string | null;
    screwTorqueNcm: number | null;
    occlusionScheme: string | null;
    prosthesisDeliveredAt: Date;
  } | null;

  // Controles (orden cronológico ascendente)
  followUps: Array<{
    milestone: string;
    performedAt: Date | null;
    bopPresent: boolean | null;
    pdMaxMm: string | null;
    radiographicBoneLossMm: string | null;
    meetsAlbrektssonCriteria: boolean | null;
    notes: string | null;
  }>;

  // Complicaciones (si las hubo)
  complications: Array<{
    detectedAt: Date;
    type: string;
    severity: string;
    description: string;
    resolvedAt: Date | null;
    outcome: string | null;
  }>;

  // Fotos por fase. Cada foto debe ser dataUrl (base64) o URL accesible
  // por @react-pdf desde el server (Supabase signed URL).
  photosByPhase: {
    phase: string; // 'planning' | 'surgical' | 'healing' | 'second_stage' | 'prosthetic' | 'follow_up'
    items: Array<{ url: string; caption: string | null; takenAt: Date }>;
  }[];
}

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0f172a",
    lineHeight: 1.4,
  },
  cover: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  coverTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    marginBottom: 8,
    textAlign: "center",
  },
  coverSubtitle: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
  },
  coverPatient: {
    marginTop: 30,
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  coverMeta: {
    fontSize: 10,
    color: "#475569",
    textAlign: "center",
    marginTop: 4,
  },
  coverFooter: {
    position: "absolute",
    bottom: 60,
    left: 36,
    right: 36,
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: "#1e3a8a",
    paddingBottom: 8,
    marginBottom: 12,
  },
  brand: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
  },
  brandSub: { fontSize: 7, color: "#64748b" },
  pageTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
  },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 2,
    borderBottomWidth: 0.25,
    borderBottomColor: "#e2e8f0",
  },
  label: {
    width: 160,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
  },
  value: { flex: 1, fontSize: 9 },
  paragraph: { fontSize: 9, marginVertical: 4, textAlign: "justify" },
  badge: {
    fontSize: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  photoCell: {
    width: 156,
    marginRight: 6,
    marginBottom: 6,
  },
  photoImg: {
    width: 156,
    height: 105,
    objectFit: "cover",
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
  },
  photoCaption: {
    fontSize: 7,
    color: "#64748b",
    marginTop: 1,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fmtBool(b: boolean | null): string {
  if (b == null) return "—";
  return b ? "Sí" : "No";
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value ?? "—"}</Text>
    </View>
  );
}

function PageHeader(props: {
  clinic: ImplantFullReportPdfData["clinic"];
  pageTitle: string;
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>{props.clinic.name}</Text>
        {props.clinic.phone ? (
          <Text style={styles.brandSub}>Tel {props.clinic.phone}</Text>
        ) : null}
      </View>
      <Text style={styles.pageTitle}>{props.pageTitle}</Text>
    </View>
  );
}

function PageFooter(props: { generatedAt: Date }) {
  return (
    <Text fixed style={styles.footer} render={({ pageNumber, totalPages }) => null as never} />
  );
}

// React-pdf no soporta children en Text fixed con render que devuelve null;
// hacemos un footer manual via fixed View en cada Page.
function FixedFooter(props: { generatedAt: Date }) {
  return (
    <View fixed style={styles.footer}>
      <Text>Reporte generado {fmtDate(props.generatedAt)}</Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Página ${pageNumber} de ${totalPages}`
        }
      />
    </View>
  );
}

export function ImplantFullReportDocument(props: {
  data: ImplantFullReportPdfData;
}) {
  const d = props.data;
  const fullName = `${d.patient.firstName} ${d.patient.lastName}`;
  const docName = `Dr. ${d.doctor.firstName} ${d.doctor.lastName}`;

  return (
    <Document
      title={`Reporte completo de implante — ${fullName}`}
      author={d.clinic.name}
      subject="Expediente clínico del implante"
    >
      {/* PORTADA */}
      <Page size="A4" style={styles.page}>
        <View style={styles.cover}>
          <Text style={styles.coverTitle}>Reporte completo del implante</Text>
          <Text style={styles.coverSubtitle}>Expediente clínico íntegro</Text>
          <Text style={styles.coverPatient}>{fullName}</Text>
          <Text style={styles.coverMeta}>
            Implante en FDI {d.implant.toothFdi} · Colocado {fmtDate(d.implant.placedAt)}
          </Text>
          <Text style={styles.coverMeta}>
            Marca: {d.implant.brandCustomName ?? d.implant.brand} ·{" "}
            {d.implant.diameterMm}×{d.implant.lengthMm} mm
          </Text>
        </View>
        <View style={styles.coverFooter}>
          <Text style={{ fontSize: 11 }}>{d.clinic.name}</Text>
          <Text style={{ fontSize: 9, color: "#64748b" }}>{docName}</Text>
          <Text style={{ fontSize: 8, color: "#94a3b8" }}>
            Generado {fmtDate(d.generatedAt)}
          </Text>
        </View>
      </Page>

      {/* DATOS PACIENTE + FICHA TÉCNICA */}
      <Page size="A4" style={styles.page}>
        <PageHeader clinic={d.clinic} pageTitle="Datos del paciente y ficha técnica" />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Paciente</Text>
          <Row label="Nombre" value={fullName} />
          <Row
            label="Edad / Sexo"
            value={`${d.patient.age ?? "—"} años · ${d.patient.sex ?? "—"}`}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ficha técnica del implante (COFEPRIS)</Text>
          <Row label="Diente FDI" value={String(d.implant.toothFdi)} />
          <Row
            label="Marca"
            value={d.implant.brandCustomName ?? d.implant.brand}
          />
          <Row label="Modelo" value={d.implant.modelName} />
          <Row
            label="Dimensión"
            value={`${d.implant.diameterMm} × ${d.implant.lengthMm} mm`}
          />
          <Row label="Conexión" value={d.implant.connectionType} />
          <Row label="Tratamiento de superficie" value={d.implant.surfaceTreatment} />
          <Row label="Lote" value={d.implant.lotNumber} />
          <Row label="Fecha de fabricación" value={fmtDate(d.implant.manufactureDate)} />
          <Row label="Caducidad" value={fmtDate(d.implant.expiryDate)} />
          <Row label="Protocolo" value={d.implant.protocol} />
          <Row label="Status actual" value={d.implant.currentStatus} />
          <Row label="Fecha colocación" value={fmtDate(d.implant.placedAt)} />
        </View>

        <FixedFooter generatedAt={d.generatedAt} />
      </Page>

      {/* PLANIFICACIÓN + CIRUGÍA */}
      <Page size="A4" style={styles.page}>
        <PageHeader clinic={d.clinic} pageTitle="Planificación y cirugía" />

        {d.planning ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Planificación</Text>
            <Row label="Fecha" value={fmtDate(d.planning.plannedAt)} />
            <Row label="ASA" value={d.planning.asaClassification} />
            {d.planning.medicalHistory ? (
              <Text style={styles.paragraph}>
                Antecedentes: {d.planning.medicalHistory}
              </Text>
            ) : null}
            {d.planning.notes ? (
              <Text style={styles.paragraph}>{d.planning.notes}</Text>
            ) : null}
          </View>
        ) : null}

        {d.surgical ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cirugía de colocación</Text>
            <Row label="Fecha" value={fmtDate(d.surgical.performedAt)} />
            <Row
              label="Torque inserción"
              value={`${d.surgical.insertionTorqueNcm} Ncm`}
            />
            <Row
              label="ISQ MD/VL"
              value={`${d.surgical.isqMesiodistal} / ${d.surgical.isqVestibulolingual}`}
            />
            <Row label="Densidad ósea" value={d.surgical.boneDensity} />
            <Row label="Tipo de colgajo" value={d.surgical.flapType} />
            <Row label="Protocolo de fresado" value={d.surgical.drillingProtocol} />
            <Row
              label="Pilar cicatrización"
              value={
                d.surgical.healingAbutmentLot
                  ? `Lote ${d.surgical.healingAbutmentLot}${
                      d.surgical.healingAbutmentDiameterMm
                        ? ` · ${d.surgical.healingAbutmentDiameterMm}×${d.surgical.healingAbutmentHeightMm} mm`
                        : ""
                    }`
                  : null
              }
            />
            <Row label="Sutura" value={d.surgical.sutureMaterial} />
            <Row
              label="Duración"
              value={`${d.surgical.durationMinutes} min`}
            />
            {d.surgical.complications ? (
              <Text style={styles.paragraph}>
                Complicaciones intraoperatorias: {d.surgical.complications}
              </Text>
            ) : null}
          </View>
        ) : null}

        <FixedFooter generatedAt={d.generatedAt} />
      </Page>

      {/* CICATRIZACIÓN + SEGUNDA FASE + PRÓTESIS */}
      <Page size="A4" style={styles.page}>
        <PageHeader
          clinic={d.clinic}
          pageTitle="Cicatrización, segunda fase y fase protésica"
        />

        {d.healing ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fase de cicatrización</Text>
            <Row label="Inicio" value={fmtDate(d.healing.startedAt)} />
            <Row
              label="Duración esperada"
              value={`${d.healing.expectedDurationWeeks} semanas`}
            />
            <Row
              label="ISQ último"
              value={
                d.healing.isqLatest != null
                  ? `${d.healing.isqLatest} (${fmtDate(d.healing.isqLatestAt)})`
                  : null
              }
            />
            <Row label="Completada" value={fmtDate(d.healing.completedAt)} />
            {d.healing.notes ? (
              <Text style={styles.paragraph}>{d.healing.notes}</Text>
            ) : null}
          </View>
        ) : null}

        {d.secondStage ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Segunda fase quirúrgica</Text>
            <Row label="Fecha" value={fmtDate(d.secondStage.performedAt)} />
            <Row label="Técnica" value={d.secondStage.technique} />
            <Row
              label="Pilar cicatrización lote"
              value={d.secondStage.healingAbutmentLot}
            />
            <Row
              label="ISQ al descubrir"
              value={
                d.secondStage.isqAtUncovering != null
                  ? String(d.secondStage.isqAtUncovering)
                  : null
              }
            />
            <Row
              label="Duración"
              value={`${d.secondStage.durationMinutes} min`}
            />
            {d.secondStage.notes ? (
              <Text style={styles.paragraph}>{d.secondStage.notes}</Text>
            ) : null}
          </View>
        ) : null}

        {d.prosthetic ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fase protésica</Text>
            <Row label="Pilar" value={d.prosthetic.abutmentType} />
            <Row label="Pilar marca" value={d.prosthetic.abutmentBrand} />
            <Row label="Pilar lote" value={d.prosthetic.abutmentLot} />
            <Row
              label="Pilar torque"
              value={`${d.prosthetic.abutmentTorqueNcm} Ncm`}
            />
            <Row label="Tipo prótesis" value={d.prosthetic.prosthesisType} />
            <Row label="Material prótesis" value={d.prosthetic.prosthesisMaterial} />
            <Row label="Laboratorio" value={d.prosthetic.prosthesisLabName} />
            <Row label="Lote prótesis" value={d.prosthetic.prosthesisLabLot} />
            {d.prosthetic.screwLot ? (
              <Row
                label="Tornillo"
                value={`Lote ${d.prosthetic.screwLot} · ${d.prosthetic.screwTorqueNcm} Ncm`}
              />
            ) : null}
            <Row label="Esquema oclusal" value={d.prosthetic.occlusionScheme} />
            <Row
              label="Entrega"
              value={fmtDate(d.prosthetic.prosthesisDeliveredAt)}
            />
          </View>
        ) : null}

        <FixedFooter generatedAt={d.generatedAt} />
      </Page>

      {/* CONTROLES + COMPLICACIONES */}
      <Page size="A4" style={styles.page}>
        <PageHeader clinic={d.clinic} pageTitle="Controles y complicaciones" />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Controles de oseointegración ({d.followUps.length})
          </Text>
          {d.followUps.length === 0 ? (
            <Text style={styles.paragraph}>Sin controles registrados.</Text>
          ) : (
            d.followUps.map((f, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={styles.badge}>
                  {f.milestone} · {fmtDate(f.performedAt)}
                </Text>
                <Row label="BoP" value={fmtBool(f.bopPresent)} />
                <Row label="PD máx" value={f.pdMaxMm ? `${f.pdMaxMm} mm` : null} />
                <Row
                  label="Pérdida ósea acumulada"
                  value={
                    f.radiographicBoneLossMm
                      ? `${f.radiographicBoneLossMm} mm`
                      : null
                  }
                />
                <Row label="Albrektsson" value={fmtBool(f.meetsAlbrektssonCriteria)} />
                {f.notes ? <Text style={styles.paragraph}>{f.notes}</Text> : null}
              </View>
            ))
          )}
        </View>

        {d.complications.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Complicaciones ({d.complications.length})
            </Text>
            {d.complications.map((c, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={styles.badge}>
                  {c.type} · {c.severity} · {fmtDate(c.detectedAt)}
                </Text>
                <Text style={styles.paragraph}>{c.description}</Text>
                {c.outcome ? (
                  <Text style={styles.paragraph}>
                    Resolución: {c.outcome} · {fmtDate(c.resolvedAt)}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <FixedFooter generatedAt={d.generatedAt} />
      </Page>

      {/* FOTOS POR FASE */}
      {d.photosByPhase.length > 0 && (
        <Page size="A4" style={styles.page}>
          <PageHeader clinic={d.clinic} pageTitle="Fotografías clínicas por fase" />
          {d.photosByPhase.map((phase) => (
            <View key={phase.phase} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {phase.phase} ({phase.items.length})
              </Text>
              <View style={styles.photoGrid}>
                {phase.items.map((p, i) => (
                  <View key={i} style={styles.photoCell}>
                    <Image src={p.url} style={styles.photoImg} />
                    <Text style={styles.photoCaption}>
                      {fmtDate(p.takenAt)}
                      {p.caption ? ` · ${p.caption}` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
          <FixedFooter generatedAt={d.generatedAt} />
        </Page>
      )}
    </Document>
  );
}
