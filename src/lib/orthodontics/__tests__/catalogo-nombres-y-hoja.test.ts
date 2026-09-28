// Ortodoncia — un solo nombre por cosa entre tipos de cita y procedimientos
// (fila 34) y lo que se anota dentro de la hoja deja de ser procedimiento
// ofrecido (fila 35). ws1-t4 ronda 6, decisiones del gerente.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ORTHO_PROCEDURES,
  HECHOS_DENTRO_DEL_CONTROL,
  ORTHO_CATALOG_CATEGORY,
  faltantesPorSembrar,
  seOfreceParaAgendar,
} from "../catalog-procedures";
import { DEFAULT_ORTHO_APPOINTMENT_TYPES } from "../clinic-settings-db";

const SEMBRADOS = DEFAULT_ORTHO_PROCEDURES.map((p) => p.name);

test("fila 34: lo que también es tipo de cita se llama igual en la siembra", () => {
  for (const nombre of [
    "Valoración de ortodoncia",
    "Toma de registros de ortodoncia",
    "Colocación de aparatología",
    "Urgencia de ortodoncia",
    "Retiro de aparatología",
  ]) {
    assert.ok(DEFAULT_ORTHO_APPOINTMENT_TYPES.some((t) => t.label === nombre), `tipo de cita «${nombre}»`);
    assert.ok(SEMBRADOS.includes(nombre), `procedimiento «${nombre}»`);
  }
  assert.ok(!SEMBRADOS.includes("Estudio de registros de ortodoncia"));
  assert.ok(!SEMBRADOS.includes("Urgencia de ortodoncia fuera de control"));
});

test("fila 35: Activación, Cambio de arco y Ajuste de aparatología ya no se siembran", () => {
  for (const nombre of HECHOS_DENTRO_DEL_CONTROL) {
    assert.ok(!SEMBRADOS.includes(nombre), nombre);
    assert.ok(!faltantesPorSembrar(new Set(), false).some((p) => p.name === nombre), nombre);
  }
  assert.deepEqual([...HECHOS_DENTRO_DEL_CONTROL].sort(), ["Activación", "Ajuste de aparatología", "Cambio de arco"]);
});

test("fila 35: no se ofrecen para agendar; lo demás sí (y otra categoría con ese nombre, también)", () => {
  assert.equal(seOfreceParaAgendar({ name: "Activación", category: ORTHO_CATALOG_CATEGORY }), false);
  assert.equal(seOfreceParaAgendar({ name: "Cambio de arco", category: ORTHO_CATALOG_CATEGORY }), false);
  assert.equal(seOfreceParaAgendar({ name: "Control de ortodoncia", category: ORTHO_CATALOG_CATEGORY }), true);
  assert.equal(seOfreceParaAgendar({ name: "Activación", category: "dental" }), true);
});

test("fila 35: el menú del bot excluye esos tres de ortodoncia sin borrarlos", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const bot = readFileSync(join(raiz, "lib/agenda/bot-booking-service.ts"), "utf8");
  const fn = bot.slice(bot.indexOf("export async function listBookableServices"), bot.indexOf("export async function listBookableDoctors"));
  assert.match(fn, /NOT: \{ category: ORTHO_CATALOG_CATEGORY, name: \{ in: \[\.\.\.HECHOS_DENTRO_DEL_CONTROL\] \} \}/);
  assert.match(fn, /findMany\(/);
  assert.doesNotMatch(fn, /delete|update/);
});
