// ws1-t10, decisión 2 de Rafael — precio por técnica en Configuración; el alta lo propone.
// Correr: npm run test:orto-precios-tecnica
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TECNICAS_ORTO, costoAProponer, normalizarPrecios, precioDeTecnica } from "../precios-por-tecnica";

const SRC = join(__dirname, "..", "..", "..");
const RAIZ = join(SRC, "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("las siete técnicas del módulo tienen fila en la tabla", () => {
  const schema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const enumTec = /enum OrthoTechnique \{([^}]*)\}/.exec(schema)![1].split(/\s+/).filter(Boolean);
  assert.deepEqual([...TECNICAS_ORTO.map((t) => t.key)].sort(), [...enumTec].sort());
});

test("normalizarPrecios: solo técnicas conocidas con precio positivo y finito, a centavos", () => {
  assert.deepEqual(
    normalizarPrecios({ METAL_BRACKETS: "25,000", CLEAR_ALIGNERS: 48000.556, HYBRID: 0, LINGUAL_BRACKETS: -5, RARA: 100, CERAMIC_BRACKETS: "abc", SELF_LIGATING_METAL: 99999999999 }),
    { METAL_BRACKETS: 25000, CLEAR_ALIGNERS: 48000.56 },
  );
  assert.deepEqual(normalizarPrecios(null), {});
  assert.deepEqual(normalizarPrecios([1, 2]), {});
});

test("precioDeTecnica: el de la tabla o null", () => {
  assert.equal(precioDeTecnica({ METAL_BRACKETS: 25000 }, "METAL_BRACKETS"), 25000);
  assert.equal(precioDeTecnica({ METAL_BRACKETS: 25000 }, "HYBRID"), null);
  assert.equal(precioDeTecnica(undefined, "HYBRID"), null);
});

test("costoAProponer: llena el campo vacío, sigue a la técnica mientras nadie lo toque, y no pisa lo tecleado", () => {
  const base = { hayPresupuesto: false };
  assert.equal(costoAProponer({ ...base, actual: "", ultimoSugerido: null, precio: 25000 }), "25000");
  // cambia de técnica: el campo aún trae lo sugerido → sigue al nuevo precio
  assert.equal(costoAProponer({ ...base, actual: "25000", ultimoSugerido: "25000", precio: 48000 }), "48000");
  // la nueva técnica no tiene precio: se retira lo que se había sugerido
  assert.equal(costoAProponer({ ...base, actual: "25000", ultimoSugerido: "25000", precio: null }), "");
  // el usuario tecleó otra cifra: no se toca
  assert.equal(costoAProponer({ ...base, actual: "31000", ultimoSugerido: "25000", precio: 48000 }), null);
  // sin precio y campo vacío: nada
  assert.equal(costoAProponer({ ...base, actual: "", ultimoSugerido: null, precio: null }), null);
  // mismo valor: nada que cambiar
  assert.equal(costoAProponer({ ...base, actual: "", ultimoSugerido: "25000", precio: 25000 }), "25000");
  // un presupuesto aceptado manda sobre la tabla
  assert.equal(costoAProponer({ actual: "", ultimoSugerido: null, precio: 25000, hayPresupuesto: true }), null);
});

test("el SQL es plano, idempotente y aditivo; y la columna NO está en schema.prisma", () => {
  const sql = readFileSync(join(RAIZ, "sql", "ortodoncia-precios-por-tecnica.sql"), "utf8");
  const lineas = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
  assert.equal(lineas.length, 1);
  assert.match(lineas[0], /^ALTER TABLE "orthodontics_clinic_settings" ADD COLUMN IF NOT EXISTS "techniquePrices" JSONB;$/);
  assert.doesNotMatch(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8"), /techniquePrices/);
});

test("guardar exige el permiso de Configuración y usa la clínica de la sesión; el alta y la pantalla lo leen", () => {
  const a = leer("app/actions/orthodontics/guardarPreciosPorTecnica.ts");
  assert.match(a, /getOrthoConfigActionContext\(\)/);
  assert.match(a, /guardarEnBase\(ctx\.clinicId, ctx\.userId, precios\)/);
  const db = leer("lib/orthodontics/precios-por-tecnica-db.ts");
  assert.match(db, /if \(!clinicId\) return \{\};/);
  assert.match(db, /WHERE "clinicId" = \$\{clinicId\}/);
  // ws1-t10 (técnicas propias): el alta lee la lista de la clínica, que se siembra con estos precios.
  assert.match(leer("app/actions/orthodontics/getCaseIntakeOptions.ts"), /leerTecnicasDeLaClinica\(ctx\.clinicId\)/);
  assert.match(leer("components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx"), /costoAProponer\(/);
  assert.match(leer("components/specialties/orthodontics/configuracion/OrthoConfiguracionClient.tsx"), /<TecnicasYPrecios iniciales=/);
  assert.match(leer("app/dashboard/orthodontics/configuracion/page.tsx"), /leerTecnicasDeLaClinica\(user\.clinicId\)/);
});
