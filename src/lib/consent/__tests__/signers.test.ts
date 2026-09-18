/**
 * Quién firma la carta: menores de edad y bloque de firmas del PDF.
 *
 * Lo que se prueba aquí es lo que vale si un día hay una reclamación: que la
 * carta de un menor no se cree sin tutor, y que la copia impresa para firmar
 * a mano traiga las líneas de testigos que la NOM-004 (10.1.1.7) pide.
 *
 * Run: npm run test:consent-signers
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageYears,
  buildSignatureBlocks,
  isMinor,
  minorSignerError,
  type SignatureBlocksInput,
} from "../signers";

// Todas las fechas a mediodía UTC: así caen en el mismo día calendario en
// cualquier zona horaria del runtime (Vercel es UTC; este servidor no tiene por
// qué serlo) y el borde del cumpleaños se prueba de verdad y no por casualidad.
const NOW = new Date("2026-09-18T12:00:00Z");

test("ageYears: años cumplidos, y null sin dato o con fecha inválida", () => {
  assert.equal(ageYears("2010-09-18T12:00:00Z", NOW), 16); // cumple hoy
  assert.equal(ageYears("2010-09-19T12:00:00Z", NOW), 15); // cumple mañana
  assert.equal(ageYears(new Date("1990-01-01T12:00:00Z"), NOW), 36);
  assert.equal(ageYears(null, NOW), null);
  assert.equal(ageYears(undefined, NOW), null);
  assert.equal(ageYears("no-es-fecha", NOW), null);
  assert.equal(ageYears("2030-01-01", NOW), null); // nacido en el futuro: dato roto
});

test("isMinor: menor de 18; sin fecha no se afirma", () => {
  assert.equal(isMinor("2012-05-05T12:00:00Z", NOW), true);
  assert.equal(isMinor("2008-09-18T12:00:00Z", NOW), false); // cumple 18 hoy
  assert.equal(isMinor("2008-09-19T12:00:00Z", NOW), true);  // cumple 18 mañana
  assert.equal(isMinor(null, NOW), false);
});

test("minorSignerError: un menor sin representante no pasa; con él sí", () => {
  const err = minorSignerError("2015-03-10", "", NOW);
  assert.ok(err, "debe rechazar");
  assert.match(err!, /11 años/);
  assert.match(err!, /madre, padre o tutor/);
  assert.equal(minorSignerError("2015-03-10", "  ", NOW) !== null, true);
  assert.equal(minorSignerError("2015-03-10", "María Pérez", NOW), null);
  assert.equal(minorSignerError("1980-03-10", "", NOW), null);
  assert.equal(minorSignerError(null, "", NOW), null);
  // Singular: "1 año", no "1 años".
  assert.match(minorSignerError("2025-01-01", "", NOW)!, /1 año:/);
});

const BASE: SignatureBlocksInput = {
  patientName: "Ana López",
  signerName: null,
  signerRelation: null,
  doctorName: "Dra. Marta Ruiz",
  signedAt: null,
  doctorSignedAt: null,
  witness1Name: null,
  witness1SignedAt: null,
  witness2Name: null,
  witness2SignedAt: null,
  patientSig: null,
  doctorSig: null,
  witness1Sig: null,
  witness2Sig: null,
};

test("carta SIN firmar (impresa para el papel): paciente, doctor y DOS testigos en blanco", () => {
  const blocks = buildSignatureBlocks(BASE);
  assert.deepEqual(
    blocks.map((b) => b.role),
    ["Paciente", "Estomatólogo responsable", "Testigo 1", "Testigo 2"],
  );
  assert.equal(blocks[0]!.name, "Ana López");
  assert.equal(blocks[1]!.name, "Dra. Marta Ruiz");
  for (const b of blocks) {
    assert.equal(b.dataUrl, null);
    assert.equal(b.signedAt, null);
  }
});

test("carta SIN firmar de un menor: firma el representante, no el niño", () => {
  const blocks = buildSignatureBlocks({ ...BASE, signerName: "Luis López", signerRelation: "padre" });
  assert.equal(blocks[0]!.role, "Representante legal");
  assert.equal(blocks[0]!.name, "Luis López (padre)");
  assert.equal(blocks.filter((b) => b.role === "Paciente").length, 0);
  assert.equal(blocks.length, 4); // sigue llevando los dos testigos en blanco
});

test("carta FIRMADA a distancia: sin testigos no hay líneas de testigo", () => {
  const signedAt = new Date("2026-09-18T15:30:00Z");
  const blocks = buildSignatureBlocks({ ...BASE, signedAt, patientSig: "data:image/png;base64,AAAA" });
  assert.deepEqual(blocks.map((b) => b.role), ["Paciente", "Estomatólogo responsable"]);
  assert.equal(blocks[0]!.signedAt, signedAt.toISOString());
  assert.equal(blocks[0]!.dataUrl, "data:image/png;base64,AAAA");
});

test("carta FIRMADA en tableta con un testigo: solo ese testigo", () => {
  const signedAt = new Date("2026-09-18T15:30:00Z");
  const w1 = new Date("2026-09-18T15:32:00Z");
  const blocks = buildSignatureBlocks({
    ...BASE,
    signedAt,
    patientSig: "data:image/png;base64,AAAA",
    doctorSignedAt: new Date("2026-09-18T16:00:00Z"),
    doctorSig: "data:image/png;base64,BBBB",
    witness1Name: "Pedro Gómez",
    witness1SignedAt: w1,
    witness1Sig: "data:image/png;base64,CCCC",
  });
  assert.deepEqual(blocks.map((b) => b.role), ["Paciente", "Estomatólogo responsable", "Testigo 1"]);
  assert.equal(blocks[2]!.name, "Pedro Gómez");
  assert.equal(blocks[2]!.signedAt, w1.toISOString());
});
