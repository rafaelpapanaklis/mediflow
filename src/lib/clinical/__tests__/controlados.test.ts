/**
 * ws1-t10 · el CANDADO de los controlados: lo que NO se puede agregar a mano.
 *
 * Run: npm run test:recetas-catalogo
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarControlado, lecturasConDigitos, normalizarNombre, TERMINOS_CONTROLADOS } from "../controlados";

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
  assert.equal(detectarControlado("Gotas", "", "clonazepam 2.5 mg/mL")?.nombre, "Clonazepam");
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
    "Dexametasona", "Prednisona", "Aciclovir", "Omeprazol", "Loratadina", "Hidroxicina",
    "Epinefrina", "Metoclopramida", "Ondansetrón", "Pregabalina", "Gabapentina", "Carbamazepina", "Amitriptilina",
    "Etodolaco", "Ultradol", "Apixabán", "Ácido tranexámico", "Opioide natural de referencia", "Litiasis",
  ]) {
    assert.equal(detectarControlado(libre), null, `«${libre}» no es controlado y no debería caer`);
  }
});

// ── v2 · la tabla de la revisión de t8 (M-1) ──────────────────────────────

test("v2 · las marcas que t8 encontró pasando, ahora caen", () => {
  const casos: Array<[string, string]> = [
    ["Xanax", "Alprazolam"], ["Tradol", "Tramadol"], ["Tradol 50 mg", "Tramadol"], ["Ultram", "Tramadol"],
    ["Klonopin", "Clonazepam"], ["Rohypnol", "Flunitrazepam"], ["Dilaudid", "Hidromorfona"],
    ["Demerol", "Petidina (meperidina)"], ["Vicodin", "Hidrocodona"], ["Percocet", "Oxicodona"],
    ["Palexia", "Tapentadol"], ["Nucynta", "Tapentadol"], ["Graten", "Morfina"],
  ];
  for (const [texto, nombre] of casos) assert.equal(detectarControlado(texto)?.nombre, nombre, texto);
  // «Ultradol» es etodolaco (AINE): «tradol» solo cuenta como palabra entera.
  assert.equal(detectarControlado("Ultradol"), null);
  assert.equal(detectarControlado("Etodolaco"), null);
});

test("v2 · barbitúricos: los de acción corta son II (ley) y los de acción larga IV (ley), pero todos caen", () => {
  assert.deepEqual(detectarControlado("Pentobarbital"), { nombre: "Pentobarbital", grupo: "II" });
  assert.deepEqual(detectarControlado("Amobarbital sódico"), { nombre: "Amobarbital", grupo: "II" });
  assert.deepEqual(detectarControlado("Fenobarbital"), { nombre: "Fenobarbital", grupo: "IV" });
  assert.deepEqual(detectarControlado("Phenobarbital"), { nombre: "Fenobarbital", grupo: "IV" });
  assert.deepEqual(detectarControlado("Barbital"), { nombre: "Barbitúrico", grupo: "IV" });
  assert.deepEqual(detectarControlado("Butalbital"), { nombre: "Butalbital", grupo: "IV" });
  assert.deepEqual(detectarControlado("Metilfenobarbital")?.grupo, "IV");
  assert.deepEqual(detectarControlado("Tiopental"), { nombre: "Tiopental", grupo: "IV" });
  assert.deepEqual(detectarControlado("Pentotal sódico"), { nombre: "Tiopental", grupo: "IV" });
});

test("v2 · dígitos y símbolos usados como letras", () => {
  for (const texto of ["Tramad0l", "Tr4madol", "M0rfina", "Fentan1lo", "Diazep4m", "Alpraz0lam", "Cl0nazepam", "C1onazepam", "Tram@dol", "Codeín4", "Fentani7o"]) {
    assert.ok(detectarControlado(texto), texto);
  }
  assert.deepEqual(lecturasConDigitos("tramad0l"), ["tramadol"]);
  assert.deepEqual(lecturasConDigitos("c1onazepam"), ["cionazepam", "clonazepam"]);
  // Una concentración normal no se vuelve un controlado al traducir dígitos.
  assert.equal(detectarControlado("Ibuprofeno", "400 mg", "caja c/30"), null);
  assert.equal(detectarControlado("Amoxicilina", "500 mg/5 mL", "frasco 75 mL"), null);
});

test("v2 · espacios, signos y caracteres invisibles entre las letras no esconden nada", () => {
  for (const texto of ["T r a m a d o l", "Tra-ma.dol", "Tram\u200Badol", "TRAMADOL", "Tramadól", "Mórfina", "Morphine", "Midazolam", "Flunitrazepam"]) {
    assert.ok(detectarControlado(texto), JSON.stringify(texto));
  }
});

test("v2 · una letra de diferencia en los términos largos cae; en los cortos no", () => {
  assert.equal(detectarControlado("Tramadool")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Tramdol")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Tramadel")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Clonazepan")?.nombre, "Clonazepam");
  assert.equal(detectarControlado("Alprazolan")?.nombre, "Alprazolam");
  // Sin tolerancia donde a una letra hay un medicamento de todos los días.
  assert.equal(detectarControlado("Dexametasona"), null);
  assert.equal(detectarControlado("Betametasona"), null);
  assert.equal(detectarControlado("Metadona")?.nombre, "Metadona");
  assert.equal(detectarControlado("Buprenorfin")?.nombre, "Buprenorfina");
  assert.equal(detectarControlado("Oxicodone")?.nombre, "Oxicodona");
  assert.equal(detectarControlado("Fenobarbitol")?.nombre, "Fenobarbital");
  // Lo que está a una letra de un controlado pero es de uso diario NO cae.
  for (const libre of ["Procaína", "Lidocaína", "Benzocaína", "Mepivacaína", "Articaína", "Bupivacaína", "Prilocaína",
    "Vitamina", "Heparina", "Epinefrina", "Cafeína", "Ranitidina", "Warfarina", "Amiodarona", "Hidrocortisona",
    "Oxitocina", "Terbinafina", "Cetirizina", "Metformina", "Clotrimazol", "Ketorolaco", "Ketoconazol", "Tretinoína",
    "Codorniz", "Morfología", "Trazado", "Tramitar", "Fenol", "Tiamina", "Tiotropio", "Pentoxifilina", "Nistatina",
    "Nitazoxanida", "Metronidazol", "Ácido tranexámico", "Deflazacort", "Ergocalciferol", "Pilocarpina", "Pseudomonas"]) {
    assert.equal(detectarControlado(libre), null, `«${libre}» no es controlado y no debería caer`);
  }
});

test("v2 · la vía también se revisa (va a la receta impresa)", () => {
  assert.equal(detectarControlado("Analgésico", "50 mg", "", "Tableta", "oral (tramadol)")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Analgésico", "50 mg", "", "Tableta", "Oral"), null);
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
  assert.ok(TERMINOS_CONTROLADOS > 140, `solo ${TERMINOS_CONTROLADOS} términos`);
});
