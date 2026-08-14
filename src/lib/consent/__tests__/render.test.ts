/**
 * Lector de la carta de consentimiento (texto plano → secciones).
 *
 * Lo que se prueba aquí NO es cosmético: el modal del panel y la página pública
 * del paciente pintan la carta con este parser. Si se traga una sección, el
 * paciente firma un documento del que no vio una parte.
 *
 * Run: npm run test:consent-render
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConsentText, splitConsentBody } from "../render";
import { buildConsentContent, GENERAL_CONSENT_KEY } from "../templates";

const VARS = {
  clinicName: "Clínica Demo",
  clinicAddress: "Av. Reforma 100",
  clinicCity: "Ciudad de México",
  patientName: "Ana López",
  patientAge: 34,
  patientNumber: "P-0042",
  doctorName: "Dra. Marta Ruiz",
  doctorLicense: "1234567",
};

test("la carta generada se parte en las 12 secciones de la NOM, en orden", () => {
  const doc = parseConsentText(buildConsentContent("extraccion-simple", VARS));

  assert.equal(doc.title, "CARTA DE CONSENTIMIENTO INFORMADO");
  assert.equal(doc.sections.length, 12);
  assert.deepEqual(
    doc.sections.map((s) => s.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(doc.sections[0]!.title, "DATOS DEL PACIENTE");
  assert.equal(doc.sections[11]!.title, "FIRMAS");
});

test("el establecimiento y la fecha quedan en el preámbulo, no en una sección", () => {
  const doc = parseConsentText(buildConsentContent(GENERAL_CONSENT_KEY, VARS));
  assert.match(doc.preamble, /^Establecimiento: Clínica Demo/);
  assert.match(doc.preamble, /Lugar y fecha:/);
  assert.ok(!doc.sections.some((s) => s.title.includes("Establecimiento")));
});

test("nada del texto original se pierde por el camino", () => {
  const content = buildConsentContent("endodoncia", VARS);
  const doc = parseConsentText(content);
  const rebuilt = [
    doc.title,
    doc.preamble,
    ...doc.sections.map((s) => `${s.number}. ${s.title}\n${s.body}`),
  ].join("\n");
  // Mismo contenido, distinto reparto de líneas en blanco.
  const strip = (s: string) => s.replace(/\s+/g, " ").trim();
  assert.equal(strip(rebuilt), strip(content));
});

test("edad y expediente viajan en la sección 1", () => {
  const doc = parseConsentText(buildConsentContent("resina", VARS));
  const datos = doc.sections[0]!.body;
  assert.match(datos, /Nombre del paciente: Ana López/);
  assert.match(datos, /Edad: 34 años/);
  assert.match(datos, /Número de expediente: P-0042/);
});

test("sin fecha de nacimiento ni folio la línea sale con hueco, nunca 'undefined'", () => {
  const doc = parseConsentText(
    buildConsentContent("resina", { ...VARS, patientAge: null, patientNumber: null }),
  );
  const datos = doc.sections[0]!.body;
  assert.match(datos, /Edad: ______/);
  assert.match(datos, /Número de expediente: ______/);
  assert.ok(!/undefined/.test(datos));
});

test("una lista numerada que el profesional escriba dentro del cuerpo NO parte la carta", () => {
  const doc = parseConsentText(
    [
      "CARTA DE CONSENTIMIENTO INFORMADO",
      "",
      "1. DATOS DEL PACIENTE",
      "Nombre del paciente: Ana López",
      "",
      "2. INDICACIONES",
      "Después del procedimiento:",
      "1. Tomar el analgésico cada 8 horas.",
      "2. No enjuagarse con fuerza durante 24 horas.",
    ].join("\n"),
  );
  assert.equal(doc.sections.length, 2);
  assert.match(doc.sections[1]!.body, /1\. Tomar el analgésico cada 8 horas\./);
  assert.match(doc.sections[1]!.body, /2\. No enjuagarse con fuerza durante 24 horas\./);
});

test("un texto libre sin encabezados no se pierde: sale íntegro en el preámbulo", () => {
  const libre = "Autorizo la toma de fotografías clínicas\ncon fines de seguimiento.";
  const doc = parseConsentText(libre);
  assert.equal(doc.sections.length, 0);
  assert.equal(`${doc.title ? doc.title + "\n" : ""}${doc.preamble}`, libre);
});

test("splitConsentBody separa viñetas de párrafos y respeta los renglones", () => {
  const blocks = splitConsentBody(
    ["Se me explicó que pueden presentarse:", "• Dolor pasajero.", "• Sangrado leve."].join("\n"),
  );
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.kind, "paragraph");
  assert.deepEqual(blocks[1]!.lines, ["Dolor pasajero.", "Sangrado leve."]);
  assert.equal(blocks[1]!.kind, "bullets");
});

test("los renglones etiquetados de la sección 1 NO se concatenan en un párrafo", () => {
  const blocks = splitConsentBody("Nombre del paciente: Ana López\nEdad: 34 años");
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0]!.lines, ["Nombre del paciente: Ana López", "Edad: 34 años"]);
});

test("texto vacío o basura no revienta el parser", () => {
  assert.deepEqual(parseConsentText(""), { title: "", preamble: "", sections: [] });
  assert.deepEqual(parseConsentText("\n\n  \n"), { title: "", preamble: "", sections: [] });
});
