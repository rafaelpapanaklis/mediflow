/**
 * El control de ortodoncia se reconoce por su LLAVE, no por su nombre — ws1-t5.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/catalogo-control-por-llave.test.ts
 *
 * Revisión de lógica de uso (fila 26 del mapa): si la clínica renombraba
 * «Control de ortodoncia» en Procedimientos, en modo «Pago por control» los
 * controles dejaban de facturarse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODIGO_CONTROL_ORTO,
  ORTHO_CATALOG_CATEGORY,
  debeMarcarseComoControl,
  elegirProcedimientoControl,
  faltantesPorSembrar,
  type FilaCandidataControl,
} from "../catalog-procedures";
import { TIPO_CITA_CONTROL_ORTO } from "../agenda-constants";

const fila = (p: Partial<FilaCandidataControl>): FilaCandidataControl => ({
  id: "p1",
  name: TIPO_CITA_CONTROL_ORTO,
  code: null,
  category: ORTHO_CATALOG_CATEGORY,
  basePrice: 300,
  isActive: true,
  ...p,
});

test("el control renombrado se sigue encontrando por su llave", () => {
  const renombrado = fila({ name: "Control mensual de brackets", code: CODIGO_CONTROL_ORTO, basePrice: 450 });
  const elegido = elegirProcedimientoControl([fila({ id: "otro", name: "Activación" }), renombrado]);
  assert.equal(elegido?.por, "llave");
  assert.equal(elegido?.fila.name, "Control mensual de brackets");
  assert.equal(elegido?.fila.basePrice, 450);
});

test("también si la clínica lo movió de categoría", () => {
  const movido = fila({ category: "general", code: CODIGO_CONTROL_ORTO });
  assert.equal(elegirProcedimientoControl([movido])?.fila.id, "p1");
});

test("datos anteriores a la llave: se encuentra por el nombre de siempre", () => {
  const elegido = elegirProcedimientoControl([fila({})]);
  assert.equal(elegido?.por, "nombre");
  // Por nombre solo vale dentro de la categoría de ortodoncia, como antes.
  assert.equal(elegirProcedimientoControl([fila({ category: "general" })]), null);
});

test("la llave gana al nombre: un «Control de ortodoncia» nuevo no le quita el sitio al de la clínica", () => {
  const elDeLaClinica = fila({ id: "viejo", name: "Ajuste mensual", code: CODIGO_CONTROL_ORTO, basePrice: 500 });
  const homonimo = fila({ id: "nuevo", basePrice: 300 });
  assert.equal(elegirProcedimientoControl([homonimo, elDeLaClinica])?.fila.id, "viejo");
});

test("un control desactivado no se factura, como hasta hoy", () => {
  assert.equal(elegirProcedimientoControl([fila({ isActive: false, code: CODIGO_CONTROL_ORTO })]), null);
  assert.equal(elegirProcedimientoControl([fila({ isActive: false })]), null);
  assert.equal(elegirProcedimientoControl([]), null);
});

test("otro procedimiento de ortodoncia nunca pasa por el control", () => {
  assert.equal(elegirProcedimientoControl([fila({ name: "Activación" }), fila({ name: "Retiro de aparatología" })]), null);
});

test("al editarlo se le pone la llave solo al control de siempre que aún no la lleva", () => {
  assert.equal(debeMarcarseComoControl(fila({})), true);
  assert.equal(debeMarcarseComoControl(fila({ code: CODIGO_CONTROL_ORTO })), false);
  assert.equal(debeMarcarseComoControl(fila({ code: "ODO_LIMPIEZA" })), false, "pisaría la llave del odontograma");
  assert.equal(debeMarcarseComoControl(fila({ name: "Activación" })), false);
  assert.equal(debeMarcarseComoControl(fila({ category: "dental" })), false);
});

test("sembrar no crea un segundo control si la clínica renombró el suyo", () => {
  const nombres = new Set(["Colocación de elásticos", "Ajuste mensual"]);
  const conControl = faltantesPorSembrar(nombres, true).map((p) => p.name);
  assert.ok(!conControl.includes(TIPO_CITA_CONTROL_ORTO));
  assert.ok(!conControl.includes("Colocación de elásticos"));
  assert.ok(conControl.includes("Retiro de aparatología"));
  const sinControl = faltantesPorSembrar(nombres, false).map((p) => p.name);
  assert.ok(sinControl.includes(TIPO_CITA_CONTROL_ORTO));
});

test("cableado: la búsqueda y el renombrado usan la llave, acotados a la clínica", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const lib = readFileSync(join(raiz, "lib/orthodontics/catalog-procedures.ts"), "utf8");
  const busqueda = /export async function buscarPrecioControlOrto[\s\S]*?\n}\n/.exec(lib)?.[0] ?? "";
  assert.match(busqueda, /\{ code: CODIGO_CONTROL_ORTO \}/);
  assert.match(busqueda, /where: \{\s*clinicId,/);
  assert.match(busqueda, /where: \{ id: elegido\.fila\.id, clinicId, code: null \}/, "la marca no va acotada a la clínica");
  assert.ok(!/findFirst\(\{\s*where: \{ clinicId, category: ORTHO_CATALOG_CATEGORY, name: TIPO_CITA_CONTROL_ORTO/.test(busqueda), "sigue buscando solo por nombre");

  const ruta = readFileSync(join(raiz, "app/api/procedures/[id]/route.ts"), "utf8");
  assert.match(ruta, /debeMarcarseComoControl\(existing\)/);
  assert.match(ruta, /where: \{ id: params\.id, clinicId: ctx\.clinicId \}/);
  // La llave nunca sale del body.
  const entrada = readFileSync(join(raiz, "app/api/procedures/entrada.ts"), "utf8");
  assert.ok(!/data\.code\s*=/.test(entrada), "el panel volvió a escribir `code`");
});
