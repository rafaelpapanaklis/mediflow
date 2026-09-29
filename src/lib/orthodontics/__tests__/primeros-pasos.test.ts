/**
 * Primeros pasos del módulo de Ortodoncia.
 *
 *   npx tsx --test src/lib/orthodontics/__tests__/primeros-pasos.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { primerosPasosOrtodoncia, titulosPrimerosPasos, type EstadoPrimerosPasos } from "../primeros-pasos";

function estado(over: Partial<EstadoPrimerosPasos> = {}): EstadoPrimerosPasos {
  return {
    configuracionGuardada: false,
    modoDeCobro: "PRECIO_TOTAL",
    casos: 0,
    casosConPlanDePago: 0,
    ...over,
  };
}

test("clínica recién contratada: tres pasos, ninguno hecho, empieza por el modo de cobro", () => {
  const r = primerosPasosOrtodoncia(estado());
  assert.deepEqual(r.pasos.map((p) => p.clave), ["modo-de-cobro", "primer-caso", "plan-de-pago"]);
  assert.equal(r.hechos, 0);
  assert.equal(r.total, 3);
  assert.equal(r.completo, false);
  assert.equal(r.siguiente, "modo-de-cobro");
});

test("pago por control: no se pide un plan de pago que ese modo no tiene", () => {
  const r = primerosPasosOrtodoncia(estado({ modoDeCobro: "PAGO_POR_CONTROL", configuracionGuardada: true }));
  assert.deepEqual(r.pasos.map((p) => p.clave), ["modo-de-cobro", "primer-caso"]);
  assert.equal(r.total, 2);
  assert.equal(r.siguiente, "primer-caso");
});

test("el siguiente es el primero sin hacer, aunque haya pasos posteriores hechos", () => {
  const r = primerosPasosOrtodoncia(estado({ casos: 2, casosConPlanDePago: 1 }));
  assert.equal(r.hechos, 2);
  assert.equal(r.siguiente, "modo-de-cobro");
  assert.equal(r.completo, false);
});

test("un caso sin plan de pago deja pendiente el último paso", () => {
  const r = primerosPasosOrtodoncia(
    estado({ configuracionGuardada: true, casos: 1, casosConPlanDePago: 0 }),
  );
  assert.equal(r.siguiente, "plan-de-pago");
  assert.equal(r.hechos, 2);
});

test("todo hecho: completo y sin siguiente", () => {
  const r = primerosPasosOrtodoncia(
    estado({ configuracionGuardada: true, casos: 3, casosConPlanDePago: 2 }),
  );
  assert.equal(r.completo, true);
  assert.equal(r.siguiente, null);
});

test("pago por control con todo lo suyo hecho: completo sin plan de pago", () => {
  const r = primerosPasosOrtodoncia(
    estado({ modoDeCobro: "PAGO_POR_CONTROL", configuracionGuardada: true, casos: 1 }),
  );
  assert.equal(r.completo, true);
});

test("se dice «caso», no «tratamiento»", () => {
  for (const p of primerosPasosOrtodoncia(estado()).pasos) {
    assert.doesNotMatch(`${p.titulo} ${p.detalle}`, /tratamiento\b/i, p.clave);
  }
});

test("los títulos del correo son los mismos que los del Tablero", () => {
  assert.deepEqual(titulosPrimerosPasos(), primerosPasosOrtodoncia(estado()).pasos.map((p) => p.titulo));
  assert.equal(titulosPrimerosPasos("PAGO_POR_CONTROL").length, 2);
});
