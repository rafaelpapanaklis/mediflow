/**
 * DaleControl INSTITUCIONAL — Ola B · EL PDF DE LA CARTA DE CONSENTIMIENTO.
 *
 * SERVIDOR (renderToBuffer de @react-pdf/renderer, el MISMO motor que
 * receta-pdf.tsx). Este archivo NO consulta la base: recibe los datos ya
 * resueltos por `getEduConsentPdfData` (src/lib/edu/consentimientos.ts),
 * que es quien aplica el alcance y EL GATE — aquí no llega jamás una carta
 * sin firmar.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ ARREGLA (H-12). El permiso de CAJA sobre los consentimientos está
 * justificado por escrito en que «la carta se imprime y se entrega en el
 * mostrador». No había nada que imprimir: el texto que el paciente firmó se
 * guardaba, se hasheaba y no volvía nunca a una pantalla; firmada la carta,
 * la liga pública se apaga y no quedaba ninguna vía. El paciente pedía su
 * copia y se iba sin ella.
 *
 * 🔴 LO QUE ESTE DOCUMENTO TIENE QUE DECIR, y es el contrato de la pieza:
 * QUÉ se autorizó (el texto íntegro, palabra por palabra, el mismo que se
 * digirió para el hash), QUIÉN lo autorizó y CUÁNDO, QUIÉNES firmaron —con
 * sus firmas manuscritas— y SI EL TEXTO SIGUE SIENDO EL QUE SE FIRMÓ.
 *
 * 🔴 LA INTEGRIDAD SE DECLARA, NO SE INSINÚA. El pie no afirma integridad
 * por el hecho de imprimir una cifra: dice si la comprobación cuadró. Y si
 * NO cuadró, el papel se desmiente a sí mismo en una franja ARRIBA, antes
 * del texto — es la lección que la Ola 14 aprendió con las recetas, donde
 * un documento manipulado salía imprimiendo su huella como si tal cosa.
 *
 * ⚠️ La REVOCADA se imprime, marcada. El papel ya salió una vez con la
 * firma del paciente encima; poder imprimir la constancia de que se retiró
 * (con su motivo y su fecha) es la mitad de revocar.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { createElement } from "react";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { EduConsentPdfData } from "@/lib/edu/consentimientos";

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 46,
    paddingHorizontal: 44,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: "#1a1d21",
  },

  // Encabezado: el instituto a la izquierda, el sello del documento a la
  // derecha. Sin logo, igual que la receta y por lo mismo: un fetch remoto
  // en el camino del PDF es un timeout esperando a pasar.
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  instName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  instMeta: { fontSize: 8, color: "#5a6270", marginTop: 2 },
  docTag: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docMeta: { fontSize: 8, color: "#5a6270", textAlign: "right", marginTop: 2 },

  // Las dos franjas de alto. Misma forma que las de la receta —arriba,
  // antes del cuerpo— porque quien recibe el papel tiene que leerlas antes
  // que lo que autoriza. Ámbar la de integridad, roja la de revocada: son
  // dos cosas distintas y pueden salir juntas.
  tamperBand: {
    borderWidth: 1.4,
    borderColor: "#b45309",
    backgroundColor: "#fff7e6",
    padding: 8,
    marginBottom: 12,
  },
  tamperTitle: { color: "#7c3d0a", fontFamily: "Helvetica-Bold", fontSize: 11 },
  tamperText: { color: "#7c3d0a", fontSize: 8.5, marginTop: 2 },

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

  // El texto de la carta. Interlineado generoso: son párrafos legales que
  // alguien tiene que poder leer de verdad antes de guardarlos.
  carta: { fontSize: 9.5, lineHeight: 1.45, textAlign: "justify" },

  // Las firmas, de dos en dos. `wrap={false}` por bloque para que una
  // firma no se parta entre dos hojas.
  firmas: { marginTop: 20, flexDirection: "row", flexWrap: "wrap" },
  firma: {
    width: "50%",
    paddingRight: 14,
    marginBottom: 16,
  },
  firmaImg: { height: 46, marginBottom: 2, objectFit: "contain" },
  firmaLinea: { borderTopWidth: 1, borderTopColor: "#8a919c", paddingTop: 4 },
  firmaRol: { fontSize: 7.5, color: "#5a6270", textTransform: "uppercase", letterSpacing: 0.4 },
  firmaNombre: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 2 },
  firmaMeta: { fontSize: 8, color: "#3d4450", marginTop: 1 },
  firmaSinImagen: { fontSize: 8, color: "#8a919c", height: 46, paddingTop: 30 },

  foot: {
    position: "absolute",
    bottom: 22,
    left: 44,
    right: 44,
    fontSize: 7,
    color: "#8a919c",
    textAlign: "center",
  },
});

/** El pie de integridad, en una sola frase que dice la verdad. */
function pieIntegridad(data: EduConsentPdfData): string {
  if (!data.hashCorto) {
    return "Esta carta se emitió antes de que el sistema guardara la huella del texto: no se puede verificar automáticamente.";
  }
  if (data.integridad === "ok") {
    return `Integridad verificada · sha256 ${data.hashCorto}… — el texto de arriba es, carácter por carácter, el que el paciente firmó.`;
  }
  if (data.integridad === "alterado") {
    return `INTEGRIDAD ALTERADA · sha256 esperado ${data.hashCorto}… — el texto guardado NO coincide con el que se firmó.`;
  }
  return `sha256 ${data.hashCorto}… (sin verificar)`;
}

export function EduConsentDocument({ data }: { data: EduConsentPdfData }) {
  return (
    <Document
      title={`Consentimiento informado · ${data.patientName}`}
      author={data.institutionName}
      creator="DaleControl Institucional"
    >
      <Page size="LETTER" style={s.page}>
        <View style={s.head}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.instName}>{data.institutionName}</Text>
            <Text style={s.instMeta}>
              {[data.institutionCity, data.institutionPhone].filter(Boolean).join(" · ") ||
                "Clínica de enseñanza"}
            </Text>
            {data.programName && (
              <Text style={s.instMeta}>Clínica de enseñanza · {data.programName}</Text>
            )}
          </View>
          <View>
            <Text style={s.docTag}>CONSENTIMIENTO INFORMADO</Text>
            <Text style={s.docMeta}>NOM-004-SSA3</Text>
            <Text style={s.docMeta}>Documento {data.consentId.slice(0, 8)}</Text>
          </View>
        </View>

        {/* 🔴 La integridad va ANTES que la de revocada: si el contenido no
            es el que se firmó, todo lo que sigue —incluido el motivo de la
            revocación— se lee con eso puesto delante. */}
        {data.integridad === "alterado" && (
          <View style={s.tamperBand}>
            <Text style={s.tamperTitle}>INTEGRIDAD ALTERADA — no vale como constancia</Text>
            <Text style={s.tamperText}>
              El texto guardado ya no coincide con la huella que se calculó al emitir esta carta.
              Repórtalo a la dirección antes de archivar o entregar este documento.
            </Text>
          </View>
        )}

        {data.revoked && (
          <View style={s.voidBand}>
            <Text style={s.voidTitle}>CONSENTIMIENTO REVOCADO</Text>
            <Text style={s.voidText}>
              {data.revokedLabel ? `Revocado el ${data.revokedLabel}` : "Revocado"}
              {data.revokedByName ? ` · lo registró ${data.revokedByName}` : ""}
              {data.revokedReason ? `. Motivo: ${data.revokedReason}` : "."}
              {" "}La carta no se borró: se imprime tal como se firmó, y esta franja es la
              constancia de que el paciente se retractó.
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

        <View style={[s.row, { marginTop: 8 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.k}>Procedimiento que se consiente</Text>
            <Text style={s.v}>{data.procedure}</Text>
          </View>
          <View style={{ width: 160 }}>
            <Text style={s.k}>Firmada</Text>
            <Text style={s.v}>{data.signedLabel ?? "No llegó a firmarse"}</Text>
          </View>
        </View>

        {/* 🔴 QUIÉN FIRMÓ, arriba y en su propio renglón. Es la línea que
            separa una carta válida de una inválida cuando el paciente es
            menor de edad: la firma el representante legal, con su
            parentesco (NOM-004 10.1.1.3). */}
        <View style={{ marginTop: 8 }}>
          <Text style={s.k}>Quién otorga el consentimiento</Text>
          <Text style={s.v}>
            {data.signerName
              ? `${data.signerName} — ${data.signerRelation ?? "representante legal"} del paciente`
              : "El propio paciente"}
          </Text>
        </View>

        <View style={s.rule} />

        <View>
          <Text style={s.sectionTitle}>Texto que se firmó</Text>
          <Text style={s.carta}>{data.content}</Text>
        </View>

        <View style={s.firmas}>
          {data.firmas.map((f, i) => (
            <View key={`${f.rol}-${i}`} style={s.firma} wrap={false}>
              {f.dataUrl ? (
                <Image style={s.firmaImg} src={f.dataUrl} />
              ) : (
                <Text style={s.firmaSinImagen}>
                  (firma registrada; la imagen no está disponible)
                </Text>
              )}
              <View style={s.firmaLinea}>
                <Text style={s.firmaRol}>{f.rol}</Text>
                <Text style={s.firmaNombre}>{f.nombre}</Text>
                {f.cuando && <Text style={s.firmaMeta}>Firmó el {f.cuando}</Text>}
              </View>
            </View>
          ))}
        </View>

        <Text style={s.foot} fixed>
          {`Emitida el ${data.createdLabel} por ${data.createdByName} · ${pieIntegridad(data)}`}
        </Text>
      </Page>
    </Document>
  );
}

/** El buffer listo para la respuesta HTTP. */
export async function buildEduConsentPdf(
  data: EduConsentPdfData,
): Promise<{ buffer: Buffer; fileName: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(createElement(EduConsentDocument, { data }) as any);
  return { buffer, fileName: data.fileName };
}
