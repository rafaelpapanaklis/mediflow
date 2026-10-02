/**
 * ws1-t9 (revisión en panel.108, fallo 8): «P0166_Rx lateral.jpg» salía «Sin
 * emparejar» porque el «ID» de la ayuda era solo el del sistema de origen; el
 * folio visible de la ficha (`patientNumber`) no se miraba.
 * Run: npx tsx --test src/lib/uploads/__tests__/emparejar-folio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatosDeEmparejamiento, emparejarPorFolio } from "../patient-bulk-file-upload";

const folios = new Map([["P0166", "pac-166"], ["P0155", "pac-155"]]);

test("«P0166_Rx lateral.jpg» empareja con el paciente P0166", () => {
  const r = emparejarPorFolio(candidatosDeEmparejamiento("P0166_Rx lateral.jpg"), folios);
  assert.deepEqual(r, { patientId: "pac-166", candidate: "P0166" });
});

test("sin importar mayúsculas ni espacios; también como nombre de carpeta", () => {
  assert.equal(emparejarPorFolio(candidatosDeEmparejamiento("rx.jpg", " p0155 "), folios)?.patientId, "pac-155");
  assert.equal(emparejarPorFolio(candidatosDeEmparejamiento("p0166 - rx.jpg"), folios)?.patientId, "pac-166");
});

test("un folio que no existe (o no es visible para quien importa) no empareja", () => {
  assert.equal(emparejarPorFolio(candidatosDeEmparejamiento("P0999_rx.jpg"), folios), null);
  assert.equal(emparejarPorFolio(candidatosDeEmparejamiento("Juan Pérez.jpg"), folios), null);
});
