// ws1-t10, punto 12 — el caso de ortodoncia en el expediente PDF (decisión 3 y 4 del gerente).
// Correr: npm run test:orto-expediente
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { armarCasoDeOrtodoncia } from "../expediente-ortodoncia";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const plan = {
  technique: "CLEAR_ALIGNERS", status: "ON_HOLD", startDate: new Date("2026-07-20T12:00:00Z"), installedAt: null,
  estimatedDurationMonths: 12, droppedOutReason: "no debe salir si no abandonó",
  treatingDoctor: { firstName: "Mariana", lastName: "Cortés" },
  diagnosis: { diagnosedAt: new Date("2026-07-10T12:00:00Z"), angleClassRight: "CLASS_III", angleClassLeft: "ASYMMETRIC", overbiteMm: "3.5", overjetMm: 2, clinicalSummary: "  Mordida cruzada.  " },
};

test("etiquetas legibles y números de los Decimal de Prisma", () => {
  const c = armarCasoDeOrtodoncia(plan, []);
  assert.equal(c.tecnica, "Alineadores transparentes");
  assert.equal(c.estado, "Pausado");
  assert.equal(c.doctor, "Dr/a. Mariana Cortés");
  assert.equal(c.claseAngleDerecha, "Clase III");
  assert.equal(c.claseAngleIzquierda, "Asimétrica");
  assert.equal(c.overbiteMm, 3.5);
  assert.equal(c.resumenClinico, "Mordida cruzada.");
  assert.equal(c.colocacion, null);
});

test("el motivo de abandono solo sale si el caso abandonó", () => {
  assert.equal(armarCasoDeOrtodoncia(plan, []).motivoDeAbandono, null);
  assert.equal(armarCasoDeOrtodoncia({ ...plan, status: "DROPPED_OUT" }, []).motivoDeAbandono, "no debe salir si no abandonó");
});

test("las hojas salen de la más vieja a la más nueva, con su fase y mes", () => {
  const c = armarCasoDeOrtodoncia(plan, [
    { cardNumber: 2, visitDate: "2026-09-20T12:00:00Z", phaseKey: "LEVELING", monthAt: "2.0", soapP: "Segundo", signedAt: "2026-09-20T13:00:00Z" },
    { cardNumber: 1, visitDate: "2026-08-20T12:00:00Z", phaseKey: "ALIGNMENT", monthAt: 1, soapP: "Primero", indications: "Cera", signedAt: null },
  ]);
  assert.deepEqual(c.hojas.map((h) => h.numero), [1, 2]);
  assert.equal(c.hojas[0].fase, "Alineación");
  assert.equal(c.hojas[1].mes, 2);
  assert.equal(c.hojas[0].indicaciones, "Cera");
  assert.equal(c.hojas[1].indicaciones, null);
});

test("sin diagnóstico el caso no revienta", () => {
  const c = armarCasoDeOrtodoncia({ ...plan, diagnosis: null }, []);
  assert.equal(c.claseAngleDerecha, null);
  assert.equal(c.overjetMm, null);
});

test("la ruta lee solo hojas FIRMADAS, con la clínica de la sesión, y lo pasa al documento", () => {
  const db = leer("lib/orthodontics/expediente-ortodoncia-db.ts");
  assert.match(db, /if \(!clinicId \|\| !patientId\) return \[\];/);
  assert.match(db, /where: \{ clinicId, patientId, deletedAt: null \}/);
  assert.match(db, /status: "SIGNED", deletedAt: null/);
  const ruta = leer("app/api/patients/[id]/expediente-pdf/route.tsx");
  assert.match(ruta, /leerOrtodonciaDelExpediente\(user\.clinicId, paciente\.id\)/);
  assert.match(ruta, /ortodoncia,/);
});
