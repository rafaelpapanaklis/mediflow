/**
 * DaleControl INSTITUCIONAL — Ola 14 · EL PDF DE LA RECETA.
 *
 * SERVIDOR (renderToBuffer de @react-pdf/renderer, el mismo motor que las
 * recetas del dental). Este archivo NO consulta la base: recibe los datos
 * ya resueltos por getEduRecetaPdfData (src/lib/edu/recetas.ts), que es
 * quien aplica el alcance y EL GATE — aquí no llega jamás una receta que
 * no esté EXPEDIDA o ANULADA.
 *
 * 🔴 LO QUE ESTE DOCUMENTO TIENE QUE DECIR, y es el contrato de la ola:
 * LOS DOS NOMBRES. Quién la PROPUSO (el alumno, con su matrícula) y quién
 * la EXPIDE Y RESPONDE (el docente, con su CÉDULA PROFESIONAL). Un papel
 * con un solo nombre diría o que el alumno receta —no puede: no tiene
 * cédula— o que el docente escribió lo que no escribió.
 *
 * ⚠️ La ANULADA se imprime, marcada. El papel ya salió una vez con una
 * cédula encima; poder imprimir la constancia de que se retiró (con su
 * motivo y su fecha) es la mitad de anular.
 */
import { createElement } from "react";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EduRecetaPdfData } from "@/lib/edu/recetas";

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 42,
    paddingHorizontal: 44,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: "#1a1d21",
  },

  // Encabezado: el instituto a la izquierda, el sello del documento a la
  // derecha. Sin logo a propósito: EduInstitution.logoUrl existe pero un
  // fetch remoto en el camino del PDF es un timeout esperando a pasar; se
  // agrega el día que una escuela lo pida.
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  instName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  instMeta: { fontSize: 8, color: "#5a6270", marginTop: 2 },
  docTag: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docMeta: { fontSize: 8, color: "#5a6270", textAlign: "right", marginTop: 2 },

  // La franja de ANULADA. Roja y ARRIBA: quien recibe el papel tiene que
  // leerla antes que los medicamentos.
  voidBand: {
    borderWidth: 1.4,
    borderColor: "#b3261e",
    backgroundColor: "#fdeceb",
    padding: 8,
    marginBottom: 12,
  },
  voidTitle: { color: "#b3261e", fontFamily: "Helvetica-Bold", fontSize: 11 },
  voidText: { color: "#7a1c16", fontSize: 8.5, marginTop: 2 },

  rule: { borderBottomWidth: 1, borderBottomColor: "#d7dbe0", marginVertical: 10 },

  row: { flexDirection: "row", justifyContent: "space-between" },
  k: { fontSize: 7.5, color: "#5a6270", textTransform: "uppercase", letterSpacing: 0.4 },
  v: { fontSize: 10, marginTop: 1 },

  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 8,
    color: "#5a6270",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },

  item: { marginBottom: 8 },
  itemHead: { flexDirection: "row" },
  itemNum: { width: 16, fontFamily: "Helvetica-Bold", fontSize: 10 },
  itemDrug: { fontFamily: "Helvetica-Bold", fontSize: 10, flex: 1 },
  itemBody: { marginLeft: 16, marginTop: 1.5, fontSize: 9.5, lineHeight: 1.35 },
  itemNotes: { marginLeft: 16, marginTop: 1, fontSize: 8.5, color: "#3d4450" },

  indications: { fontSize: 9.5, lineHeight: 1.4 },

  // Las dos firmas, lado a lado. La del docente lleva la cédula: es la
  // línea por la que existe la ola entera.
  signs: { flexDirection: "row", marginTop: 26, gap: 18 },
  sign: { flex: 1, borderTopWidth: 1, borderTopColor: "#8a919c", paddingTop: 5 },
  signRole: { fontSize: 7.5, color: "#5a6270", textTransform: "uppercase", letterSpacing: 0.4 },
  signName: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 2 },
  signMeta: { fontSize: 8.5, color: "#3d4450", marginTop: 1 },

  foot: {
    position: "absolute",
    bottom: 20,
    left: 44,
    right: 44,
    fontSize: 7,
    color: "#8a919c",
    textAlign: "center",
  },
});

function posologia(it: EduRecetaPdfData["items"][number]): string {
  return [
    it.presentation,
    it.dose,
    it.route,
    it.frequency,
    it.duration,
    it.quantity ? `surtir ${it.quantity}` : null,
  ]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join(" · ");
}

export function EduRecetaDocument({ data }: { data: EduRecetaPdfData }) {
  return (
    <Document
      title={`Receta · ${data.patientName}`}
      author={data.institutionName}
      creator="DaleControl Institucional"
    >
      <Page size="LETTER" style={s.page}>
        <View style={s.head}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.instName}>{data.institutionName}</Text>
            <Text style={s.instMeta}>
              {[data.institutionCity, data.institutionPhone, data.institutionEmail]
                .filter(Boolean)
                .join(" · ") || "Clínica de enseñanza"}
            </Text>
            <Text style={s.instMeta}>Clínica de enseñanza · {data.programName}</Text>
          </View>
          <View>
            <Text style={s.docTag}>RECETA</Text>
            <Text style={s.docMeta}>{data.issuedAtLabel}</Text>
            <Text style={s.docMeta}>Folio del documento: {data.recetaId.slice(0, 8)}</Text>
          </View>
        </View>

        {data.voided && (
          <View style={s.voidBand}>
            <Text style={s.voidTitle}>RECETA ANULADA — no surtir</Text>
            <Text style={s.voidText}>
              {data.voidedAtLabel ? `Anulada el ${data.voidedAtLabel}` : "Anulada"}
              {data.voidedByName ? ` por ${data.voidedByName}` : ""}
              {data.voidReason ? `. Motivo: ${data.voidReason}` : "."}
            </Text>
          </View>
        )}

        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.k}>Paciente</Text>
            <Text style={s.v}>{data.patientName}</Text>
          </View>
          <View style={{ width: 90 }}>
            <Text style={s.k}>Folio</Text>
            <Text style={s.v}>{data.patientFolio}</Text>
          </View>
          <View style={{ width: 70 }}>
            <Text style={s.k}>Edad</Text>
            <Text style={s.v}>
              {data.patientAgeYears !== null ? `${data.patientAgeYears} años` : "—"}
            </Text>
          </View>
        </View>

        {data.diagnosis && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Diagnóstico</Text>
            <Text style={s.indications}>{data.diagnosis}</Text>
          </View>
        )}

        <View style={s.rule} />

        <View>
          <Text style={s.sectionTitle}>Prescripción</Text>
          {data.items.map((it, i) => (
            <View key={i} style={s.item} wrap={false}>
              <View style={s.itemHead}>
                <Text style={s.itemNum}>{i + 1}.</Text>
                <Text style={s.itemDrug}>{it.drug}</Text>
              </View>
              <Text style={s.itemBody}>{posologia(it) || "Sin posología escrita"}</Text>
              {it.notes && <Text style={s.itemNotes}>{it.notes}</Text>}
            </View>
          ))}
        </View>

        {data.indications && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Indicaciones generales</Text>
            <Text style={s.indications}>{data.indications}</Text>
          </View>
        )}

        <View style={s.signs} wrap={false}>
          <View style={s.sign}>
            <Text style={s.signRole}>Propuso</Text>
            <Text style={s.signName}>{data.proposedByName}</Text>
            <Text style={s.signMeta}>
              Alumno de la especialidad
              {data.proposedByMatricula ? ` · Matrícula ${data.proposedByMatricula}` : ""}
            </Text>
          </View>
          <View style={s.sign}>
            <Text style={s.signRole}>Expide y responde</Text>
            <Text style={s.signName}>{data.issuedByName}</Text>
            <Text style={s.signMeta}>Cédula profesional {data.issuedByCedula}</Text>
            <Text style={s.signMeta}>Firmada electrónicamente el {data.issuedAtLabel}</Text>
          </View>
        </View>

        <Text style={s.foot} fixed>
          Expedida electrónicamente en DaleControl Institucional
          {data.issuedHashShort ? ` · integridad sha256 ${data.issuedHashShort}…` : ""} · documento{" "}
          {data.recetaId}
        </Text>
      </Page>
    </Document>
  );
}

/** El buffer listo para la respuesta HTTP. */
export async function buildEduRecetaPdf(
  data: EduRecetaPdfData,
): Promise<{ buffer: Buffer; fileName: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(createElement(EduRecetaDocument, { data }) as any);
  return { buffer, fileName: data.fileName };
}
