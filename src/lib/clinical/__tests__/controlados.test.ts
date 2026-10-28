/**
 * ws1-t10 · el CANDADO de los controlados: lo que NO se puede agregar a mano.
 *
 * Run: npm run test:recetas-catalogo
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarControlado, normalizarNombre, TERMINOS_CONTROLADOS } from "../controlados";

test("los ejemplos de Rafael caen todos, con su grupo", () => {
  assert.deepEqual(detectarControlado("fentanilo"), { nombre: "Fentanilo", grupo: "I" });
  assert.deepEqual(detectarControlado("morfina"), { nombre: "Morfina", grupo: "I" });
  assert.deepEqual(detectarControlado("tramadol"), { nombre: "Tramadol", grupo: "III" });
  assert.deepEqual(detectarControlado("buprenorfina"), { nombre: "Buprenorfina", grupo: "I" });
  assert.equal(detectarControlado("clonazepam")?.grupo, "III");
  assert.equal(detectarControlado("diazepam")?.grupo, "III");
  assert.equal(detectarControlado("alprazolam")?.grupo, "III");
});

test("con y sin acentos, mayúsculas, sales y variantes en inglés", () => {
  assert.ok(detectarControlado("Codeína"));
  assert.ok(detectarControlado("codeina"));
  assert.ok(detectarControlado("CODEÍNA FOSFATO"));
  assert.ok(detectarControlado("Tramadol clorhidrato"));
  assert.ok(detectarControlado("Clorhidrato de tramadol"));
  assert.ok(detectarControlado("Morfina sulfato"));
  assert.ok(detectarControlado("Fentanyl"));
  assert.ok(detectarControlado("Oxycodone HCl"));
  assert.ok(detectarControlado("Buprenorphine"));
  assert.ok(detectarControlado("Lorazepam"));
  assert.ok(detectarControlado("Midazolam"));
  assert.ok(detectarControlado("Metilfenidato"));
  assert.ok(detectarControlado("Ketamina"));
  assert.ok(detectarControlado("Nalbufina"));
  assert.ok(detectarControlado("Pseudoefedrina"));
  assert.ok(detectarControlado("Zolpidem"));
});

test("escondido en una combinación o en la presentación también cae", () => {
  assert.equal(detectarControlado("Paracetamol con codeína")?.nombre, "Codeína");
  assert.equal(detectarControlado("Ketorolaco + tramadol")?.nombre, "Tramadol");
  // El nombre va limpio y el controlado se cuela en la concentración/presentación.
  assert.equal(detectarControlado("Analgésico", "tramadol 50 mg", "caja c/10")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Gotas", "", "clonazepam 2.5 mg/mL")?.nombre, "Benzodiazepina");
});

test("marcas comerciales con las que un doctor lo escribiría en México", () => {
  assert.equal(detectarControlado("Rivotril")?.nombre, "Clonazepam");
  assert.equal(detectarControlado("Tafil 0.5")?.nombre, "Alprazolam");
  assert.equal(detectarControlado("Valium")?.nombre, "Diazepam");
  assert.equal(detectarControlado("Tramal")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Zaldiar")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Durogesic 25")?.nombre, "Fentanilo");
  assert.equal(detectarControlado("Temgesic")?.nombre, "Buprenorfina");
  assert.equal(detectarControlado("Ritalin")?.nombre, "Metilfenidato");
  assert.equal(detectarControlado("Tylex CD")?.nombre, "Codeína");
});

test("lo que un dentista agrega a mano PASA: AINE, antibióticos, anestésicos locales, bucales", () => {
  for (const libre of [
    "Ibuprofeno", "Ketorolaco", "Paracetamol", "Naproxeno sódico", "Metamizol", "Nimesulida", "Dexketoprofeno",
    "Amoxicilina con ácido clavulánico", "Clindamicina", "Metronidazol", "Azitromicina", "Cefalexina", "Dicloxacilina",
    "Lidocaína con epinefrina", "Mepivacaína", "Articaína", "Bupivacaína", "Prilocaína", "Benzocaína", "Procaína",
    "Clorhexidina", "Fluoruro de sodio", "Nistatina", "Fluconazol", "Miconazol", "Clotrimazol", "Ketoconazol",
    "Dexametasona", "Prednisona", "Aciclovir", "Omeprazol", "Loratadina", "Hidroxicina", "Fenobarbital",
    "Epinefrina", "Metoclopramida", "Ondansetrón", "Pregabalina", "Gabapentina", "Carbamazepina", "Amitriptilina",
    "Etodolaco", "Ultradol", "Apixabán", "Ácido tranexámico", "Opioide natural de referencia", "Litiasis",
  ]) {
    assert.equal(detectarControlado(libre), null, `«${libre}» no es controlado y no debería caer`);
  }
});

test("los nombres cortos solo cuentan como palabra entera", () => {
  assert.equal(detectarControlado("Opio")?.nombre, "Opio");
  assert.equal(detectarControlado("tintura de opio")?.nombre, "Opio");
  assert.equal(detectarControlado("opioide"), null);
  assert.equal(detectarControlado("Carbonato de litio")?.nombre, "Litio");
  assert.equal(detectarControlado("litiasis"), null);
});

test("vacío o basura: nada", () => {
  assert.equal(detectarControlado(""), null);
  assert.equal(detectarControlado(null, undefined, "   "), null);
  assert.equal(detectarControlado("500 mg"), null);
});

test("normalizarNombre: minúsculas, sin acentos ni signos", () => {
  assert.equal(normalizarNombre("Clorhidrato de Tramadol 50 mg"), "clorhidratodetramadol50mg");
  assert.equal(normalizarNombre("Codeína/Paracetamol", true), "codeina paracetamol");
});

test("la lista no se vacía por accidente", () => {
  assert.ok(TERMINOS_CONTROLADOS > 120, `solo ${TERMINOS_CONTROLADOS} términos`);
});
