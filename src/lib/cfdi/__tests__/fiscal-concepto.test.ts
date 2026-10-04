/**
 * Clave SAT e IVA de cada concepto del CFDI (ws1-t4, vuelta 2: F-11 y F-08). Puras, con números.
 *
 * Run: npm run test:cfdi-conceptos
 *
 * Claves del catálogo oficial del SAT (catCFDI_V_4_20261001.xls): 85122001 odontólogos,
 * 85122002 higienistas, 85122004 cirujanos orales, 85122005 ortodoncia.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claveSatPorDefecto, resolverConcepto, hayIvaMixto, esClaveSat, normalizarNombre,
  CLAVES_SAT_DENTALES, type ProcedimientoFiscal,
} from "../fiscal-concepto";
import { leerFiscalDeEntrada } from "../fiscal-concepto.server";

test("F-11 · clave por defecto: ortodoncia 85122005, cirugía/implantes 85122004, lo demás 85122001 (nunca 85121502)", () => {
  assert.equal(claveSatPorDefecto({ category: "orthodontics", name: "Control de ortodoncia" }), "85122005");
  assert.equal(claveSatPorDefecto({ category: "Ortodoncia", name: "Brackets" }), "85122005");
  assert.equal(claveSatPorDefecto({ category: "Implantología", name: "Implante de titanio" }), "85122004");
  assert.equal(claveSatPorDefecto({ category: "Cirugía", name: "Tercer molar" }), "85122004");
  assert.equal(claveSatPorDefecto({ category: "dental", name: "Cirugía de terceros molares" }), "85122004");
  assert.equal(claveSatPorDefecto({ category: "Operatoria", name: "Restauración con resina" }), "85122001");
  assert.equal(claveSatPorDefecto({ category: "Prevención", name: "Limpieza dental (profilaxis)" }), "85122001", "higienista solo si la clínica lo elige");
  assert.equal(claveSatPorDefecto({}), "85122001");
});

test("F-11 · el caso real F2 de BEVADENT: «Control de ortodoncia» → 85122005 y «Restauración con resina» → 85122001", () => {
  const catalogo: ProcedimientoFiscal[] = [
    { name: "Control de ortodoncia", category: "orthodontics", claveSat: null, ivaCfdi: null },
    { name: "Restauración con resina", category: "Operatoria", claveSat: null, ivaCfdi: null },
  ];
  const a = resolverConcepto({ description: "Control de ortodoncia" }, catalogo, "exento");
  const b = resolverConcepto({ description: "RESTAURACION  con resina" }, catalogo, "exento");
  assert.deepEqual([a.claveSat, b.claveSat], ["85122005", "85122001"]);
  assert.deepEqual([a.ivaModo, b.ivaModo], ["exento", "exento"]);
});

test("F-11 · la clave del procedimiento manda (p. ej. higienista elegida a mano); la del renglón, más todavía", () => {
  const catalogo: ProcedimientoFiscal[] = [{ name: "Limpieza", category: "Prevención", claveSat: "85122002", ivaCfdi: null }];
  assert.equal(resolverConcepto({ description: "Limpieza" }, catalogo, "exento").claveSat, "85122002");
  assert.equal(resolverConcepto({ description: "Limpieza", claveSat: "85122003" }, catalogo, "exento").claveSat, "85122003");
  // Una clave del renglón mal formada no se manda: «No se encontró la clave de producto».
  assert.equal(resolverConcepto({ description: "Limpieza", claveSat: "123" }, catalogo, "exento").claveSat, "85122002");
  // Sin procedimiento que coincida: la de su nombre.
  assert.equal(resolverConcepto({ description: "Tratamiento de ortodoncia (brackets)" }, [], "exento").claveSat, "85122005");
});

test("F-08 · el IVA de cada concepto: renglón > procedimiento > factura", () => {
  const catalogo: ProcedimientoFiscal[] = [
    { name: "Limpieza", category: "Prevención", claveSat: null, ivaCfdi: "exento" },
    { name: "Cepillo eléctrico", category: "general", claveSat: null, ivaCfdi: "iva16" },
    { name: "Consulta", category: "general", claveSat: null, ivaCfdi: null },
  ];
  assert.equal(resolverConcepto({ description: "Limpieza" }, catalogo, "iva16").ivaModo, "exento");
  assert.equal(resolverConcepto({ description: "Cepillo eléctrico" }, catalogo, "exento").ivaModo, "iva16");
  assert.equal(resolverConcepto({ description: "Consulta" }, catalogo, "exento").ivaModo, "exento", "sin dato, el de la factura");
  assert.equal(resolverConcepto({ description: "Consulta", ivaModo: "iva16" }, catalogo, "exento").ivaModo, "iva16");
  assert.equal(hayIvaMixto([{ ivaModo: "exento" }, { ivaModo: "iva16" }]), true);
  assert.equal(hayIvaMixto([{ ivaModo: "exento" }, { ivaModo: "exento" }]), false);
});

test("F-11 · la lista ofrecida trae las 5 claves dentales verificadas y ninguna inventada", () => {
  assert.deepEqual(CLAVES_SAT_DENTALES.map((c) => c.clave), ["85122001", "85122005", "85122004", "85122002", "85122003"]);
  assert.ok(CLAVES_SAT_DENTALES.every((c) => esClaveSat(c.clave)));
  assert.equal(normalizarNombre("  Restauración   CON Resina "), "restauracion con resina");
});

test("F-11 / F-08 · lo que manda el formulario de Procedimientos", () => {
  assert.deepEqual(leerFiscalDeEntrada({ claveSat: "85122005", ivaCfdi: "exento" }), { ok: true, datos: { claveSat: "85122005", ivaCfdi: "exento" } });
  assert.deepEqual(leerFiscalDeEntrada({ claveSat: "", ivaCfdi: null }), { ok: true, datos: { claveSat: null, ivaCfdi: null } });
  assert.deepEqual(leerFiscalDeEntrada({}), { ok: true, datos: {} });
  assert.equal(leerFiscalDeEntrada({ claveSat: "8512200" }).ok, false);
  assert.equal(leerFiscalDeEntrada({ ivaCfdi: "exempt" }).ok, false);
});
