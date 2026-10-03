// El PDF de las hojas que se le entregan al paciente: indicaciones de cuidado y
// constancia de asistencia. Membrete común (`ClinicLetterhead`), datos de la
// cita, el texto (ya relleno) y, en la constancia, la firma del doctor con su
// cédula. Un dato que falta sale como raya para llenarse a mano.
//
// Colores fijos: un PDF no lee los tokens del panel (mismo criterio que
// patient-document.tsx).

import { createElement } from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ClinicLetterhead, clinicLetterheadProps, type ClinicLetterheadClinic, type ClinicLetterheadFields } from "@/lib/pdf/clinic-letterhead";
import { bloquesDeHoja } from "./cuerpo";
import { RAYA } from "./marcadores";
import type { SeccionHoja } from "./envio";

const ACCENT = "#7c3aed";
const TINTA = "#14101f";
const GRIS = "#6b6b78";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 56,
    paddingBottom: 72,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: TINTA,
    lineHeight: 1.5,
  },
  dateLabel: { fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, textAlign: "right", lineHeight: 1.2 },
  dateValue: { fontSize: 10.5, fontFamily: "Helvetica-Bold", textAlign: "right", marginTop: 2, lineHeight: 1.25 },
  parties: { flexDirection: "row", gap: 24, marginBottom: 18 },
  party: { flex: 1 },
  label: { fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, lineHeight: 1.2 },
  value: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.25 },
  detail: { fontSize: 9, color: GRIS, marginTop: 2, lineHeight: 1.3 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 4, marginTop: 6 },
  rule: { borderBottomWidth: 0.7, borderBottomColor: "#e5e5ed", marginTop: 6, marginBottom: 12 },
  body: { paddingRight: 24 },
  p: { marginBottom: 8 },
  item: { flexDirection: "row", marginBottom: 4 },
  itemMark: { width: 14 },
  itemText: { flex: 1 },
  signature: { marginTop: 56, width: 260, alignSelf: "center" },
  signatureLine: { borderTopWidth: 0.8, borderTopColor: TINTA, paddingTop: 6 },
  signatureName: { fontSize: 11.5, fontFamily: "Helvetica-Bold", lineHeight: 1.25, textAlign: "center" },
  signatureMeta: { fontSize: 9, color: GRIS, marginTop: 2, lineHeight: 1.3, textAlign: "center" },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 8,
    color: "#9b9aa8",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5ed",
    paddingTop: 8,
    lineHeight: 1.3,
  },
  // Mismo arreglo que patient-document.tsx: sin `lineHeight: ""` el número de página sale del papel.
  pageNum: { fontSize: 7.5, color: "#9b9aa8", textAlign: "center", marginTop: 2, lineHeight: "" },
});

export interface HojaPdfProps extends ClinicLetterheadClinic {
  tipo: "INDICACIONES" | "CONSTANCIA";
  /** Renglón bajo el nombre de la clínica. */
  rotulo: string;
  /** Fecha de emisión, ya formateada. */
  fecha: string;
  paciente: string;
  fechaCita: string;
  doctor: string;
  cedula: string | null;
  secciones: SeccionHoja[];
}

const oRaya = (v: string | null | undefined) => (v ?? "").trim() || RAYA;

function Cuerpo({ texto }: { texto: string }) {
  return (
    <View style={styles.body}>
      {bloquesDeHoja(texto).map((b, i) =>
        b.tipo === "parrafo" ? (
          <Text key={i} style={styles.p}>
            {b.texto}
          </Text>
        ) : (
          <View key={i} style={{ marginBottom: 6 }}>
            {b.items.map((it, j) => (
              <View key={j} style={styles.item} wrap={false}>
                <Text style={styles.itemMark}>•</Text>
                <Text style={styles.itemText}>{it}</Text>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

export function HojaPdf(props: HojaPdfProps) {
  const esConstancia = props.tipo === "CONSTANCIA";
  return (
    <Document title={props.secciones[0]?.titulo ?? props.rotulo} author={props.clinicName}>
      <Page size="LETTER" style={styles.page}>
        <ClinicLetterhead
          {...props}
          accent={ACCENT}
          subtitle={props.rotulo}
          right={
            <View>
              <Text style={styles.dateLabel}>Fecha</Text>
              <Text style={styles.dateValue}>{oRaya(props.fecha)}</Text>
            </View>
          }
        />

        {/* La constancia lleva los datos dentro del texto; las indicaciones, arriba. */}
        {!esConstancia && (
          <View style={styles.parties}>
            <View style={styles.party}>
              <Text style={styles.label}>Paciente</Text>
              <Text style={styles.value}>{oRaya(props.paciente)}</Text>
              <Text style={styles.detail}>Cita: {oRaya(props.fechaCita)}</Text>
            </View>
            <View style={styles.party}>
              <Text style={styles.label}>Atendió</Text>
              <Text style={styles.value}>{oRaya(props.doctor)}</Text>
              <Text style={styles.detail}>Cédula profesional: {oRaya(props.cedula)}</Text>
            </View>
          </View>
        )}

        {props.secciones.map((s, i) => (
          <View key={i} style={i > 0 ? { marginTop: 10 } : undefined}>
            <Text style={styles.title} minPresenceAhead={40}>
              {s.titulo}
            </Text>
            <View style={styles.rule} />
            <Cuerpo texto={s.cuerpo} />
          </View>
        ))}

        {esConstancia && (
          <View style={styles.signature} wrap={false}>
            <View style={styles.signatureLine}>
              <Text style={styles.signatureName}>{oRaya(props.doctor)}</Text>
              <Text style={styles.signatureMeta}>Cédula profesional: {oRaya(props.cedula)}</Text>
            </View>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>
            {props.clinicName} · {props.rotulo}
          </Text>
          <Text style={styles.pageNum} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Nombre de archivo sin acentos ni espacios: viaja en una cabecera HTTP y por WhatsApp. */
export function nombreDeArchivoHoja(base: string, paciente: string): string {
  const limpio = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${[limpio(base), limpio(paciente)].filter(Boolean).join("-").slice(0, 80) || "hoja"}.pdf`;
}

export async function construirPdfHoja(
  clinica: ClinicLetterheadFields,
  props: Omit<HojaPdfProps, keyof ClinicLetterheadClinic>,
): Promise<Buffer> {
  const membrete = await clinicLetterheadProps(clinica);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo cast que patient-documents/pdf.ts
  return renderToBuffer(createElement(HojaPdf, { ...membrete, ...props }) as any);
}
