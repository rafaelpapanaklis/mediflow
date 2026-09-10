/**
 * WS1-T3 · hallazgo 25 (tercera mitad) — las ADENDAS en el CDA del expediente.
 *
 * Run: npm run test:cda-adendas
 *
 * EL HALLAZGO. Una nota firmada es inalterable (NOM-024), así que el doctor que
 * anotó «pieza 26» donde era la 27 lo corrige con una ADENDA
 * (POST /api/clinical-notes/[id]/addendum). El PDF ya las imprime (PR #235). El
 * CDA no las mencionaba — y el CDA es el formato con el que el expediente SALE
 * de DaleControl hacia otra clínica, un hospital o una aseguradora. Un PDF lo
 * lee una persona que puede notar algo raro; el CDA lo importa una máquina que
 * se cree lo que le llega. El expediente que viajaba por máquina era MENOS fiel
 * que el que viajaba en papel.
 *
 * LO QUE SE FIJA AQUÍ:
 *   · un paciente SIN adendas produce un CDA idéntico al de hoy, byte a byte
 *     (se compara contra la salida literal del código de `origin/main`);
 *   · una nota con adendas las lleva, con su texto, su fecha y su autor;
 *   · la nota original viaja igual: ni se corrige, ni se sustituye, ni se
 *     fusiona con la adenda — las dos cosas, y su relación;
 *   · el receptor puede saber que son POSTERIORES A LA FIRMA y de QUÉ nota, por
 *     código estándar (LOINC 55107-7) y por identificador, no por posición;
 *   · el XML está bien formado y su estructura es la que manda CDA R2.
 *
 * CÓMO. Se ejecuta el route handler de verdad —GET /api/patients/[id]/export-cda—
 * con Prisma, la auth, la visibilidad y la auditoría sustituidos, y se valida el
 * XML que devuelve. El generador NO se falsea. Los códigos del estándar se
 * escriben LITERALES en las aserciones (55107-7, 34109-9, el OID de la
 * plantilla): el test fija el estándar, no lo que diga el código.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { create } from "xmlbuilder2";
import { SaxesParser } from "saxes";

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOTA_S = "Dolor en pieza 26 al masticar.";
const NOTA_O = "Caries oclusal profunda en pieza 26.";
const NOTA_A = "Pulpitis reversible en pieza 26.";
const NOTA_P = "Resina compuesta y control en 15 días.";

const TEXTO_CORRECCION =
  "Donde dice «pieza 26» debe decir «pieza 27». Se corrige por error de captura al transcribir la exploración.";
const TEXTO_AMPLIACION =
  "Se amplía el hallazgo a petición del seguro: exposición pulpar puntiforme no visible en la radiografía previa.";
const TEXTO_SEGUIMIENTO =
  "Control de 15 días: sin sintomatología, pruebas de vitalidad normales.";

const AUTOR = "Dr/a. Ana Ruiz";
const AUTOR_2 = "Dr/a. Luis Prado";

const OID_PLANTILLA_NOTE_ACTIVITY = "2.16.840.1.113883.10.20.22.4.202";
const OID_LOINC = "2.16.840.1.113883.6.1";
const LOINC_NOTE = "34109-9";
const LOINC_ADENDA = "55107-7";

function adenda(text: string, createdAt: string, authorName: string | null, id = `ad-${createdAt}`) {
  return { id, text, createdAt, authorName, authorId: authorName === AUTOR_2 ? "u2" : "u1" };
}

/**
 * LA SALIDA DE HOY, literal. Es lo que produce `buildCdaXml` en `origin/main`
 * (commit 5aa46ed2) con la entrada `ENTRADA_FIJA` de abajo, generada y pegada
 * aquí a mano. Sirve de ancla del tercer requisito: "un paciente sin adendas
 * produce un CDA idéntico al de hoy". Si algo de este trabajo se cuela en el
 * expediente de un paciente que NO tiene correcciones, esta comparación lo
 * caza — no hace falta confiar en que el diff parecía inofensivo.
 */
const CDA_DE_HOY = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:mediflow="urn:mediflow:cda">
  <realmCode code="MX"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.3.7777.10.1"/>
  <id root="2.16.840.1.113883.3.7777.1" extension="cda-pat_1-FIJO"/>
  <code code="11488-4" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC" displayName="Consult note"/>
  <title>Expediente clínico — Laura Menéndez</title>
  <effectiveTime value="20260910120000"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="es-MX"/>
  <recordTarget>
    <patientRole>
      <id root="2.16.840.1.113883.3.7777.1.1" extension="pat_1"/>
      <addr>Calle 1</addr>
      <patient>
        <name>
          <given>Laura</given>
          <family>Menéndez</family>
        </name>
        <administrativeGenderCode code="F" codeSystem="2.16.840.1.113883.5.1"/>
        <birthTime value="19880304"/>
      </patient>
    </patientRole>
  </recordTarget>
  <author>
    <time value="20260910120000"/>
    <assignedAuthor>
      <id root="2.16.840.1.113883.3.7777.cedula" extension="12345678"/>
      <assignedPerson>
        <name>
          <given>Ana</given>
          <family>Ruiz</family>
        </name>
      </assignedPerson>
      <code>Odontología</code>
    </assignedAuthor>
  </author>
  <custodian>
    <assignedCustodian>
      <representedCustodianOrganization>
        <id root="2.16.840.1.113883.3.7777.clues" extension="DFSSA000001"/>
        <name>Clínica Dental Menta</name>
        <telecom value="tel:5555555555"/>
        <addr>Av. Reforma 1</addr>
      </representedCustodianOrganization>
    </assignedCustodian>
  </custodian>
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="11369-6" codeSystem="2.16.840.1.113883.6.1" displayName="Historia personal"/>
          <title>Antecedentes</title>
          <text>Heredofamiliares: Madre con diabetes tipo 2.
Alergias: Penicilina</text>
        </section>
      </component>
      <component>
        <section>
          <code code="11488-4" codeSystem="2.16.840.1.113883.6.1" displayName="Consult note"/>
          <title>Consulta 1/9/2026</title>
          <text>Padecimiento: Dolor en pieza 26 al masticar.
Exploración: Caries oclusal profunda en pieza 26.
Diagnóstico: Pulpitis reversible en pieza 26.
Plan: Resina compuesta y control en 15 días.</text>
          <entry>
            <observation classCode="OBS" moodCode="EVN">
              <value xsi:type="CD" code="K02.1" codeSystem="2.16.840.1.113883.6.3" codeSystemName="ICD-10" displayName="Caries de la dentina"/>
            </observation>
          </entry>
        </section>
      </component>
      <component>
        <section>
          <code code="10160-0" codeSystem="2.16.840.1.113883.6.1" displayName="Medications"/>
          <title>Recetas / Medicación prescrita</title>
          <text>Receta rx_1 (1/9/2026):
  - Amoxicilina 500 mg — 1 cápsula cada 8 h por 7 días</text>
          <entry>
            <substanceAdministration classCode="SBADM" moodCode="INT">
              <text>1 cápsula cada 8 h por 7 días</text>
              <consumable>
                <manufacturedProduct>
                  <manufacturedMaterial>
                    <code code="010.000.0104.00" codeSystem="2.16.840.1.113883.3.7777.2.1" codeSystemName="CUMS" displayName="Amoxicilina 500 mg"/>
                  </manufacturedMaterial>
                </manufacturedProduct>
              </consumable>
            </substanceAdministration>
          </entry>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>`;

/** La entrada con la que se generó `CDA_DE_HOY`. Fechas y textos fijos: el
 *  documento tiene que salir determinista para poder compararlo. */
const ENTRADA_FIJA = {
  documentId: "cda-pat_1-FIJO",
  effectiveTime: new Date("2026-09-10T12:00:00.000Z"),
  clinic: { id: "cli_1", name: "Clínica Dental Menta", clues: "DFSSA000001", address: "Av. Reforma 1", phone: "5555555555" },
  patient: {
    id: "pat_1", firstName: "Laura", lastName: "Menéndez", dob: new Date("1988-03-04T00:00:00.000Z"),
    gender: "F", curp: null, passportNo: null, address: "Calle 1",
    familyHistory: "Madre con diabetes tipo 2.", personalNonPathologicalHistory: null,
    chronicConditions: [], allergies: ["Penicilina"], currentMedications: [],
  },
  doctor: { id: "u1", firstName: "Ana", lastName: "Ruiz", cedulaProfesional: "12345678", especialidad: "Odontología" },
  records: [{
    id: "rec_1",
    visitDate: new Date("2026-09-01T16:30:00.000Z"),
    subjective: NOTA_S, objective: NOTA_O, assessment: NOTA_A, plan: NOTA_P,
    diagnoses: [{ code: "K02.1", description: "Caries de la dentina" }],
  }],
  prescriptions: [{
    id: "rx_1",
    issuedAt: new Date("2026-09-01T17:00:00.000Z"),
    items: [{ cumsKey: "010.000.0104.00", descripcion: "Amoxicilina 500 mg", dosage: "1 cápsula cada 8 h por 7 días" }],
  }],
};

// ── Dobles ──────────────────────────────────────────────────────────────────
// Solo lo que habla con la red o la base. El gate de permisos
// (`denyIfMissingPermission` + la matriz real) NO se falsea: se cumple.

/** Las notas que verá el export en cada caso. Se reasigna por prueba. */
let notas: any[] = [];

mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () => ({
      id: "u1", clinicId: "cli_1", role: "ADMIN", permissionsOverride: [],
      firstName: "Ana", lastName: "Ruiz",
      cedulaProfesional: "12345678", especialidad: "Odontología",
    }),
  },
});

mock.module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async () => undefined,
    extractAuditMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patient: {
        findFirst: async ({ where }: any) =>
          where.id === "pat_1" && where.clinicId === "cli_1"
            ? {
                id: "pat_1", firstName: "Laura", lastName: "Menéndez",
                dob: new Date("1988-03-04T00:00:00.000Z"), gender: "F",
                curp: null, passportNo: null, address: "Calle 1",
                familyHistory: "Madre con diabetes tipo 2.",
                personalNonPathologicalHistory: null,
                chronicConditions: [], allergies: ["Penicilina"], currentMedications: [],
              }
            : null,
      },
      clinic: {
        findUnique: async () => ({
          id: "cli_1", name: "Clínica Dental Menta", clues: "DFSSA000001",
          address: "Av. Reforma 1", phone: "5555555555",
        }),
      },
      medicalRecord: { findMany: async () => notas },
      prescription: { findMany: async () => [] },
    },
  },
});

/** Una fila de `medicalRecord` como la devuelve el `findMany` del export. */
function filaNota(id: string, addenda: unknown[] | undefined, sufijo = "") {
  const specialtyData: Record<string, unknown> = {
    type: "dental", status: "SIGNED", signedAt: "2026-09-01T17:05:00.000Z",
  };
  if (addenda !== undefined) specialtyData.addenda = addenda;
  return {
    id,
    visitDate: new Date("2026-09-01T16:30:00.000Z"),
    subjective: NOTA_S + sufijo, objective: NOTA_O, assessment: NOTA_A, plan: NOTA_P,
    specialtyData,
    diagnoses_v2: [{ cie10Code: "K02.1", cie10: { description: "Caries de la dentina" } }],
  };
}

/** GET /api/patients/[id]/export-cda con las notas que se le pongan delante. */
async function exportar(filas: any[]) {
  notas = filas;
  const { GET } = await import("@/app/api/patients/[id]/export-cda/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("https://dalecontrol.test/api/patients/pat_1/export-cda");
  const res = await GET(req, { params: { id: "pat_1" } });
  return { status: res.status, xml: await res.text() };
}

// ── Validación del XML ──────────────────────────────────────────────────────

/**
 * BIEN FORMADO de verdad. El parser de xmlbuilder2 es indulgente (cierra tags
 * sueltos y escapa un `&` huérfano sin quejarse), así que para esto se usa
 * `saxes`, que es el parser XML estricto que el propio xmlbuilder2 lleva
 * debajo. Devuelve el error, o null.
 */
function malFormado(xml: string): string | null {
  const p = new SaxesParser();
  let err: string | null = null;
  p.on("error", (e: Error) => { if (!err) err = e.message; });
  try { p.write(xml).close(); } catch (e: any) { if (!err) err = String(e?.message ?? e); }
  return err;
}

/**
 * El ORDEN de hijos que impone el esquema de CDA R2 para cada elemento que este
 * generador emite. En CDA los modelos son SECUENCIAS, no conjuntos: un
 * `<effectiveTime>` antes del `<code>` es tan inválido como inventarse una
 * etiqueta, y un validador contra el XSD lo rechazaría. Como el repo no tiene
 * el XSD ni con qué validarlo (no hay libxml y en un worktree no se instala
 * nada), esta tabla lo comprueba a mano para lo que emitimos.
 */
const ORDEN_CDA: Record<string, string[]> = {
  ClinicalDocument: ["realmCode", "typeId", "templateId", "id", "code", "title", "effectiveTime",
    "confidentialityCode", "languageCode", "setId", "versionNumber", "copyTime", "recordTarget",
    "author", "dataEnterer", "informant", "custodian", "informationRecipient", "legalAuthenticator",
    "authenticator", "participant", "inFulfillmentOf", "documentationOf", "relatedDocument",
    "authorization", "componentOf", "component"],
  section: ["realmCode", "typeId", "templateId", "id", "code", "title", "text",
    "confidentialityCode", "languageCode", "subject", "author", "informant", "entry", "component"],
  act: ["realmCode", "typeId", "templateId", "id", "code", "text", "statusCode", "effectiveTime",
    "priorityCode", "languageCode", "subject", "specimen", "performer", "author", "informant",
    "participant", "entryRelationship", "reference", "precondition"],
  author: ["realmCode", "typeId", "templateId", "functionCode", "time", "assignedAuthor"],
  assignedAuthor: ["realmCode", "typeId", "templateId", "id", "code", "addr", "telecom",
    "assignedPerson", "assignedAuthoringDevice", "representedOrganization"],
  reference: ["realmCode", "typeId", "templateId", "externalAct", "externalObservation",
    "externalProcedure", "externalDocument", "seperatableInd"],
  externalDocument: ["realmCode", "typeId", "templateId", "id", "code", "text", "setId", "versionNumber"],
  code: ["originalText", "qualifier", "translation"],
};

/**
 * Hijos OBLIGATORIOS (minOccurs por defecto = 1 en el XSD) de lo que este
 * documento emite. Solo los que hacen falta para lo que aquí se mira.
 */
const OBLIGATORIOS: Record<string, string[]> = {
  observation: ["code"],
  act: ["code"],
  author: ["time", "assignedAuthor"],
  assignedAuthor: ["id"],
  reference: [],
};

/**
 * `uid` de HL7: la unión `oid | uuid | ruid`, con los patrones LITERALES del
 * esquema (`datatypes-base.xsd`). Es lo que valida un `root` o un `codeSystem`.
 * Ojo con el patrón de `oid`: el esquema de CDA R2 no admite un arco `0`, y no
 * admite arcos que no sean numéricos — que es justo por lo que un
 * `2.16.840.1.113883.3.7777.curp` no es un OID aunque lo parezca.
 */
function uidValido(v: string): boolean {
  return /^[1-9][0-9]*(\.[1-9][0-9]*)*$/.test(v)                       // oid
    || /^[0-9a-zA-Z]{8}(-[0-9a-zA-Z]{4}){3}-[0-9a-zA-Z]{12}$/.test(v)  // uuid
    || /^[A-Za-z][A-Za-z0-9-]*$/.test(v);                              // ruid
}

/** `<reference>` dentro de un `<text>` narrativo es un TEL, no la clase
 *  Reference de CDA: no se le aplica la tabla de orden. */
function esReferenciaNarrativa(el: any): boolean {
  return el.nodeName === "reference" && el.parentNode?.nodeName === "text";
}

function elementos(nodo: any): any[] {
  return Array.from(nodo.childNodes as any[]).filter((n: any) => n.nodeType === 1);
}

function todos(raiz: any, nombre: string): any[] {
  return Array.from(raiz.getElementsByTagName(nombre) as any[]);
}

/**
 * Recorre el documento y devuelve todo lo que un validador de esquema
 * rechazaría de lo que este generador controla: orden de hijos, hijos que no
 * pertenecen al modelo, IDs repetidos y referencias del narrativo que no
 * resuelven.
 */
function problemasDeEstructura(xml: string): string[] {
  const fallos: string[] = [];
  const doc: any = create(xml).node;
  const ids = new Set<string>();
  const referencias: string[] = [];

  const visitar = (el: any) => {
    if (el.nodeName === "content") {
      const id = el.getAttribute("ID");
      if (id) {
        if (ids.has(id)) fallos.push(`ID repetido en el documento: ${id}`);
        ids.add(id);
      }
    }
    if (el.nodeName === "reference" && esReferenciaNarrativa(el)) {
      const v = el.getAttribute("value");
      if (v) referencias.push(v);
    }

    if (!esReferenciaNarrativa(el)) {
      for (const attr of ["root", "codeSystem"]) {
        const v = el.getAttribute(attr);
        if (v && !uidValido(v)) fallos.push(`${attr}="${v}" no es un uid válido`);
      }
      for (const obligatorio of OBLIGATORIOS[el.nodeName] ?? []) {
        if (!elementos(el).some((h: any) => h.nodeName === obligatorio)) {
          fallos.push(`<${el.nodeName}> sin el <${obligatorio}> que exige el esquema`);
        }
      }
    }

    const orden = ORDEN_CDA[el.nodeName];
    if (orden && !esReferenciaNarrativa(el)) {
      let ultimo = -1;
      for (const hijo of elementos(el)) {
        const i = orden.indexOf(hijo.nodeName);
        if (i === -1) {
          fallos.push(`<${hijo.nodeName}> no pertenece al modelo de <${el.nodeName}>`);
          continue;
        }
        if (i < ultimo) fallos.push(`<${hijo.nodeName}> va fuera de orden dentro de <${el.nodeName}>`);
        ultimo = i;
      }
    }
    for (const hijo of elementos(el)) visitar(hijo);
  };
  visitar(doc.documentElement);

  for (const v of referencias) {
    if (!v.startsWith("#")) fallos.push(`referencia narrativa que no es interna: ${v}`);
    else if (!ids.has(v.slice(1))) fallos.push(`referencia narrativa que no resuelve: ${v}`);
  }
  return fallos;
}

/**
 * DEFECTOS QUE YA VENÍAN DE ANTES, y que este validador destapó al escribirlo.
 * Confirmados aparte contra el XSD oficial de CDA R2 con `lxml` (el detalle y
 * cómo repetirlo están en el reporte y en las muestras): el CDA que DaleControl
 * exporta HOY no valida contra el esquema, con adendas y sin ellas.
 *
 *   · `assignedAuthor` emite `<code>` (la especialidad) DESPUÉS de
 *     `<assignedPerson>`, y el modelo los ordena al revés;
 *   · las raíces `…7777.cedula`, `…7777.clues` y `…7777.curp` no son OIDs — un
 *     OID solo admite arcos numéricos;
 *   · el `<observation>` de los diagnósticos CIE-10 sale sin el `<code>` que el
 *     esquema exige.
 *
 * NO se arreglan aquí, y a propósito: tocarlos cambiaría el CDA de TODOS los
 * pacientes —incluidos los que no tienen ninguna corrección— y el tercer
 * requisito de esta rama es justo que ese caso salga idéntico al de hoy. Van
 * anotados en el reporte para que Rafael decida en qué rama entran.
 *
 * Se dejan FIJADOS aquí, y no simplemente ignorados, por dos motivos: que no
 * aparezca ninguno nuevo, y que cuando alguien los arregle esta prueba avise de
 * que la lista ya sobra.
 */
const DEFECTOS_PREVIOS = [
  "<code> va fuera de orden dentro de <assignedAuthor>",
  'root="2.16.840.1.113883.3.7777.cedula" no es un uid válido',
  'root="2.16.840.1.113883.3.7777.clues" no es un uid válido',
  "<observation> sin el <code> que exige el esquema",
];

/** Los `<act>` de adenda: los que llevan la plantilla Note Activity. */
function actosDeAdenda(xml: string): any[] {
  const doc: any = create(xml).node;
  return todos(doc.documentElement, "act").filter((a: any) =>
    todos(a, "templateId").some((t: any) => t.getAttribute("root") === OID_PLANTILLA_NOTE_ACTIVITY));
}

function hijoDirecto(el: any, nombre: string): any | null {
  return elementos(el).find((h: any) => h.nodeName === nombre) ?? null;
}

// ── EL REQUISITO 3: sin adendas, nada cambia ────────────────────────────────

test("H25-CDA · un paciente SIN adendas produce el CDA de hoy, byte a byte", async () => {
  const { buildCdaXml } = await import("@/lib/hl7/cda");

  // Los tres sabores de "no hay adendas" que pueden llegar de la base.
  const casos: Array<[string, unknown]> = [
    ["la nota no trae el campo", undefined],
    ["la lista está vacía", []],
    ["todas las filas son inservibles", [{ text: "   ", createdAt: "" }, { nada: true }, null]],
  ];
  for (const [nombre, addenda] of casos) {
    const entrada: any = JSON.parse(JSON.stringify(ENTRADA_FIJA), (_k, v) =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v);
    if (addenda !== undefined) entrada.records[0].addenda = addenda;
    assert.equal(buildCdaXml(entrada), CDA_DE_HOY, `el CDA cambió cuando ${nombre}`);
  }
});

// ── EL HALLAZGO ─────────────────────────────────────────────────────────────

test("H25-CDA · una adenda viaja en el CDA, con su texto, su fecha y su autor", async () => {
  const { status, xml } = await exportar([
    filaNota("rec_1", [adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR, "ad_1")]),
  ]);

  assert.equal(status, 200);
  assert.ok(xml.includes(TEXTO_CORRECCION), "el texto de la adenda no viaja en el CDA");
  assert.ok(xml.includes(AUTOR), "la adenda viaja sin decir quién la firmó");

  const actos = actosDeAdenda(xml);
  assert.equal(actos.length, 1, "la adenda no viaja como entrada estructurada");
  const act = actos[0];

  // El CUÁNDO, legible por máquina y con huso explícito.
  assert.equal(hijoDirecto(act, "effectiveTime")?.getAttribute("value"), "20260902143200+0000");
  // El QUIÉN.
  const autor = hijoDirecto(act, "author");
  assert.equal(hijoDirecto(autor, "time")?.getAttribute("value"), "20260902143200+0000");
  assert.equal(todos(autor, "name")[0]?.textContent, AUTOR);
  assert.equal(todos(autor, "id")[0]?.getAttribute("extension"), "u1");
  // Su propio identificador, distinto del de la nota.
  assert.equal(hijoDirecto(act, "id")?.getAttribute("extension"), "ad_1");
});

test("H25-CDA · el receptor puede ver que es POSTERIOR A LA FIRMA y de QUÉ nota", async () => {
  const { xml } = await exportar([
    filaNota("rec_1", [adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR, "ad_1")]),
  ]);
  const act = actosDeAdenda(xml)[0];

  // 1) QUÉ ES: LOINC 55107-7 "Addendum Document" — el concepto de "información
  //    añadida al contenido original" es del estándar, no nuestro. Va como
  //    `translation` del 34109-9 que fija la plantilla Note Activity.
  const code = hijoDirecto(act, "code");
  assert.equal(code?.getAttribute("code"), LOINC_NOTE);
  assert.equal(code?.getAttribute("codeSystem"), OID_LOINC);
  const tr = hijoDirecto(code, "translation");
  assert.equal(tr?.getAttribute("code"), LOINC_ADENDA, "falta el código LOINC de adenda");
  assert.equal(tr?.getAttribute("codeSystem"), OID_LOINC);

  // 2) A QUÉ: por IDENTIFICADOR de la nota firmada, no por posición.
  const ref = hijoDirecto(act, "reference");
  assert.equal(ref?.getAttribute("typeCode"), "SUBJ");
  const ext = hijoDirecto(ref, "externalDocument");
  assert.equal(ext?.getAttribute("classCode"), "DOCCLIN");
  assert.equal(hijoDirecto(ext, "id")?.getAttribute("extension"), "rec_1");

  // Y ese identificador existe en el documento: la sección de la nota lo lleva.
  const doc: any = create(xml).node;
  const idsDeSeccion = todos(doc.documentElement, "section")
    .map((s: any) => hijoDirecto(s, "id")?.getAttribute("extension"))
    .filter(Boolean);
  assert.ok(idsDeSeccion.includes("rec_1"), "la adenda apunta a una nota que el documento no identifica");

  // 3) Y NO por el camino equivocado: `RPLC` diría que la adenda SUSTITUYE a la
  //    nota (un receptor podría retirar la original), y `APND` ni siquiera es
  //    legal dentro de un documento — solo entre documentos, en relatedDocument.
  assert.equal(/typeCode="RPLC"/.test(xml), false, "la adenda no sustituye a la nota");
  assert.equal(/APND/.test(xml), false, "APND no es válido dentro de un documento CDA");
  assert.equal(/<relatedDocument/.test(xml), false, "este export no es una adenda de otro documento");
});

test("H25-CDA · la nota original viaja igual: ni se corrige, ni se sustituye, ni se fusiona", async () => {
  const conAdenda = await exportar([
    filaNota("rec_1", [adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR, "ad_1")]),
  ]);
  const sinAdenda = await exportar([filaNota("rec_1", undefined)]);

  const doc: any = create(conAdenda.xml).node;
  const seccionNota = todos(doc.documentElement, "section")
    .find((s: any) => hijoDirecto(s, "id")?.getAttribute("extension") === "rec_1");
  assert.ok(seccionNota, "no se encuentra la sección de la nota");

  // El narrativo firmado sale EXACTAMENTE igual que sin adendas: las dos
  // versiones conviven, que es el punto entero de una adenda.
  const docSin: any = create(sinAdenda.xml).node;
  const textoSin = todos(docSin.documentElement, "section")
    .map((s: any) => hijoDirecto(s, "text"))
    .find((t: any) => t?.textContent?.includes(NOTA_S))?.textContent;
  assert.equal(hijoDirecto(seccionNota, "text").textContent, textoSin,
    "el texto de la nota firmada cambió al añadirle una adenda");
  for (const linea of [NOTA_S, NOTA_O, NOTA_A, NOTA_P]) {
    assert.ok(conAdenda.xml.includes(linea), `la nota firmada perdió: ${linea}`);
  }
  assert.ok(conAdenda.xml.includes(TEXTO_CORRECCION), "y la corrección también tiene que estar");

  // Y la adenda NO está dentro del narrativo de la nota: cuelga de una
  // subsección aparte. Fusionarlas sería reescribir lo firmado.
  assert.equal(hijoDirecto(seccionNota, "text").textContent.includes(TEXTO_CORRECCION), false,
    "la adenda se fusionó con el texto de la nota firmada");
  const sub = hijoDirecto(seccionNota, "component");
  assert.ok(sub, "las adendas no cuelgan de la sección de su nota");
  assert.equal(hijoDirecto(hijoDirecto(sub, "section"), "code")?.getAttribute("code"), LOINC_ADENDA);
});

test("H25-CDA · varias adendas: en orden cronológico, cada una con su autor y atada a SU nota", async () => {
  // Llegan desordenadas a propósito, y repartidas en dos notas.
  const { xml } = await exportar([
    filaNota("rec_1", [
      adenda(TEXTO_SEGUIMIENTO, "2026-09-16T18:10:00.000Z", AUTOR_2, "ad_c"),
      adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR, "ad_a"),
      adenda(TEXTO_AMPLIACION, "2026-09-03T09:15:00.000Z", AUTOR, "ad_b"),
    ]),
    filaNota("rec_2", [adenda("Se corrige la pieza tratada: 36, no 35.", "2026-09-04T10:00:00.000Z", AUTOR_2, "ad_d")], " (segunda visita)"),
  ]);

  for (const t of [TEXTO_CORRECCION, TEXTO_AMPLIACION, TEXTO_SEGUIMIENTO]) {
    assert.ok(xml.includes(t), `falta una adenda en el CDA: ${t.slice(0, 40)}…`);
  }

  const actos = actosDeAdenda(xml);
  assert.equal(actos.length, 4, "no viajan todas las adendas");

  // Orden cronológico, aunque hayan llegado al revés.
  const deRec1 = actos.filter((a: any) =>
    hijoDirecto(hijoDirecto(a, "reference"), "externalDocument") &&
    hijoDirecto(hijoDirecto(hijoDirecto(a, "reference"), "externalDocument"), "id").getAttribute("extension") === "rec_1");
  assert.equal(deRec1.length, 3, "las adendas no quedaron atadas a su propia nota");
  assert.deepEqual(
    deRec1.map((a: any) => hijoDirecto(a, "effectiveTime").getAttribute("value")),
    ["20260902143200+0000", "20260903091500+0000", "20260916181000+0000"],
    "las adendas no salen en orden cronológico",
  );

  // Cada una con su autor: no se hereda el de la nota ni el del que exporta.
  const autores = deRec1.map((a: any) => todos(hijoDirecto(a, "author"), "name")[0].textContent);
  assert.deepEqual(autores, [AUTOR, AUTOR, AUTOR_2]);

  // La cuarta cuelga de la otra nota, no de la primera.
  const deRec2 = actos.filter((a: any) =>
    hijoDirecto(hijoDirecto(hijoDirecto(a, "reference"), "externalDocument"), "id").getAttribute("extension") === "rec_2");
  assert.equal(deRec2.length, 1);

  // Y el aviso de cabecera cuenta bien lo que hay.
  assert.match(xml, /Este expediente incluye 4 adendas posteriores a la firma, en 2 notas\./);
  assert.match(xml, /3 adendas añadidas después de firmar la nota/);
  assert.match(xml, /1 adenda añadida después de firmar la nota/);
});

// ── El XML, como XML ────────────────────────────────────────────────────────

test("H25-CDA · el XML está bien formado y su estructura es la que manda CDA R2", async () => {
  const casos: Array<[string, any[]]> = [
    ["sin adendas", [filaNota("rec_1", undefined)]],
    ["con una", [filaNota("rec_1", [adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR, "ad_1")])]],
    ["con varias", [
      filaNota("rec_1", [
        adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR, "ad_a"),
        adenda(TEXTO_AMPLIACION, "2026-09-03T09:15:00.000Z", null, "ad_b"),
      ]),
      filaNota("rec_2", [adenda(TEXTO_SEGUIMIENTO, "2026-09-16T18:10:00.000Z", AUTOR_2, "ad_c")], " (segunda visita)"),
    ]],
  ];

  for (const [nombre, filas] of casos) {
    const { xml } = await exportar(filas);
    assert.equal(malFormado(xml), null, `XML mal formado ${nombre}`);

    // LO QUE DE VERDAD SE AFIRMA: el MISMO expediente, con y sin adendas, deja
    // exactamente los mismos problemas de esquema. Es decir, las adendas no
    // meten ni uno nuevo. Comparar contra el propio documento sin adendas —y no
    // contra una lista fija— es lo que hace que esto siga valiendo cuando
    // cambie el número de notas del caso.
    const desnudas = await exportar(filas.map((f) => filaNota(f.id, undefined, f.subjective.replace(NOTA_S, ""))));
    assert.deepEqual(
      problemasDeEstructura(xml),
      problemasDeEstructura(desnudas.xml),
      `las adendas introducen problemas de esquema nuevos ${nombre}`,
    );
  }

  // Y el suelo del que se parte, dicho en voz alta: una nota, los cuatro
  // defectos que ya venían de antes y ninguno más.
  const { xml } = await exportar([filaNota("rec_1", undefined)]);
  assert.deepEqual(problemasDeEstructura(xml).sort(), [...DEFECTOS_PREVIOS].sort(),
    "cambiaron los defectos previos del generador: revísalos antes de tocar la lista");
});

test("H25-CDA · sin autor o con fecha ilegible se declara, no se inventa ni se rompe el XML", async () => {
  const { xml } = await exportar([
    filaNota("rec_1", [
      { id: "ad_1", text: "Sin autor registrado.", createdAt: "2026-09-02T14:32:00.000Z", authorName: null, authorId: null },
      { id: "ad_2", text: "Fecha que no se entiende.", createdAt: "el martes pasado", authorName: AUTOR, authorId: "u1" },
    ]),
  ]);

  assert.equal(malFormado(xml), null);
  assert.deepEqual(
    problemasDeEstructura(xml).filter((p) => !DEFECTOS_PREVIOS.includes(p)), [],
    "una adenda rara rompe la estructura del documento",
  );

  const actos = actosDeAdenda(xml);
  assert.equal(actos.length, 2);

  // Sin autor: nullFlavor en el id, y ningún nombre inventado.
  const sinAutor = actos.find((a: any) => hijoDirecto(a, "id").getAttribute("extension") === "ad_1");
  const assigned = hijoDirecto(hijoDirecto(sinAutor, "author"), "assignedAuthor");
  assert.equal(hijoDirecto(assigned, "id").getAttribute("nullFlavor"), "UNK");
  assert.equal(hijoDirecto(assigned, "assignedPerson"), null);
  assert.ok(xml.includes("autor no registrado"), "el narrativo tiene que decir que no consta el autor");

  // Fecha ilegible: nullFlavor, NUNCA un TS inválido que el receptor
  // interpretaría a su manera. Y el dato original sigue en el narrativo.
  const fechaMala = actos.find((a: any) => hijoDirecto(a, "id").getAttribute("extension") === "ad_2");
  assert.equal(hijoDirecto(fechaMala, "effectiveTime").getAttribute("nullFlavor"), "UNK");
  assert.equal(hijoDirecto(fechaMala, "effectiveTime").getAttribute("value"), null);
  assert.ok(xml.includes("el martes pasado"), "se perdió la fecha tal y como estaba guardada");
});

test("H25-CDA · readCdaAddenda: sanea, ordena y no inventa cronologías", async () => {
  const { readCdaAddenda } = await import("@/lib/hl7/cda");

  assert.deepEqual(readCdaAddenda(null), []);
  assert.deepEqual(readCdaAddenda({}), []);
  assert.deepEqual(readCdaAddenda({ addenda: "no es una lista" }), []);

  const filas = readCdaAddenda({
    addenda: [
      adenda(TEXTO_SEGUIMIENTO, "2026-09-16T18:10:00.000Z", AUTOR_2),
      adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR),
      { text: "", createdAt: "2026-09-04T00:00:00.000Z", authorName: AUTOR },  // sin texto
      { text: "algo", createdAt: "", authorName: AUTOR },                       // sin fecha
      null,
      { text: "sin autor", createdAt: "2026-09-03T00:00:00.000Z" },
    ],
  });

  assert.equal(filas.length, 3, "se coló una fila inservible o se perdió una buena");
  assert.deepEqual(
    filas.map((f) => f.createdAt),
    ["2026-09-02T14:32:00.000Z", "2026-09-03T00:00:00.000Z", "2026-09-16T18:10:00.000Z"],
  );
  assert.equal(filas[1].authorName, null, "el autor ausente se marca, no se inventa");

  // Una fecha ilegible no se descarta a ciegas ni reordena a las demás.
  const raras = readCdaAddenda({
    addenda: [
      adenda("primera", "fecha-rota", AUTOR),
      adenda("segunda", "2026-09-02T14:32:00.000Z", AUTOR),
    ],
  });
  assert.deepEqual(raras.map((f) => f.text), ["primera", "segunda"]);
});
