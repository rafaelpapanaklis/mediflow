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

// ═══════════════════════════════════════════════════════════════════════════
// F-01 · retenciones (CONFIRMAR CON CONTADOR)
// ═══════════════════════════════════════════════════════════════════════════
import { tasasDeRetencion, totalesConRetenciones, conceptoConRetenciones, avisoDeRetencion } from "../retenciones";

test("F-01 · quién retiene: 626 → empresa 1.25%; 612 → empresa 10%; a personas físicas y genéricos, nada", () => {
  assert.deepEqual(tasasDeRetencion({ regimenEmisor: "626", rfcReceptor: "ABC010101AB1" }), { isr: 0.0125, ivaRetenido: 0.106667 });
  assert.deepEqual(tasasDeRetencion({ regimenEmisor: "612", rfcReceptor: "ABC010101AB1" }), { isr: 0.10, ivaRetenido: 0.106667 });
  assert.equal(tasasDeRetencion({ regimenEmisor: "626", rfcReceptor: "GOMA800101AB1" }), null);
  assert.equal(tasasDeRetencion({ regimenEmisor: "626", rfcReceptor: "XAXX010101000" }), null);
  assert.equal(tasasDeRetencion({ regimenEmisor: "601", rfcReceptor: "ABC010101AB1" }), null);
});

test("F-01 · 626 → empresa, tratamiento exento de $10,000: retiene $125.00 de ISR y paga $9,875.00", () => {
  const t = totalesConRetenciones([{ precio: 10000, cantidad: 1, descuento: 0, ivaModo: "exento", ivaIncluido: true }], { isr: 0.0125, ivaRetenido: 0.106667 });
  assert.deepEqual(t, { base: 10000, iva: 0, isrRetenido: 125, ivaRetenido: 0, bruto: 10000, neto: 9875 });
});

test("F-01 · 612 → empresa, exento de $10,000: ISR $1,000.00 → paga $9,000.00", () => {
  const t = totalesConRetenciones([{ precio: 10000, cantidad: 1, descuento: 0, ivaModo: "exento", ivaIncluido: true }], { isr: 0.10, ivaRetenido: 0.106667 });
  assert.equal(t.isrRetenido, 1000);
  assert.equal(t.neto, 9000);
});

test("F-01 · 612 → empresa, GRAVADO base $10,000: IVA $1,600.00, IVA retenido $1,066.67, ISR $1,000.00 → $9,533.33", () => {
  const tasas = { isr: 0.10, ivaRetenido: 0.106667 };
  const agregado = totalesConRetenciones([{ precio: 10000, cantidad: 1, descuento: 0, ivaModo: "iva16", ivaIncluido: false }], tasas);
  assert.deepEqual(agregado, { base: 10000, iva: 1600, isrRetenido: 1000, ivaRetenido: 1066.67, bruto: 11600, neto: 9533.33 });
  // El mismo servicio con el IVA incluido en el precio ($11,600) da lo mismo.
  const incluido = totalesConRetenciones([{ precio: 11600, cantidad: 1, descuento: 0, ivaModo: "iva16", ivaIncluido: true }], tasas);
  assert.deepEqual(incluido, agregado);
  const k = conceptoConRetenciones({ precio: 11600, cantidad: 1, descuento: 0, ivaModo: "iva16", ivaIncluido: true }, tasas);
  assert.equal(k.price, 10000);
  assert.deepEqual(k.taxes, [{ type: "IVA", rate: 0.16 }, { type: "ISR", rate: 0.10, withholding: true }, { type: "IVA", rate: 0.106667, withholding: true }]);
});

test("F-01 · el aviso dice cuánto retiene y cuánto paga", () => {
  const t = totalesConRetenciones([{ precio: 10000, cantidad: 1, descuento: 0, ivaModo: "exento", ivaIncluido: true }], { isr: 0.0125, ivaRetenido: 0.106667 });
  assert.equal(avisoDeRetencion(t), "La empresa retiene $125.00 (ISR $125.00) y paga $9,875.00.");
});

// ═══════════════════════════════════════════════════════════════════════════
// F-21 · mes de cobro   ·   F-24 · rechazos del PAC
// ═══════════════════════════════════════════════════════════════════════════
import { avisoMesDeCobro, explicarRechazoPac, mesEnZona } from "../avisos-timbrado";

test("F-21 · el mes se cuenta en la zona de la clínica: 30-sep 23:00 en CDMX es septiembre aunque en UTC ya sea octubre", () => {
  assert.equal(mesEnZona(new Date("2026-10-01T05:00:00Z"), "America/Mexico_City"), "2026-09");
  const ahora = new Date("2026-10-03T18:00:00Z");
  const a = avisoMesDeCobro({ pagos: [{ paidAt: "2026-10-01T05:00:00Z", amount: 400 }], ahora, timeZone: "America/Mexico_City" });
  assert.deepEqual(a?.mesesDeCobro, ["2026-09"]);
  assert.equal(a?.mensaje, "Esto se cobró en septiembre 2026, pero el CFDI sale con fecha de octubre 2026: el SAT verá el ingreso en octubre 2026. Revísalo con tu contador si afecta la declaración de ese mes.");
  // Mismo mes, o un reembolso de otro mes: nada que avisar.
  assert.equal(avisoMesDeCobro({ pagos: [{ paidAt: "2026-10-02T18:00:00Z", amount: 1600 }], ahora, timeZone: "America/Mexico_City" }), null);
  assert.equal(avisoMesDeCobro({ pagos: [{ paidAt: "2026-09-02T18:00:00Z", amount: 100, method: "refund" }, { paidAt: "2026-10-02T18:00:00Z", amount: 1600 }], ahora, timeZone: "America/Mexico_City" }), null);
});

test("F-24 · rechazos del PAC con qué revisar (el texto original se conserva)", () => {
  assert.match(explicarRechazoPac("El campo DomicilioFiscalReceptor no coincide"), /Revisa el código postal del paciente/);
  assert.match(explicarRechazoPac("El RegimenFiscalReceptor no es válido para el RFC"), /Revisa el régimen fiscal del paciente/);
  assert.match(explicarRechazoPac("La clave del campo UsoCFDI no aplica"), /El uso del CFDI no corresponde/);
  assert.match(explicarRechazoPac("El RFC no se encuentra en la lista de RFC inscritos no cancelados"), /letra por letra/);
  assert.match(explicarRechazoPac("El campo Nombre del receptor debe pertenecer al nombre asociado al RFC"), /exactamente el de su constancia/);
  assert.equal(explicarRechazoPac("Llave de API inválida"), "Llave de API inválida");
  assert.match(explicarRechazoPac("El campo DomicilioFiscalReceptor no coincide", "en"), /Check the patient's ZIP code/);
});
