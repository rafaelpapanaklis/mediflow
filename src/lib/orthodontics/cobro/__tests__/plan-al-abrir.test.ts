/**
 * Ortodoncia — el plan de pago se arma AL ABRIR el caso (ws1-t10, 29-sep-2026).
 * Lo de puro: qué exige el popup, cómo se lee lo que se escribe, la vista previa,
 * y CUÁNDO se manda a crear la factura (y cuándo no).
 *
 * Run: npx tsx --test src/lib/orthodontics/cobro/__tests__/plan-al-abrir.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  condicionesDelPlan,
  fechaDdMmAaaa,
  faltantesDelPlanDePago,
  leerEnganche,
  leerNumeroDePagos,
  leerPrecioColocacion,
  notaDelCobroAlAbrir,
  pagosPropuestos,
  planDePagoParaEnviar,
  vistaPreviaDelPlan,
  type EstadoDelPlan,
} from "../plan-al-abrir";

const PLAZOS: EstadoDelPlan = {
  modo: "PRECIO_TOTAL",
  costoTotal: 36000,
  precioColocacion: "",
  enganche: "6000",
  numPagos: "15",
  primerPago: "2026-09-29",
};
const CONTROL: EstadoDelPlan = { ...PLAZOS, modo: "PAGO_POR_CONTROL", precioColocacion: "4500", enganche: "", numPagos: "" };

const ENVIO = { enObservacion: false, puedeCobrar: true, despues: false };

test("número de pagos propuesto = la duración estimada en meses, dentro de lo que admite un plan (2 a 60)", () => {
  assert.equal(pagosPropuestos(18), 18);
  assert.equal(pagosPropuestos(3), 3);
  assert.equal(pagosPropuestos(1), 2, "un plan a plazos tiene al menos 2 pagos");
  assert.equal(pagosPropuestos(0), 2);
  assert.equal(pagosPropuestos(120), 60);
  assert.equal(pagosPropuestos(Number.NaN), 2);
  assert.equal(pagosPropuestos(17.6), 18);
});

test("el enganche: vacío = sin enganche; acepta «12,000» y «$12000.50»; rechaza letras, negativos y 3 decimales", () => {
  assert.equal(leerEnganche(""), 0);
  assert.equal(leerEnganche("  "), 0);
  assert.equal(leerEnganche("12,000"), 12000);
  assert.equal(leerEnganche("$12000.50"), 12000.5);
  assert.equal(leerEnganche("abc"), null);
  assert.equal(leerEnganche("-5"), null);
  assert.equal(leerEnganche("10.999"), null);
});

test("número de pagos entero de 2 a 60; precio de colocación mayor que cero", () => {
  assert.equal(leerNumeroDePagos("18"), 18);
  assert.equal(leerNumeroDePagos(" 2 "), 2);
  assert.equal(leerNumeroDePagos("1"), null);
  assert.equal(leerNumeroDePagos("61"), null);
  assert.equal(leerNumeroDePagos("6.5"), null);
  assert.equal(leerNumeroDePagos(""), null);
  assert.equal(leerPrecioColocacion("4,500"), 4500);
  assert.equal(leerPrecioColocacion("0"), null);
  assert.equal(leerPrecioColocacion(""), null);
  assert.equal(leerPrecioColocacion("mil"), null);
});

test("«Precio total a plazos»: completo no falta nada; cada dato malo se dice", () => {
  assert.deepEqual(faltantesDelPlanDePago(PLAZOS), []);
  assert.deepEqual(faltantesDelPlanDePago({ ...PLAZOS, enganche: "" }), [], "el enganche es opcional");
  assert.match(faltantesDelPlanDePago({ ...PLAZOS, enganche: "36000" }).join(" "), /enganche menor al costo total/);
  assert.match(faltantesDelPlanDePago({ ...PLAZOS, enganche: "40000" }).join(" "), /enganche menor al costo total/);
  assert.match(faltantesDelPlanDePago({ ...PLAZOS, enganche: "xx" }).join(" "), /enganche válido/);
  assert.match(faltantesDelPlanDePago({ ...PLAZOS, numPagos: "1" }).join(" "), /número de pagos \(de 2 a 60\)/);
  assert.match(faltantesDelPlanDePago({ ...PLAZOS, primerPago: "" }).join(" "), /fecha del primer pago/);
});

test("«Pago por control»: pide el precio de la colocación, y sugiere la casilla «después» si no lo hay", () => {
  assert.deepEqual(faltantesDelPlanDePago(CONTROL), []);
  assert.match(faltantesDelPlanDePago({ ...CONTROL, precioColocacion: "" }).join(" "), /precio de la colocación.*después/);
  assert.match(faltantesDelPlanDePago({ ...CONTROL, precioColocacion: "0" }).join(" "), /precio de colocación válido/);
  // El enganche y los pagos no aplican: no estorban.
  assert.deepEqual(faltantesDelPlanDePago({ ...CONTROL, enganche: "zzz", numPagos: "1", primerPago: "" }), []);
});

test("la vista previa dice enganche, cuántos pagos, de cuánto y cuándo es el primero (con enganche, la 1.ª mensualidad cae un mes después)", () => {
  assert.equal(vistaPreviaDelPlan(PLAZOS), "Enganche $6,000 y 15 pagos de $2,000, el primero el 29/10/2026.");
  // Sin enganche, la primera mensualidad ES la fecha elegida.
  assert.equal(vistaPreviaDelPlan({ ...PLAZOS, enganche: "" }), "15 pagos de $2,400, el primero el 29/09/2026.");
  // El centavo que sobra no se esconde.
  assert.match(vistaPreviaDelPlan({ ...PLAZOS, numPagos: "18" })!, /^Enganche \$6,000 y 18 pagos de \$1,666\.66 \(ajustados al centavo\), el primero el 29\/10\/2026\.$/);
  // Sin datos válidos no hay vista previa.
  assert.equal(vistaPreviaDelPlan({ ...PLAZOS, costoTotal: null }), null);
  assert.equal(vistaPreviaDelPlan({ ...PLAZOS, enganche: "36000" }), null);
  assert.equal(vistaPreviaDelPlan({ ...PLAZOS, numPagos: "" }), null);
  assert.equal(vistaPreviaDelPlan({ ...PLAZOS, primerPago: "" }), null);
});

test("en «Pago por control» la vista previa es la colocación, y dice que los controles se cobran al firmar la hoja", () => {
  assert.equal(vistaPreviaDelPlan(CONTROL), "Colocación de $4,500. Los controles se cobran al firmar cada hoja.");
  assert.equal(vistaPreviaDelPlan({ ...CONTROL, precioColocacion: "" }), null);
});

test("las condiciones de la factura salen a plazos, mensual y acotadas contra el total", () => {
  const c = condicionesDelPlan({ enganche: 6000, numPagos: 15, primerPago: "2026-09-29" }, 36000);
  assert.deepEqual(c, { modo: "plazos", metodo: null, enganche: 6000, numPagos: 15, frecuencia: "MONTHLY", primerPago: "2026-09-29", difiereConSuBanco: false });
  // Un enganche mayor que el total nunca deja mensualidades negativas.
  assert.equal(condicionesDelPlan({ enganche: 99999, numPagos: 15, primerPago: "2026-09-29" }, 36000).enganche, 36000);
  // Pagos fuera de rango se acotan (el servidor no confía en el popup).
  assert.equal(condicionesDelPlan({ enganche: 0, numPagos: 500, primerPago: "2026-09-29" }, 36000).numPagos, 60);
  assert.equal(condicionesDelPlan({ enganche: 0, numPagos: 1, primerPago: "2026-09-29" }, 36000).numPagos, 2);
  // Una fecha que no existe no viaja.
  assert.equal(condicionesDelPlan({ enganche: 0, numPagos: 6, primerPago: "2026-02-31" }, 36000).primerPago, null);
});

test("PRECIO TOTAL: se manda a crear el plan con las condiciones escritas", () => {
  assert.deepEqual(planDePagoParaEnviar({ ...ENVIO, ...PLAZOS }), {
    modoDeCobro: "PRECIO_TOTAL",
    precioColocacion: null,
    enganche: 6000,
    numPagos: 15,
    primerPago: "2026-09-29",
  });
  assert.equal(planDePagoParaEnviar({ ...ENVIO, ...PLAZOS, enganche: "" })?.enganche, 0);
});

test("PAGO POR CONTROL: se manda la colocación con el precio del popup, sin enganche ni pagos", () => {
  assert.deepEqual(planDePagoParaEnviar({ ...ENVIO, ...CONTROL }), {
    modoDeCobro: "PAGO_POR_CONTROL",
    precioColocacion: 4500,
    enganche: 0,
    numPagos: 0,
    primerPago: null,
  });
});

test("«Crear el plan de pago después» NO manda crear factura (y la casilla nace apagada en el popup)", () => {
  assert.equal(planDePagoParaEnviar({ ...ENVIO, despues: true, ...PLAZOS }), null);
  assert.equal(planDePagoParaEnviar({ ...ENVIO, despues: true, ...CONTROL }), null);
  // Con «después» tampoco estorban los datos a medio llenar.
  assert.equal(planDePagoParaEnviar({ ...ENVIO, despues: true, ...PLAZOS, numPagos: "" }), null);
});

test("sin permiso de cobro, el caso se abre y NO se manda crear nada", () => {
  assert.equal(planDePagoParaEnviar({ ...ENVIO, puedeCobrar: false, ...PLAZOS }), null);
  assert.equal(planDePagoParaEnviar({ ...ENVIO, puedeCobrar: false, ...CONTROL }), null);
  assert.equal(notaDelCobroAlAbrir({ enObservacion: false, puedeCobrar: false, despues: false }), "Recepción armará el plan de pago");
});

test("un paciente en observación no lleva plan de tratamiento, así que tampoco factura", () => {
  assert.equal(planDePagoParaEnviar({ ...ENVIO, enObservacion: true, ...PLAZOS }), null);
});

test("con datos malos no se manda nada (el botón ya estaba gris)", () => {
  assert.equal(planDePagoParaEnviar({ ...ENVIO, ...PLAZOS, numPagos: "1" }), null);
  assert.equal(planDePagoParaEnviar({ ...ENVIO, ...CONTROL, precioColocacion: "" }), null);
});

test("lo que se dice bajo el botón según lo que va a pasar con el cobro", () => {
  assert.equal(notaDelCobroAlAbrir({ enObservacion: false, puedeCobrar: true, despues: false }), "Se creará la factura del tratamiento con este plan");
  assert.equal(notaDelCobroAlAbrir({ enObservacion: false, puedeCobrar: true, despues: true }), "El plan de pago queda pendiente: se arma en Cobro");
  assert.equal(notaDelCobroAlAbrir({ enObservacion: true, puedeCobrar: true, despues: false }), "Queda dentro de la ficha del paciente");
});

test("fechas dd/mm/aaaa sin correr el día", () => {
  assert.equal(fechaDdMmAaaa("2026-10-01"), "01/10/2026");
  assert.equal(fechaDdMmAaaa(null), "por definir");
  assert.equal(fechaDdMmAaaa("basura"), "por definir");
});
