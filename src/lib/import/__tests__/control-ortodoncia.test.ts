/**
 * ws1-t10 — el puente «caso + día» entre las hojas de control de 06 y las citas de 05.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/control-ortodoncia.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const A = "cli_A";
const B = "cli_B";

let base: Base = crearBase({ importExternalIds: [] });
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });

const modulo = () => import("../dentalink/control-ortodoncia");

test("claveControlCaso: «# Tratamiento|AAAA-MM-DD», sin «.0» de Excel, y null si falta algo", async () => {
  const { claveControlCaso } = await modulo();
  assert.equal(claveControlCaso("291", "2026-03-04"), "291|2026-03-04");
  assert.equal(claveControlCaso(291, "2026-03-04"), "291|2026-03-04");
  assert.equal(claveControlCaso("291.0", "2026-03-04"), "291|2026-03-04");
  assert.equal(claveControlCaso("", "2026-03-04"), null);
  assert.equal(claveControlCaso(undefined, "2026-03-04"), null);
  assert.equal(claveControlCaso("291", "04/03/2026"), null);
  assert.equal(claveControlCaso("291", ""), null);
});

test("diaLocal: el día en la zona de la clínica, no en UTC", async () => {
  const { diaLocal } = await modulo();
  // 02:30 UTC del 5 de octubre = 20:30 del 4 de octubre en Ciudad de México.
  const d = new Date("2026-10-05T02:30:00Z");
  assert.equal(diaLocal(d, "America/Mexico_City"), "2026-10-04");
  assert.equal(diaLocal(d, "UTC"), "2026-10-05");
});

test("controles: quien llega segundo encuentra la marca del primero; no se mezclan clínicas ni sistemas", async () => {
  base = crearBase({ importExternalIds: [] });
  const { guardarControlesOrto, cargarControlesOrto, claveControlCaso } = await modulo();
  const k = claveControlCaso("16", "2026-02-10")!;

  // 06 deja la marca de su hoja…
  assert.equal(await guardarControlesOrto(A, "dentalink", [{ externalId: k, localId: "hoja1" }]), true);
  // …y 05 la ve; si intenta guardar la suya, la primera se respeta.
  const vistos = await cargarControlesOrto(A, "dentalink");
  assert.equal(vistos.mapa.get(k), "hoja1");
  await guardarControlesOrto(A, "dentalink", [{ externalId: k, localId: "cita9" }]);
  assert.equal((await cargarControlesOrto(A, "dentalink")).mapa.get(k), "hoja1");

  // Otra clínica u otro sistema de origen no ven nada.
  assert.equal((await cargarControlesOrto(B, "dentalink")).mapa.size, 0);
  assert.equal((await cargarControlesOrto(A, "otro")).mapa.size, 0);
  // Sin sistema de origen no hay IDs externos que valgan.
  assert.equal((await cargarControlesOrto(A, "")).mapa.size, 0);
});

test("casos: 'ortho_case' es otra entidad, no se pisa con los controles", async () => {
  base = crearBase({
    importExternalIds: [
      { id: "x1", clinicId: A, source: "dentalink", entity: "ortho_case", externalId: "16", localId: "plan1" },
    ],
  });
  const { cargarCasosOrto, cargarControlesOrto } = await modulo();
  assert.equal((await cargarCasosOrto(A, "dentalink")).mapa.get("16"), "plan1");
  assert.equal((await cargarControlesOrto(A, "dentalink")).mapa.size, 0);
});

test("sin la tabla import_external_ids: se avisa con disponible=false y no revienta", async () => {
  base = crearBase({ importExternalIds: [] });
  base.banderas.sinTablaExternos = true;
  const { cargarCasosOrto, guardarControlesOrto } = await modulo();
  const r = await cargarCasosOrto(A, "dentalink");
  assert.equal(r.disponible, false);
  assert.equal(r.mapa.size, 0);
  assert.equal(await guardarControlesOrto(A, "dentalink", [{ externalId: "16|2026-02-10", localId: "c" }]), false);
});
