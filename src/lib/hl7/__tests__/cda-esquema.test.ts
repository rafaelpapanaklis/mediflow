/**
 * El CDA que exporta DaleControl valida contra el XSD OFICIAL de HL7 CDA R2.
 *
 * El esquema vive vendorizado en `./xsd/cda-r2/` (edición normativa web 2010 de
 * HL7, repo github.com/HL7/CDA-core-2.0, sin tocar; ver su LEEME.md). La
 * validación la hace libxml2 a través de `python3` + `lxml`: no hay validador
 * XSD en node_modules y un validador «a mano» deja pasar justo lo que el
 * esquema de verdad rechaza. Si falta `python3` o `lxml`, la prueba FALLA —
 * no se salta—: una prueba de esquema que se salta en silencio es una prueba
 * que no existe.
 *
 *     npm run test:cda-esquema
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { buildCdaXml } from "../cda";

const CDA_XSD = path.join(__dirname, "xsd", "cda-r2", "infrastructure", "cda", "CDA.xsd");

// Lee el XML por stdin y devuelve un error por línea: "<línea>: <mensaje>".
const VALIDADOR_PY = `
import sys
from lxml import etree
schema = etree.XMLSchema(etree.parse(sys.argv[1]))
doc = etree.fromstring(sys.stdin.buffer.read(), etree.XMLParser(resolve_entities=False, no_network=True))
schema.validate(doc)
for e in schema.error_log:
    print("%d: %s" % (e.line, e.message))
`;

function erroresDeEsquema(xml: string): string[] {
  const r = spawnSync("python3", ["-c", VALIDADOR_PY, CDA_XSD], { input: xml, encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error(
      "No se pudo validar contra el XSD de CDA R2 (hace falta python3 con lxml: " +
        "`apt install python3-lxml` o `pip install lxml`).\n" +
        (r.error?.message ?? r.stderr),
    );
  }
  return r.stdout.split("\n").filter(Boolean);
}

type Input = Parameters<typeof buildCdaXml>[0];

function expediente(): Input {
  return {
    documentId: "cda-pat_1-1789061334690",
    effectiveTime: new Date("2026-09-10T17:28:54Z"),
    clinic: {
      id: "clinic_1", name: "Clínica Dental Menta", clues: "DFSSA000001",
      address: "Av. Reforma 1, CDMX", phone: "5555555555",
    },
    patient: {
      id: "pat_1", firstName: "Laura", lastName: "Menéndez",
      dob: new Date("1988-03-04T00:00:00Z"), gender: "F",
      curp: "MELA880304MDFNRR03", passportNo: null,
      address: "Av. Insurgentes Sur 1234, Col. Del Valle, CDMX",
      familyHistory: "Madre con diabetes tipo 2.",
      personalNonPathologicalHistory: "No fuma.",
      chronicConditions: ["Hipertensión"], allergies: ["Penicilina"], currentMedications: ["Losartán"],
    },
    doctor: { id: "usr_1", firstName: "Ana", lastName: "Ruiz", cedulaProfesional: "12345678", especialidad: "Odontología" },
    records: [
      {
        id: "mr_1", visitDate: new Date("2026-09-01T15:00:00Z"),
        subjective: "Dolor en pieza 26 al masticar <frío> & calor", objective: "Caries oclusal profunda",
        assessment: "Pulpitis reversible", plan: "Resina compuesta",
        diagnoses: [
          { code: "K02.1", description: "Caries de la dentina" },
          { code: "K04.0", description: "Pulpitis" },
        ],
      },
      {
        id: "mr_2", visitDate: new Date("2026-08-01T15:00:00Z"),
        subjective: null, objective: null, assessment: null, plan: null,
        diagnoses: [{ code: "K05.1", description: "Gingivitis crónica" }],
      },
      {
        id: "mr_3", visitDate: new Date("2026-07-01T15:00:00Z"),
        subjective: "Revisión", objective: null, assessment: null, plan: null, diagnoses: [],
      },
    ],
    prescriptions: [
      {
        id: "rx_1", issuedAt: new Date("2026-09-01T15:00:00Z"),
        items: [
          { cumsKey: "010.000.0104.00", descripcion: "Amoxicilina 500 mg", dosage: "1 cápsula cada 8 h por 7 días" },
          { cumsKey: "010.000.3407.00", descripcion: "Naproxeno 250 mg", dosage: "1 tableta cada 12 h" },
        ],
      },
    ],
  };
}

// Cada rama del generador que cambia QUÉ elementos salen.
const CASOS: Array<[string, (i: Input) => void]> = [
  ["expediente completo (CURP, cédula, especialidad, CLUES, diagnósticos, recetas)", () => {}],
  ["paciente con pasaporte y sin CURP", (i) => { i.patient.curp = null; i.patient.passportNo = "G12345678"; }],
  ["paciente sin CURP ni pasaporte, sin fecha de nacimiento, sin domicilio, género OTHER", (i) => {
    i.patient.curp = null; i.patient.passportNo = null; i.patient.dob = null;
    i.patient.address = null; i.patient.gender = "OTHER";
  }],
  ["médico sin cédula ni especialidad; clínica sin CLUES, teléfono ni domicilio", (i) => {
    i.doctor.cedulaProfesional = null; i.doctor.especialidad = null;
    i.clinic.clues = null; i.clinic.phone = null; i.clinic.address = null;
  }],
  ["expediente vacío: sin antecedentes, notas ni recetas", (i) => {
    i.records = []; i.prescriptions = [];
    i.patient.familyHistory = null; i.patient.personalNonPathologicalHistory = null;
    i.patient.chronicConditions = []; i.patient.allergies = []; i.patient.currentMedications = [];
  }],
];

for (const [nombre, ajusta] of CASOS) {
  test(`CDA R2 · valida contra el XSD oficial — ${nombre}`, () => {
    const input = expediente();
    ajusta(input);
    const errores = erroresDeEsquema(buildCdaXml(input));
    assert.deepEqual(errores, [], `El CDA no valida contra el XSD de CDA R2:\n  ${errores.join("\n  ")}`);
  });
}

test("CDA R2 · el validador de verdad rechaza un CDA roto (la prueba no pasa en vacío)", () => {
  const roto = buildCdaXml(expediente())
    .replace(/<observation classCode="OBS" moodCode="EVN">\s*<code [^>]*\/>/, '<observation classCode="OBS" moodCode="EVN">');
  const errores = erroresDeEsquema(roto);
  assert.ok(
    errores.some((e) => e.includes("{urn:hl7-org:v3}value") && e.includes("not expected")),
    `se esperaba que el XSD rechazara la <observation> sin <code>; salió: ${JSON.stringify(errores)}`,
  );
});

// Publicados por la DGIS en «OID'S Registrados → Identificadores y Catálogos de
// Ámbito Nacional». Si alguien los cambia, esta prueba tiene que saltar.
const OID_CURP = "2.16.840.1.113883.4.629";
const OID_CLUES = "2.16.840.1.113883.4.631";
const OID_CEDULA = "2.16.840.1.113883.3.215.12.18";

function ids(xml: string): string[] {
  return xml.match(/<id [^>]*\/>/g) ?? [];
}

test("CDA R2 · CURP, cédula y CLUES viajan bajo los OIDs oficiales de la DGIS", () => {
  const xml = buildCdaXml(expediente());
  assert.ok(xml.includes(`<id root="${OID_CURP}" extension="MELA880304MDFNRR03"/>`), "CURP sin su OID oficial");
  assert.ok(xml.includes(`<id root="${OID_CEDULA}" extension="12345678"/>`), "cédula sin su OID oficial");
  assert.ok(xml.includes(`<id root="${OID_CLUES}" extension="DFSSA000001"/>`), "CLUES sin su OID oficial");
});

test("CDA R2 · un id interno NUNCA sale bajo el OID de CURP, cédula o CLUES", () => {
  const input = expediente();
  input.patient.curp = null; input.patient.passportNo = "G12345678";
  input.doctor.cedulaProfesional = null;
  input.clinic.clues = null;
  const todos = ids(buildCdaXml(input)).join("\n");
  for (const oficial of [OID_CURP, OID_CEDULA, OID_CLUES, "2.16.840.1.113883.4.330.484"]) {
    assert.ok(!todos.includes(oficial), `sin el dato nacional no puede salir ${oficial}:\n${todos}`);
  }
  // Los datos siguen viajando, bajo una raíz que no finge ser oficial.
  assert.match(todos, /extension="G12345678" assigningAuthorityName="Pasaporte \(país emisor no registrado\)"/);
  assert.match(todos, /extension="usr_1" assigningAuthorityName="DaleControl \(usuario\)"/);
  assert.match(todos, /extension="clinic_1" assigningAuthorityName="DaleControl \(clínica\)"/);
});

test("CDA R2 · el contenido clínico viaja entero: mismos datos, bien envueltos", () => {
  const xml = buildCdaXml(expediente());
  for (const dato of [
    "MELA880304MDFNRR03", "Laura", "Menéndez", 'code="F"', 'value="19880304"',
    "Av. Insurgentes Sur 1234, Col. Del Valle, CDMX",
    'extension="12345678"', "Ana", "Ruiz", "<originalText>Odontología</originalText>",
    'extension="DFSSA000001"', "Clínica Dental Menta", 'value="tel:5555555555"', "Av. Reforma 1, CDMX",
    "Heredofamiliares: Madre con diabetes tipo 2.", "Alergias: Penicilina",
    "Padecimiento: Dolor en pieza 26 al masticar &lt;frío&gt; &amp; calor",
    'code="K02.1"', "Caries de la dentina", 'code="K04.0"', 'code="K05.1"',
    'code="010.000.0104.00"', "Amoxicilina 500 mg", "1 cápsula cada 8 h por 7 días",
  ]) {
    assert.ok(xml.includes(dato), `falta en el CDA: ${dato}`);
  }
});
