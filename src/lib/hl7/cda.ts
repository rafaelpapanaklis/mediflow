/**
 * Generador de HL7 CDA Release 2 — export del expediente clínico.
 *
 * Sigue la estructura mínima requerida por NOM-024 sección 6.6:
 *  - ClinicalDocument header
 *  - recordTarget (paciente)
 *  - author (médico)
 *  - custodian (clínica)
 *  - structuredBody con secciones de antecedentes, diagnósticos, plan,
 *    recetas y exploración.
 *
 * NO usa una librería HL7 completa — construimos el XML directo con
 * xmlbuilder2. Suficiente para cumplir el formato de export.
 *
 * ADENDAS (hallazgo 25 · WS1-T3). Una nota firmada es inalterable por la
 * NOM-024, así que la corrección no se escribe encima: se añade como ADENDA
 * fechada y firmada (POST /api/clinical-notes/[id]/addendum). El PDF ya las
 * imprime (PR #235); este export no las mencionaba, de modo que el expediente
 * que sale de DaleControl POR MÁQUINA —a otra clínica, a un hospital, a una
 * aseguradora— era menos fiel que el que sale en papel.
 *
 * POR QUÉ ESTE MECANISMO Y NO OTRO. CDA es un estándar, y la etiqueta no se
 * inventa. Lo que el estándar prevé para "corrección posterior a un documento
 * ya emitido" es `ClinicalDocument/relatedDocument[@typeCode="APND"]`, y es
 * DOCUMENTO→DOCUMENTO: sirve cuando la adenda ES un CDA aparte que apunta a su
 * padre. Aquí no aplica: este export es UN documento que empaqueta el
 * expediente entero, y las adendas cuelgan de notas concretas dentro de él.
 * Usar APND aquí diría "todo este expediente es una adenda de otro documento",
 * que es falso y que un receptor que lo honre archivaría mal.
 *
 * Y dentro de un documento CDA R2 NO existe ninguna relación que signifique
 * "añade a": `entryRelationship/@typeCode` está cerrado a
 * x_ActRelationshipEntryRelationship (COMP, RSON, SUBJ, CAUS, MFST, SPRT,
 * REFR, SAS, GEVL, XCRPT) y `reference/@typeCode` a
 * x_ActRelationshipExternalReference (ELNK, REFR, RPLC, SPRT, SUBJ, XCRPT).
 * APND no está en ninguna de las dos. Comprobado contra el value set publicado,
 * no de memoria.
 *
 * Así que cada adenda se emite con las tres piezas que sí son estándar y que
 * juntas dicen lo que hay que decir:
 *   1. `code` LOINC 34109-9 "Note" con `translation` a LOINC 55107-7
 *      "Addendum Document" — el concepto "información suplementaria añadida al
 *      contenido original del documento" es del propio LOINC, no nuestro;
 *   2. `effectiveTime` y `author/time` con el instante de la adenda (con huso
 *      explícito) y el autor congelado en su día — el CUÁNDO y el QUIÉN;
 *   3. `reference[@typeCode="SUBJ"]/externalDocument/id` con el id de la NOTA
 *      FIRMADA que corrige — el A QUÉ, por identificador y no por posición.
 * Se descartó `RPLC` a propósito: diría que la adenda SUSTITUYE a la nota, y un
 * receptor podría retirar la original. Una adenda nunca sustituye.
 *
 * La nota original no se toca: su `<text>` sale exactamente igual que antes y
 * las adendas viven en una SUBSECCIÓN aparte de su sección. Y un paciente sin
 * adendas produce el mismo XML de siempre, byte a byte: todo lo de aquí abajo
 * está condicionado a que haya al menos una.
 */

import { create } from "xmlbuilder2";

// OID raíz reservado para DaleControl (ejemplo). En producción registrar
// uno oficial con HL7 México.
const OID_MEDIFLOW_ROOT = "2.16.840.1.113883.3.7777.1";
const OID_MEDIFLOW_PATIENT = "2.16.840.1.113883.3.7777.1.1";
const OID_MEDIFLOW_CLINIC = "2.16.840.1.113883.3.7777.1.2";
const OID_CIE10 = "2.16.840.1.113883.6.3";
const OID_CUMS_MX = "2.16.840.1.113883.3.7777.2.1"; // local CUMS
const TEMPLATE_ID_NOM024 = "2.16.840.1.113883.3.7777.10.1";

// Arcos nuevos bajo la raíz de DaleControl, para poder citar por IDENTIFICADOR
// la nota firmada, la adenda y su autor. Numéricos a propósito: un OID solo
// admite arcos numéricos (los `...7777.curp` / `...7777.cedula` de arriba no
// lo son — vienen de antes y cambiarlos alteraría el CDA de TODOS los
// pacientes, incluidos los que no tienen adendas; queda dicho en el reporte).
const OID_MEDIFLOW_NOTE = "2.16.840.1.113883.3.7777.1.3";
const OID_MEDIFLOW_ADDENDUM = "2.16.840.1.113883.3.7777.1.4";
const OID_MEDIFLOW_USER = "2.16.840.1.113883.3.7777.1.5";
const OID_LOINC = "2.16.840.1.113883.6.1";
/** C-CDA "Note Activity" — la plantilla estándar de una nota clínica como
 *  entrada estructurada. Es la que da `code`/`statusCode`/`effectiveTime`/
 *  `author` a algo que, si no, sería texto suelto. */
const TEMPLATE_ID_NOTE_ACTIVITY = "2.16.840.1.113883.10.20.22.4.202";
const TEMPLATE_ID_NOTE_ACTIVITY_EXT = "2016-11-01";
const LOINC_NOTE = "34109-9";          // "Note"
const LOINC_ADDENDUM = "55107-7";      // "Addendum Document"
const LOINC_CONSULT_NOTE = "11488-4";  // "Consult note" — el que ya usaba el archivo

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "00000000";
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "00000000000000";
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/**
 * Una adenda tal y como la guarda POST /api/clinical-notes/[id]/addendum en
 * `specialtyData.addenda` (ver `StoredAddendum` en esa ruta). Aquí solo se
 * necesita lo que viaja: qué dice, quién la firmó, cuándo, y su id.
 */
export interface CdaAddendumRow {
  id: string | null;
  text: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string; // ISO tal y como se guardó
}

/**
 * Las adendas guardadas en `specialtyData.addenda`, saneadas y en ORDEN
 * CRONOLÓGICO. Espejo del lector que tiene la propia ruta del addendum, que no
 * se puede importar: un `route.ts` de App Router solo debe exportar sus
 * handlers. Mismo criterio, a propósito, que el del PDF (PR #235): una fila sin
 * texto o sin fecha se descarta al LEER —una corrección que no se puede fechar
 * ni atribuir no se puede exportar como corrección firmada— y nunca se
 * reescribe encima de la original.
 */
export function readCdaAddenda(specialtyData: unknown): CdaAddendumRow[] {
  const raw = (specialtyData as Record<string, unknown> | null | undefined)?.addenda;
  return Array.isArray(raw) ? cleanAddenda(raw) : [];
}

/** Filas utilizables, ordenadas. Se aplica también sobre lo que llegue por
 *  `BuildInput`, para que el XML no dependa de que quien llama haya saneado. */
function cleanAddenda(rows: readonly unknown[]): CdaAddendumRow[] {
  return sortAddenda(
    rows
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .filter((a) => typeof a.text === "string" && a.text.trim().length > 0)
      .filter((a) => typeof a.createdAt === "string" && a.createdAt.length > 0)
      .map((a) => ({
        id: typeof a.id === "string" && a.id.trim().length > 0 ? a.id.trim() : null,
        text: String(a.text).trim(),
        authorId:
          typeof a.authorId === "string" && a.authorId.trim().length > 0
            ? a.authorId.trim()
            : null,
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
 * orden en que ocurrieron. Una fecha ilegible no se descarta ni reordena a las
 * demás — se queda donde estaba, para no inventar una cronología que el dato no
 * dice. (Su `effectiveTime` saldrá con nullFlavor, ver `addendumTs`.)
 */
function sortAddenda(rows: CdaAddendumRow[]): CdaAddendumRow[] {
  return rows
    .map((row, i) => ({ row, i, t: new Date(row.createdAt).getTime() }))
    .sort((a, b) => {
      if (isNaN(a.t) || isNaN(b.t)) return a.i - b.i;
      return a.t - b.t || a.i - b.i;
    })
    .map((x) => x.row);
}

/**
 * Instante de una adenda en formato TS de HL7, CON HUSO EXPLÍCITO.
 * `fmtDateTime` (arriba, y la usa el resto del documento) emite el instante en
 * UTC pero SIN offset, y un TS sin offset es de huso desconocido: se puede leer
 * con hasta un día de margen. Para una adenda eso no vale, porque su fecha es
 * justo la prueba de que es posterior a la firma. Los campos que ya existían no
 * se tocan —cambiarlos alteraría el CDA de pacientes sin adendas—; los nuevos
 * salen bien desde el primer día. `null` si la fecha guardada no se entiende.
 */
function addendumTs(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "+0000";
}

/**
 * Fecha de adenda legible para el narrativo.
 *
 * EN UTC Y DICIÉNDOLO, a diferencia del resto del archivo, que formatea con el
 * huso del proceso. Dos motivos: este documento se lee en OTRA institución, que
 * no tiene por qué estar en el huso del servidor que lo generó; y la fecha de
 * una adenda es justo la prueba de que llegó después de la firma, así que una
 * hora sin huso no sirve. Así el narrativo dice exactamente el mismo instante
 * que el `effectiveTime` de al lado, y además no depende de TZ al probarlo.
 *
 * Si el ISO guardado no se puede interpretar se escribe tal cual en vez de un
 * "Invalid Date": el dato original vale más que una fecha inventada.
 */
function addendumLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const fecha = d.toLocaleDateString("es-MX", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  const hora = d.toISOString().slice(11, 16);
  return `${fecha}, ${hora} UTC`;
}

/**
 * Ancla del narrativo a la que apunta `act/text/reference/@value`. Tiene que
 * ser un `xs:ID` válido y ÚNICO en todo el documento: de ahí el prefijo (un
 * ID no puede empezar por dígito), el id de la nota (único por definición) y
 * el ordinal. Cualquier carácter que un `xs:ID` no admita se sustituye.
 */
function addendumAnchor(recordId: string, index: number): string {
  return `adenda-${recordId.replace(/[^A-Za-z0-9._-]/g, "_")}-${index + 1}`;
}

/** "1 adenda" / "3 adendas". */
function plural(n: number): string {
  return n === 1 ? "1 adenda" : `${n} adendas`;
}

/** La frase de la subsección. Frases enteras y no un plural pegado con una
 *  `s`: esto lo lee un profesional o un abogado del sistema que recibe. Mismo
 *  texto que el PDF del PR #235, para que el papel y el XML digan lo mismo. */
function fraseAdendas(n: number): string {
  return n === 1
    ? "1 adenda añadida después de firmar la nota. No modifica ni sustituye la nota original: la corrige o la completa, y se lee junto con ella."
    : `${n} adendas añadidas después de firmar la nota. No modifican ni sustituyen la nota original: la corrigen o la completan, y se leen junto con ella.`;
}

interface BuildInput {
  documentId: string;
  effectiveTime: Date;
  clinic: {
    id: string;
    name: string;
    clues: string | null;
    address: string | null;
    phone: string | null;
  };
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    dob: Date | null;
    gender: string;
    curp: string | null;
    passportNo: string | null;
    address: string | null;
    familyHistory: string | null;
    personalNonPathologicalHistory: string | null;
    chronicConditions: string[];
    allergies: string[];
    currentMedications: string[];
  };
  doctor: {
    id: string;
    firstName: string;
    lastName: string;
    cedulaProfesional: string | null;
    especialidad: string | null;
  };
  records: Array<{
    id: string;
    visitDate: Date;
    subjective: string | null;
    objective: string | null;
    assessment: string | null;
    plan: string | null;
    diagnoses: Array<{ code: string; description: string }>;
    /** Correcciones posteriores a la firma. Opcional a propósito: sin adendas
     *  —o si quien llama no las pasa— el XML sale exactamente como antes. */
    addenda?: readonly CdaAddendumRow[];
  }>;
  prescriptions: Array<{
    id: string;
    issuedAt: Date;
    items: Array<{ cumsKey: string; descripcion: string; dosage: string }>;
  }>;
}

/** El nodo que devuelve xmlbuilder2. `ReturnType` en vez de importar
 *  `xmlbuilder2/lib/interfaces`: el paquete no exporta el tipo por su raíz. */
type XmlNode = ReturnType<typeof create>;

/**
 * La SUBSECCIÓN de adendas de una nota, colgada de la sección de esa nota.
 *
 * Subsección y no notas sueltas al final del expediente: así la corrección
 * viaja PEGADA a lo que corrige, y un receptor que importe sección por sección
 * no puede quedarse la nota sin la adenda. La nota original ya se emitió
 * entera y sin tocar antes de llegar aquí — `<component>` va al final de
 * `<section>` por el orden que manda el esquema de CDA (id, code, title, text,
 * …, entry*, component*).
 */
function appendAddendaSection(
  sec: XmlNode,
  recordId: string,
  addenda: readonly CdaAddendumRow[],
): void {
  const sub = sec.ele("component").ele("section");
  sub.ele("code", {
    code: LOINC_ADDENDUM, codeSystem: OID_LOINC,
    codeSystemName: "LOINC", displayName: "Addendum Document",
  });
  sub.ele("title").txt("Adendas — correcciones posteriores a la firma");

  // ── Narrativo ────────────────────────────────────────────────────────────
  // Sin contenido mixto (texto y elementos como hermanos) a propósito: con
  // `prettyPrint` el escritor puede indentar dentro de un elemento mixto y
  // meter saltos y espacios EN MEDIO del texto clínico. Todos los hijos de
  // `<content>` son elementos, así que lo que dice la adenda sale intacto.
  const text = sub.ele("text");
  text.ele("paragraph").txt(fraseAdendas(addenda.length));
  addenda.forEach((a, i) => {
    const wrap = text.ele("paragraph").ele("content", { ID: addendumAnchor(recordId, i) });
    wrap.ele("content", { styleCode: "Bold" }).txt(
      `Adenda ${i + 1} de ${addenda.length} · ${addendumLabel(a.createdAt)}` +
      ` · firmada por ${a.authorName ?? "autor no registrado"}`,
    );
    wrap.ele("br");
    wrap.ele("content").txt(a.text);
  });

  // ── Entradas estructuradas ───────────────────────────────────────────────
  addenda.forEach((a, i) => {
    const act = sub.ele("entry").ele("act", { classCode: "ACT", moodCode: "EVN" });
    act.ele("templateId", {
      root: TEMPLATE_ID_NOTE_ACTIVITY, extension: TEMPLATE_ID_NOTE_ACTIVITY_EXT,
    });
    if (a.id) act.ele("id", { root: OID_MEDIFLOW_ADDENDUM, extension: a.id });

    // El "qué es": una nota (34109-9) que además es una ADENDA (55107-7).
    // El código de adenda va en `translation` y no en `code` porque la
    // plantilla Note Activity fija `code` a 34109-9; `translation` es
    // justamente el hueco que deja para decir de qué tipo de nota se trata.
    const code = act.ele("code", {
      code: LOINC_NOTE, codeSystem: OID_LOINC,
      codeSystemName: "LOINC", displayName: "Note",
    });
    code.ele("translation", {
      code: LOINC_ADDENDUM, codeSystem: OID_LOINC,
      codeSystemName: "LOINC", displayName: "Addendum Document",
    });

    act.ele("text").ele("reference", { value: `#${addendumAnchor(recordId, i)}` });
    act.ele("statusCode", { code: "completed" });

    // El "cuándo". Si la fecha guardada no se entiende, nullFlavor UNK: es
    // preferible declarar que no se sabe a emitir un TS inválido que el
    // receptor interpretaría a su manera.
    const ts = addendumTs(a.createdAt);
    if (ts) act.ele("effectiveTime", { value: ts });
    else act.ele("effectiveTime", { nullFlavor: "UNK" });

    // El "quién". `assignedAuthor/id` es 1..* en CDA: si no hay autor
    // identificado se dice con nullFlavor, no se omite.
    const author = act.ele("author");
    if (ts) author.ele("time", { value: ts });
    else author.ele("time", { nullFlavor: "UNK" });
    const assigned = author.ele("assignedAuthor");
    if (a.authorId) assigned.ele("id", { root: OID_MEDIFLOW_USER, extension: a.authorId });
    else assigned.ele("id", { nullFlavor: "UNK" });
    if (a.authorName) {
      // `<name>` con el nombre entero y no `<given>`/`<family>`: la ruta del
      // addendum congela un nombre para mostrar, y partirlo por el espacio
      // sería inventar un apellido. PN admite texto directo.
      assigned.ele("assignedPerson").ele("name").txt(a.authorName);
    }

    // El "a qué". Por identificador de la NOTA FIRMADA, no por posición en el
    // documento. SUBJ ("has subject") es lo más preciso que permite
    // x_ActRelationshipExternalReference: la adenda trata SOBRE esa nota.
    // RPLC está en ese mismo value set y se descarta a conciencia — diría que
    // la sustituye, y un receptor podría retirar la original.
    const ref = act.ele("reference", { typeCode: "SUBJ" });
    const ext = ref.ele("externalDocument", { classCode: "DOCCLIN", moodCode: "EVN" });
    ext.ele("id", { root: OID_MEDIFLOW_NOTE, extension: recordId });
    ext.ele("code", {
      code: LOINC_CONSULT_NOTE, codeSystem: OID_LOINC,
      codeSystemName: "LOINC", displayName: "Consult note",
    });
  });
}

export function buildCdaXml(input: BuildInput): string {
  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele("ClinicalDocument", {
      xmlns: "urn:hl7-org:v3",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "xmlns:mediflow": "urn:mediflow:cda",
    });

  // ── Header ─────────────────────────────────────────────────────────
  doc.ele("realmCode",   { code: "MX" });
  doc.ele("typeId",      { root: "2.16.840.1.113883.1.3", extension: "POCD_HD000040" });
  doc.ele("templateId",  { root: TEMPLATE_ID_NOM024 });
  doc.ele("id",          { root: OID_MEDIFLOW_ROOT, extension: input.documentId });
  doc.ele("code",        {
    code: "11488-4", codeSystem: "2.16.840.1.113883.6.1",
    codeSystemName: "LOINC", displayName: "Consult note",
  });
  doc.ele("title").txt(`Expediente clínico — ${input.patient.firstName} ${input.patient.lastName}`);
  doc.ele("effectiveTime", { value: fmtDateTime(input.effectiveTime) });
  doc.ele("confidentialityCode", { code: "N", codeSystem: "2.16.840.1.113883.5.25" });
  doc.ele("languageCode", { code: "es-MX" });

  // ── recordTarget (paciente) ─────────────────────────────────────────
  const rt = doc.ele("recordTarget").ele("patientRole");
  if (input.patient.curp) {
    rt.ele("id", { root: "2.16.840.1.113883.3.7777.curp", extension: input.patient.curp });
  } else if (input.patient.passportNo) {
    rt.ele("id", { root: "2.16.840.1.113883.3.7777.passport", extension: input.patient.passportNo });
  } else {
    rt.ele("id", { root: OID_MEDIFLOW_PATIENT, extension: input.patient.id });
  }
  if (input.patient.address) {
    rt.ele("addr").txt(input.patient.address);
  }
  const patient = rt.ele("patient");
  patient.ele("name")
    .ele("given").txt(input.patient.firstName).up()
    .ele("family").txt(input.patient.lastName).up();
  const genderCode = input.patient.gender === "M" ? "M" : input.patient.gender === "F" ? "F" : "UN";
  patient.ele("administrativeGenderCode", {
    code: genderCode, codeSystem: "2.16.840.1.113883.5.1",
  });
  if (input.patient.dob) {
    patient.ele("birthTime", { value: fmtDate(input.patient.dob) });
  }

  // ── author (médico) ─────────────────────────────────────────────────
  const author = doc.ele("author");
  author.ele("time", { value: fmtDateTime(input.effectiveTime) });
  const aPerson = author.ele("assignedAuthor");
  aPerson.ele("id", {
    root: "2.16.840.1.113883.3.7777.cedula",
    extension: input.doctor.cedulaProfesional ?? input.doctor.id,
  });
  const aName = aPerson.ele("assignedPerson").ele("name");
  aName.ele("given").txt(input.doctor.firstName).up()
       .ele("family").txt(input.doctor.lastName).up();
  if (input.doctor.especialidad) {
    aPerson.ele("code").txt(input.doctor.especialidad);
  }

  // ── custodian (clínica) ─────────────────────────────────────────────
  const cust = doc.ele("custodian").ele("assignedCustodian").ele("representedCustodianOrganization");
  cust.ele("id", {
    root: "2.16.840.1.113883.3.7777.clues",
    extension: input.clinic.clues ?? input.clinic.id,
  });
  cust.ele("name").txt(input.clinic.name);
  if (input.clinic.phone) {
    cust.ele("telecom", { value: `tel:${input.clinic.phone}` });
  }
  if (input.clinic.address) {
    cust.ele("addr").txt(input.clinic.address);
  }

  // ── component / structuredBody ──────────────────────────────────────
  const body = doc.ele("component").ele("structuredBody");

  // Adendas por nota, saneadas una sola vez: hacen falta ANTES del bucle para
  // saber si el expediente entero lleva correcciones, y dentro del bucle para
  // emitirlas. Sin adendas todo esto queda en listas vacías y el XML es el de
  // siempre.
  const addendaPorNota = input.records.map((r) => cleanAddenda(r.addenda ?? []));
  const totalAdendas = addendaPorNota.reduce((n, a) => n + a.length, 0);
  const notasConAdendas = addendaPorNota.filter((a) => a.length > 0).length;

  // Sección 0 — Aviso, y solo si hay algo que avisar.
  // Va la PRIMERA por el mismo motivo por el que en el PDF (PR #235) el aviso
  // va en la primera página y no al final: quien abre el expediente tiene que
  // saber que está corregido antes de leerlo. Un receptor que no entienda esta
  // sección no pierde nada — lo que vale de verdad son las entradas
  // estructuradas de cada nota.
  if (totalAdendas > 0) {
    const aviso = body.ele("component").ele("section");
    aviso.ele("code", {
      code: LOINC_ADDENDUM, codeSystem: OID_LOINC,
      codeSystemName: "LOINC", displayName: "Addendum Document",
    });
    aviso.ele("title").txt("Atención: este expediente contiene adendas posteriores a la firma");
    const avisoText = aviso.ele("text");
    avisoText.ele("paragraph").txt(
      `Este expediente incluye ${plural(totalAdendas)} posterior${totalAdendas === 1 ? "" : "es"}` +
      ` a la firma, en ${notasConAdendas === 1 ? "1 nota" : `${notasConAdendas} notas`}.`,
    );
    avisoText.ele("paragraph").txt(
      "Una adenda no modifica ni sustituye la nota original: la corrige o la completa, y se lee " +
      "junto con ella. Cada una viaja dentro de la sección de su propia nota, en la subsección " +
      "«Adendas — correcciones posteriores a la firma», con su fecha, su autor y una referencia " +
      "al identificador de la nota firmada que corrige.",
    );
  }

  // Sección 1 — Antecedentes
  const antecedentes = body.ele("component").ele("section");
  antecedentes.ele("code", {
    code: "11369-6", codeSystem: "2.16.840.1.113883.6.1",
    displayName: "Historia personal",
  });
  antecedentes.ele("title").txt("Antecedentes");
  const antecedentesText: string[] = [];
  if (input.patient.familyHistory) antecedentesText.push(`Heredofamiliares: ${input.patient.familyHistory}`);
  if (input.patient.personalNonPathologicalHistory) antecedentesText.push(`Personales no patológicos: ${input.patient.personalNonPathologicalHistory}`);
  if (input.patient.chronicConditions.length) antecedentesText.push(`Enfermedades crónicas: ${input.patient.chronicConditions.join(", ")}`);
  if (input.patient.allergies.length) antecedentesText.push(`Alergias: ${input.patient.allergies.join(", ")}`);
  if (input.patient.currentMedications.length) antecedentesText.push(`Medicación actual: ${input.patient.currentMedications.join(", ")}`);
  antecedentes.ele("text").txt(antecedentesText.join("\n") || "Sin antecedentes registrados.");

  // Sección 2 — Notas / Padecimiento actual / Exploración / Plan
  for (const [i, r] of input.records.entries()) {
    const adendas = addendaPorNota[i];
    const sec = body.ele("component").ele("section");
    // El identificador de la nota firmada, para que la adenda pueda citarla.
    // Solo cuando hay adendas: sin ellas el XML tiene que salir igual que hoy.
    // `<id>` va antes de `<code>` porque así lo ordena el esquema de CDA.
    if (adendas.length) sec.ele("id", { root: OID_MEDIFLOW_NOTE, extension: r.id });
    sec.ele("code", { code: "11488-4", codeSystem: "2.16.840.1.113883.6.1", displayName: "Consult note" });
    sec.ele("title").txt(`Consulta ${r.visitDate.toLocaleDateString("es-MX")}`);
    const noteText: string[] = [];
    if (r.subjective) noteText.push(`Padecimiento: ${r.subjective}`);
    if (r.objective)  noteText.push(`Exploración: ${r.objective}`);
    if (r.assessment) noteText.push(`Diagnóstico: ${r.assessment}`);
    if (r.plan)       noteText.push(`Plan: ${r.plan}`);
    sec.ele("text").txt(noteText.join("\n") || "Sin contenido clínico.");

    // Diagnósticos estructurados (CIE-10)
    if (r.diagnoses.length) {
      const dxEntry = sec.ele("entry");
      const obs = dxEntry.ele("observation", { classCode: "OBS", moodCode: "EVN" });
      for (const dx of r.diagnoses) {
        obs.ele("value", {
          "xsi:type": "CD",
          code: dx.code, codeSystem: OID_CIE10,
          codeSystemName: "ICD-10",
          displayName: dx.description,
        });
      }
    }

    // Las adendas de ESTA nota, debajo de la nota y no en su lugar. Lo de
    // arriba —el `<text>` firmado y sus diagnósticos— ya salió intacto.
    if (adendas.length) appendAddendaSection(sec, r.id, adendas);
  }

  // Sección 3 — Recetas / Medicaciones
  if (input.prescriptions.length) {
    const sec = body.ele("component").ele("section");
    sec.ele("code", { code: "10160-0", codeSystem: "2.16.840.1.113883.6.1", displayName: "Medications" });
    sec.ele("title").txt("Recetas / Medicación prescrita");
    const lines: string[] = [];
    for (const rx of input.prescriptions) {
      lines.push(`Receta ${rx.id} (${rx.issuedAt.toLocaleDateString("es-MX")}):`);
      for (const it of rx.items) {
        lines.push(`  - ${it.descripcion} — ${it.dosage}`);
      }
    }
    sec.ele("text").txt(lines.join("\n"));

    // Entradas estructuradas
    for (const rx of input.prescriptions) {
      for (const it of rx.items) {
        const entry = sec.ele("entry");
        const subAdmin = entry.ele("substanceAdministration", { classCode: "SBADM", moodCode: "INT" });
        subAdmin.ele("text").txt(it.dosage);
        const product = subAdmin.ele("consumable").ele("manufacturedProduct").ele("manufacturedMaterial");
        product.ele("code", {
          code: it.cumsKey, codeSystem: OID_CUMS_MX,
          codeSystemName: "CUMS",
          displayName: it.descripcion,
        });
      }
    }
  }

  return doc.end({ prettyPrint: true });
}

export const CDA_OIDS = {
  ROOT: OID_MEDIFLOW_ROOT,
  PATIENT: OID_MEDIFLOW_PATIENT,
  CLINIC: OID_MEDIFLOW_CLINIC,
  NOTE: OID_MEDIFLOW_NOTE,
  ADDENDUM: OID_MEDIFLOW_ADDENDUM,
  USER: OID_MEDIFLOW_USER,
  TEMPLATE_NOTE_ACTIVITY: TEMPLATE_ID_NOTE_ACTIVITY,
  CIE10: OID_CIE10,
  CUMS: OID_CUMS_MX,
  TEMPLATE_NOM024: TEMPLATE_ID_NOM024,
};
