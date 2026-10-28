/**
 * ws1-t10 · el catálogo ampliado para odontología y su SQL.
 *
 * Run: npm run test:recetas-catalogo
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUMS_ESSENTIALS } from "../cums-essentials";
import { CUMS_ODONTOLOGIA } from "../cums-odontologia";
import { sqlDelCatalogo } from "../cums-sql";
import { COFEPRIS_GROUPS } from "@/lib/clinical/cofepris";
import { detectarControlado } from "@/lib/clinical/controlados";

const BASE = CUMS_ESSENTIALS.filter((e) => !CUMS_ODONTOLOGIA.includes(e));

test("la ampliación entra al catálogo y las claves son únicas en todo el seed", () => {
  assert.ok(CUMS_ODONTOLOGIA.length >= 100, `solo ${CUMS_ODONTOLOGIA.length} nuevas`);
  assert.equal(CUMS_ESSENTIALS.length, BASE.length + CUMS_ODONTOLOGIA.length);
  const claves = CUMS_ESSENTIALS.map((e) => e.clave);
  assert.equal(new Set(claves).size, claves.length, "clave repetida");
  for (const e of CUMS_ODONTOLOGIA) {
    assert.match(e.clave, /^MX-0[56]\d\d$/, `${e.clave}: las nuevas van en MX-05xx/06xx`);
    assert.ok(e.clave.length <= 20 && e.descripcion.length <= 500 && e.presentacion.length <= 200, `${e.clave}: largo`);
  }
});

test("ninguna presentación nueva repite una que ya existía (descripción + presentación)", () => {
  const vistas = new Set(BASE.map((e) => `${e.descripcion}|${e.presentacion}`.toLowerCase()));
  for (const e of CUMS_ODONTOLOGIA) {
    const k = `${e.descripcion}|${e.presentacion}`.toLowerCase();
    assert.ok(!vistas.has(k), `${e.clave} repite «${e.descripcion} · ${e.presentacion}»`);
    vistas.add(k);
  }
});

test("lo que pidió Rafael está, en sus presentaciones", () => {
  const hay = (nombre: string, pres: RegExp) =>
    CUMS_ESSENTIALS.some((e) => e.descripcion.toLowerCase().startsWith(nombre) && pres.test(e.presentacion));
  assert.ok(hay("ibuprofeno", /^200 mg/)); assert.ok(hay("ibuprofeno", /^400 mg/));
  assert.ok(hay("ibuprofeno", /^600 mg/)); assert.ok(hay("ibuprofeno", /^800 mg/));
  assert.ok(hay("ibuprofeno", /suspensión/));
  assert.ok(hay("ketorolaco", /tabletas$/)); assert.ok(hay("ketorolaco", /sublingual/)); assert.ok(hay("ketorolaco", /inyectable/));
  for (const n of ["paracetamol", "naproxeno", "diclofenaco", "metamizol", "nimesulida", "celecoxib", "amoxicilina",
    "amoxicilina + ácido clavulánico", "clindamicina", "metronidazol", "azitromicina", "cefalexina", "dexametasona",
    "clorhexidina", "benzocaína", "aciclovir", "nistatina", "fluconazol"]) {
    assert.ok(CUMS_ESSENTIALS.some((e) => e.descripcion.toLowerCase().startsWith(n)), `falta ${n}`);
  }
  assert.ok(hay("amoxicilina", /^875 mg/)); assert.ok(hay("amoxicilina + ácido clavulánico", /^875\/125/));
  assert.ok(hay("amoxicilina suspensión", /./));
});

test("grupo COFEPRIS: siempre uno válido; los únicos controlados nuevos son los de tramadol (grupo III, LGS 15-ene-2026)", () => {
  for (const e of CUMS_ODONTOLOGIA) {
    assert.ok(e.cofeprisGroup && (COFEPRIS_GROUPS as readonly string[]).includes(e.cofeprisGroup), `${e.clave} sin grupo válido`);
    const controlado = detectarControlado(e.descripcion);
    if (/tramadol/i.test(e.descripcion)) {
      assert.equal(e.cofeprisGroup, "III", `${e.clave}: tramadol es grupo III`);
      assert.equal(controlado?.nombre, "Tramadol");
    } else {
      assert.ok(["IV", "V"].includes(e.cofeprisGroup!), `${e.clave} (${e.descripcion}): un nuevo no controlado va en IV o V`);
      assert.equal(controlado, null, `${e.clave} (${e.descripcion}): el candado no debería saltar`);
    }
  }
});

test("el candado y el catálogo dicen lo mismo: todo I/II/III del catálogo cae en el candado, y nada IV/V/VI cae", () => {
  for (const e of CUMS_ESSENTIALS) {
    const c = detectarControlado(e.descripcion);
    if (["I", "II", "III"].includes(e.cofeprisGroup ?? "")) {
      assert.ok(c, `${e.clave} «${e.descripcion}» es ${e.cofeprisGroup} y el candado no lo ve`);
    } else {
      assert.equal(c, null, `${e.clave} «${e.descripcion}» es ${e.cofeprisGroup} y el candado lo bloquea`);
    }
  }
});

test("los grupos terapéuticos nuevos usan los textos de siempre (y el único nuevo es Hemostáticos)", () => {
  const deBase = new Set(BASE.map((e) => e.grupoTerapeutico));
  for (const e of CUMS_ODONTOLOGIA) {
    assert.ok(deBase.has(e.grupoTerapeutico) || e.grupoTerapeutico === "Hemostáticos", `${e.clave}: grupo «${e.grupoTerapeutico}»`);
  }
});

test("sql/cums-odontologia-2026-10.sql está al día con el seed y es aditivo", () => {
  const archivo = readFileSync(join(__dirname, "..", "..", "..", "..", "sql", "cums-odontologia-2026-10.sql"), "utf8");
  const esperado = sqlDelCatalogo(CUMS_ESSENTIALS, "Catálogo de medicamentos (CUMS) · ampliación odontológica ws1-t10, 28-oct-2026");
  assert.equal(archivo, esperado, "regenera con `npm run cums:sql`");
  assert.ok(/ON CONFLICT \("clave"\) DO NOTHING;/.test(archivo));
  assert.ok(!/UPDATE|DELETE|DROP|ALTER/i.test(archivo), "solo INSERT");
  assert.equal((archivo.match(/^\s+\('MX-/gm) ?? []).length, CUMS_ESSENTIALS.length);
});

test("sqlDelCatalogo escapa las comillas", () => {
  const sql = sqlDelCatalogo([{ clave: "X", descripcion: "O'Neil", presentacion: "5 mg" }], "t");
  assert.ok(sql.includes("'O''Neil'"));
  assert.ok(sql.includes("NULL, NULL, NULL)"));
});
