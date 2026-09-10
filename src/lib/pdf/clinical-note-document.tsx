import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/**
 * ClinicalNoteDocument — PDF de nota SOAP firmada para el expediente del
 * paciente. Header con clínica + paciente + doctor, cuerpo SOAP por
 * secciones, lista CIE-10 si existe, y footer con disclaimer NOM-024.
 *
 * Fuentes: Helvetica built-in (sin Font.register para evitar dependencias
 * externas).
 *
 * ADENDAS (hallazgo 25 · WS1-T5). Una nota firmada es inalterable por la
 * NOM-024, así que la corrección no se escribe encima: se añade como ADENDA
 * fechada y firmada (POST /api/clinical-notes/[id]/addendum). Este documento
 * imprimía solo la nota, de modo que el papel seguía diciendo «pieza 26»
 * cuando el expediente real ya decía 27 — y sin avisar de que existía una
 * corrección. Ahora las adendas se imprimen DEBAJO de la nota, separadas,
 * numeradas y con fecha y autor; la nota original se imprime tal cual, sin
 * tachones ni sustituciones. Las dos versiones conviven, que es el punto.
 *
 * Que no se pueda pasar por alto se sostiene en tres sitios a la vez, porque
 * el documento pagina y nadie lee siempre la última página: un aviso en la
 * primera página, una línea en el pie que sale en TODAS, y la sección final.
 */

export interface ClinicalNoteDxRow {
  code: string;
  description: string;
}

/**
 * Una adenda tal y como la guarda POST /api/clinical-notes/[id]/addendum en
 * `specialtyData.addenda` (ver `StoredAddendum` en esa ruta). Aquí solo se
 * necesita lo que se imprime: qué dice, quién la firmó y cuándo.
 */
export interface ClinicalNoteAddendumRow {
  text: string;
  authorName: string | null;
  createdAt: string;             // ISO
}

export interface ClinicalNoteDocumentProps {
  clinicName: string;
  patientName: string;
  patientDob: string | null;     // ISO o null
  patientGender: string | null;
  doctorName: string | null;
  visitDate: string;             // ISO
  generatedAt: string;           // ISO
  status: "DRAFT" | "SIGNED";
  signedAt: string | null;       // ISO o null
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  diagnoses: ClinicalNoteDxRow[];
  procedures: string[];
  /** Correcciones posteriores a la firma. Opcional a propósito: sin adendas
   *  —o si quien llama no las pasa— el PDF sale exactamente como antes. */
  addenda?: ClinicalNoteAddendumRow[];
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#14101f",
    lineHeight: 1.5,
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
  patientBlock: {
    backgroundColor: "#f4f2f8",
    padding: 12,
    borderRadius: 6,
    marginBottom: 18,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  patientCol: {
    flex: 1,
  },
  patientLabel: {
    fontSize: 8,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  patientValue: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  patientSub: {
    fontSize: 9,
    color: "#6b6b78",
    marginTop: 2,
  },
  statusPillSigned: {
    fontSize: 9,
    color: "#15803d",
    backgroundColor: "#dcfce7",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    fontFamily: "Helvetica-Bold",
  },
  statusPillDraft: {
    fontSize: 9,
    color: "#a16207",
    backgroundColor: "#fef3c7",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    fontFamily: "Helvetica-Bold",
  },
  sectionTitle: {
    fontSize: 11,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4dc",
  },
  sectionBody: {
    fontSize: 10,
    color: "#14101f",
    marginBottom: 6,
  },
  sectionEmpty: {
    fontSize: 9,
    color: "#9b9aa8",
    fontStyle: "italic",
    marginBottom: 6,
  },
  dxRow: {
    flexDirection: "row",
    fontSize: 10,
    marginBottom: 3,
  },
  dxCode: {
    width: 60,
    fontFamily: "Helvetica-Bold",
    color: "#7c3aed",
  },
  dxLabel: {
    flex: 1,
    color: "#14101f",
  },
  procRow: {
    fontSize: 10,
    marginBottom: 3,
    color: "#14101f",
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

  /** El pie fijo crece una línea cuando hay adendas; sin este colchón el
   *  cuerpo se le mete debajo. Se aplica SOLO en ese caso: una nota sin
   *  adendas conserva el `padding: 40` de siempre y sale exactamente igual. */
  pageWithAddenda: {
    paddingBottom: 74,
  },

  // ── Adendas ───────────────────────────────────────────────────────────────
  // Ámbar y no el morado de la marca: el morado es el color de "sección
  // normal" en este documento y una corrección firmada no es una sección más.
  addendaNotice: {
    backgroundColor: "#fef3c7",
    borderLeftWidth: 3,
    borderLeftColor: "#a16207",
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 18,
  },
  addendaNoticeTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#78350f",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  addendaNoticeBody: {
    fontSize: 9,
    color: "#92400e",
    marginTop: 3,
  },
  addendaBand: {
    marginTop: 20,
    marginBottom: 2,
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#a16207",
    borderRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  addendaBandTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#78350f",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  addendaBandSub: {
    fontSize: 9,
    color: "#92400e",
    marginTop: 3,
  },
  addendumBlock: {
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#a16207",
    backgroundColor: "#fdfaf3",
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 10,
  },
  addendumHead: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#78350f",
  },
  addendumMeta: {
    fontSize: 9,
    color: "#6b6b78",
    marginTop: 1,
    marginBottom: 5,
  },
  addendumText: {
    fontSize: 10,
    color: "#14101f",
  },
  addendumEnd: {
    fontSize: 8,
    color: "#92400e",
    fontStyle: "italic",
    marginTop: 5,
  },
  footerAddenda: {
    position: "absolute",
    bottom: 52,
    left: 40,
    right: 40,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#92400e",
    textAlign: "center",
  },
});

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Las adendas guardadas en `specialtyData.addenda`, saneadas y en ORDEN
 * CRONOLÓGICO. Espejo del lector que tiene la propia ruta del addendum, que no
 * se puede importar: un `route.ts` de App Router solo exporta sus handlers.
 * Cualquier elemento sin texto o sin fecha se descarta —igual que allí— porque
 * una adenda que no se puede fechar ni atribuir no se puede imprimir como
 * corrección firmada.
 *
 * Vive aquí, y no en la ruta, para que toda entrada que imprima esta nota
 * lea las adendas con el mismo criterio y en el mismo orden.
 */
export function readNoteAddenda(specialtyData: unknown): ClinicalNoteAddendumRow[] {
  const raw = (specialtyData as Record<string, unknown> | null | undefined)?.addenda;
  return Array.isArray(raw) ? cleanAddenda(raw) : [];
}

/**
 * Filas utilizables, ordenadas. Lo aplica también el propio componente sobre
 * lo que le pasen: si una fila no tiene texto o no tiene fecha no se pinta un
 * bloque vacío —eso sería anunciar una corrección que no dice nada— y una nota
 * cuyas adendas sean todas inservibles sale exactamente igual que sin ellas.
 */
function cleanAddenda(rows: unknown[]): ClinicalNoteAddendumRow[] {
  return sortAddenda(
    rows
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .filter((a) => typeof a.text === "string" && a.text.trim().length > 0)
      .filter((a) => typeof a.createdAt === "string" && a.createdAt.length > 0)
      .map((a) => ({
        text: String(a.text).trim(),
        authorName:
          typeof a.authorName === "string" && a.authorName.trim().length > 0
            ? a.authorName.trim()
            : null,
        createdAt: String(a.createdAt),
      })),
  );
}

/**
 * Cronológico ascendente y ESTABLE: la secuencia de correcciones se lee en el
 * orden en que ocurrieron. La ruta las añade al final, así que el orden de
 * llegada ya suele ser el bueno; esto lo garantiza igualmente. Una fecha
 * ilegible no se descarta ni se reordena: se queda donde estaba, para no
 * inventar una cronología que el dato no dice.
 */
function sortAddenda(rows: ClinicalNoteAddendumRow[]): ClinicalNoteAddendumRow[] {
  return rows
    .map((row, i) => ({ row, i, t: new Date(row.createdAt).getTime() }))
    .sort((a, b) => {
      const aOk = !isNaN(a.t);
      const bOk = !isNaN(b.t);
      if (!aOk || !bOk) return a.i - b.i;
      return a.t - b.t || a.i - b.i;
    })
    .map((x) => x.row);
}

/** Fecha de adenda legible; si el ISO guardado no se puede interpretar se
 *  imprime tal cual en vez de un "Invalid Date": el dato original vale más. */
function fmtAddendumDate(iso: string): string {
  return isNaN(new Date(iso).getTime()) ? iso : fmtDateTime(iso);
}

/** "1 adenda" / "3 adendas". */
function plural(n: number): string {
  return n === 1 ? "1 adenda" : `${n} adendas`;
}

function fmtAge(dob: string | null): string {
  if (!dob) return "—";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const years = Math.floor(ms / (365.25 * 24 * 3600 * 1000));
  return `${years} años`;
}

export function ClinicalNoteDocument(props: ClinicalNoteDocumentProps) {
  const {
    clinicName, patientName, patientDob, patientGender,
    doctorName, visitDate, generatedAt, status, signedAt,
    subjective, objective, assessment, plan,
    diagnoses, procedures,
  } = props;

  const addenda = cleanAddenda(props.addenda ?? []);
  const hasAddenda = addenda.length > 0;
  // Las frases completas, y no un plural pegado con una `s`: esto lo lee un
  // profesional o un abogado y "1 adenda añadidas" resta seriedad al aviso.
  const una = addenda.length === 1;
  const fraseSeccion = una
    ? "1 adenda añadida después de firmar la nota. No modifica ni sustituye la nota original: la corrige o la completa, y se lee junto con ella."
    : `${addenda.length} adendas añadidas después de firmar la nota. No modifican ni sustituyen la nota original: la corrigen o la completan, y se leen junto con ella.`;
  const frasePie = una
    ? "Este documento incluye 1 adenda posterior a la firma, al final. La nota original no está completa sin ella."
    : `Este documento incluye ${addenda.length} adendas posteriores a la firma, al final. La nota original no está completa sin ellas.`;

  return (
    <Document>
      <Page size="LETTER" style={hasAddenda ? [styles.page, styles.pageWithAddenda] : styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>DaleControl</Text>
            <Text style={styles.brandSub}>Nota clínica · expediente electrónico</Text>
          </View>
          <View>
            <Text style={styles.meta}>Clínica</Text>
            <Text style={styles.metaValue}>{clinicName}</Text>
            <Text style={[styles.meta, { marginTop: 6 }]}>Fecha de visita</Text>
            <Text style={styles.metaValue}>{fmtDateTime(visitDate)}</Text>
          </View>
        </View>

        <View style={styles.patientBlock}>
          <View style={styles.patientCol}>
            <Text style={styles.patientLabel}>Paciente</Text>
            <Text style={styles.patientValue}>{patientName}</Text>
            <Text style={styles.patientSub}>
              {fmtAge(patientDob)}{patientGender ? ` · ${patientGender}` : ""}
            </Text>
          </View>
          <View style={styles.patientCol}>
            <Text style={styles.patientLabel}>Médico tratante</Text>
            <Text style={styles.patientValue}>{doctorName ?? "—"}</Text>
          </View>
          <View style={[styles.patientCol, { alignItems: "flex-end" }]}>
            <Text style={styles.patientLabel}>Estado</Text>
            <View style={{ marginTop: 4 }}>
              <Text style={status === "SIGNED" ? styles.statusPillSigned : styles.statusPillDraft}>
                {status === "SIGNED" ? "FIRMADA" : "BORRADOR"}
              </Text>
            </View>
            {status === "SIGNED" && signedAt && (
              <Text style={[styles.patientSub, { marginTop: 4 }]}>{fmtDateTime(signedAt)}</Text>
            )}
          </View>
        </View>

        {/* El aviso va ARRIBA y no al final: quien hojea el documento tiene
            que saber que la nota que empieza a leer está corregida antes de
            leerla, no después. */}
        {hasAddenda && (
          <View style={styles.addendaNotice} wrap={false}>
            <Text style={styles.addendaNoticeTitle}>
              Atención: esta nota tiene {plural(addenda.length)}
            </Text>
            <Text style={styles.addendaNoticeBody}>
              La nota original se reproduce abajo sin cambios, tal como se firmó.
              {" "}Las correcciones y añadidos posteriores a la firma están al final de
              este documento y forman parte del expediente: la nota no está completa
              sin ellas.
            </Text>
          </View>
        )}

        <SoapBlock label="Subjetivo (S)" body={subjective} />
        <SoapBlock label="Objetivo (O)" body={objective} />
        <SoapBlock label="Análisis (A)" body={assessment} />
        <SoapBlock label="Plan (P)" body={plan} />

        {diagnoses.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Diagnósticos CIE-10</Text>
            {diagnoses.map((d) => (
              <View key={d.code} style={styles.dxRow} wrap={false}>
                <Text style={styles.dxCode}>{d.code}</Text>
                <Text style={styles.dxLabel}>{d.description}</Text>
              </View>
            ))}
          </>
        )}

        {procedures.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Procedimientos</Text>
            {procedures.map((p, i) => (
              <Text key={i} style={styles.procRow} wrap={false}>· {p}</Text>
            ))}
          </>
        )}

        {hasAddenda && (
          <>
            {/* minPresenceAhead: si no caben la banda y el arranque de la
                primera adenda, la sección entera empieza en la página
                siguiente. Un título de sección solo al pie de una página es
                justo lo que hace que la corrección se pase por alto. */}
            <View style={styles.addendaBand} wrap={false} minPresenceAhead={120}>
              <Text style={styles.addendaBandTitle}>
                Adendas — correcciones posteriores a la firma
              </Text>
              <Text style={styles.addendaBandSub}>{fraseSeccion}</Text>
            </View>

            {addenda.map((a, i) => (
              <View
                key={`${a.createdAt}-${i}`}
                style={styles.addendumBlock}
                /* Sin wrap={false}: una adenda admite hasta 4.000 caracteres y
                   puede no caber en lo que resta de página. Prohibirle partirse
                   la dejaría recortada, y perder texto clínico es peor que
                   partirlo. Lo que sí se impide es que el encabezado se quede
                   huérfano al pie: con minPresenceAhead, o entran cabecera y
                   unas líneas juntas, o la adenda empieza en la página nueva.
                   Y si aun así se parte, el pie de CADA página avisa de que hay
                   adendas y cada bloque cierra con su propia marca de fin. */
                minPresenceAhead={72}
              >
                {/* `fixed` DENTRO del bloque: react-pdf lo repite arriba de
                    cada trozo del bloque —y solo de ese bloque, comprobado—,
                    igual que una cabecera de tabla. Así, si la adenda se parte,
                    la página siguiente vuelve a decir de cuál es y quién la
                    firmó, en vez de empezar con texto suelto. */}
                <View fixed>
                  <Text style={styles.addendumHead}>
                    Adenda {i + 1} de {addenda.length}
                  </Text>
                  <Text style={styles.addendumMeta}>
                    {fmtAddendumDate(a.createdAt)} · Firmada por {a.authorName ?? "autor no registrado"}
                  </Text>
                </View>
                <Text style={styles.addendumText}>{a.text}</Text>
                <Text style={styles.addendumEnd}>
                  — fin de la adenda {i + 1} de {addenda.length} —
                </Text>
              </View>
            ))}
          </>
        )}

        {/* Fija y en TODAS las páginas: si una adenda larga se parte, el
            lector que cae en la página siguiente sigue sabiendo qué está
            leyendo y que el documento no acaba en la nota. */}
        {hasAddenda && (
          <Text style={styles.footerAddenda} fixed>{frasePie}</Text>
        )}

        <Text style={styles.footer} fixed>
          DaleControl · Expediente clínico electrónico conforme a NOM-024-SSA3-2012 ·
          Generado el {fmtDateTime(generatedAt)}
        </Text>
      </Page>
    </Document>
  );
}

function SoapBlock({ label, body }: { label: string; body: string | null }) {
  const has = !!body && body.trim().length > 0;
  return (
    <View wrap={false}>
      <Text style={styles.sectionTitle}>{label}</Text>
      {has ? (
        <Text style={styles.sectionBody}>{body}</Text>
      ) : (
        <Text style={styles.sectionEmpty}>Sin información registrada.</Text>
      )}
    </View>
  );
}
