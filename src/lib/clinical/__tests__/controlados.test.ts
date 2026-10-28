/**
 * ws1-t10 · el CANDADO de los controlados: lo que NO se puede agregar a mano.
 *
 * Run: npm run test:recetas-catalogo
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUMS_ESSENTIALS } from "@/lib/seeds/cums-essentials";
import { detectarControlado, lecturasConDigitos, lecturasDelTexto, normalizarNombre, TERMINOS_CONTROLADOS } from "../controlados";
import { FORMAS_FARMACEUTICAS, VIAS } from "../medicamentos-propios.contrato";

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

// ── v3 · la revisión v2 de t8 (m-1, m-2, m-3) ─────────────────────────────

test("v3 · m-1: I mayúscula leída como l, «rn» como «m» (antes de pasar a minúsculas)", () => {
  assert.equal(detectarControlado("TyIex")?.nombre, "Codeína");
  assert.equal(detectarControlado("TafiI")?.nombre, "Alprazolam");
  assert.equal(detectarControlado("TramaI")?.nombre, "Tramadol");
  assert.equal(detectarControlado("VaIium")?.nombre, "Diazepam");
  assert.equal(detectarControlado("Iitio")?.nombre, "Litio");
  assert.equal(detectarControlado("Trarnadol")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Ketarnina")?.nombre, "Ketamina");
  assert.equal(detectarControlado("Trarnal")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Clonazeparn")?.nombre, "Clonazepam");
  assert.equal(detectarControlado("rnorfina")?.nombre, "Morfina");
  assert.ok(lecturasDelTexto("TyIex").includes("tylex"));
  assert.ok(lecturasDelTexto("Trarnadol").includes("tramadol"));
});

test("v3 · m-1: erratas concretas de las marcas cortas (sin tolerancia general: Tafil está a una letra de Tafirol)", () => {
  for (const [texto, nombre] of [["Zanax", "Alprazolam"], ["Xanex", "Alprazolam"], ["Xannax", "Alprazolam"], ["Xanaks", "Alprazolam"], ["Taffil", "Alprazolam"], ["Tafyl", "Alprazolam"], ["Valiun", "Diazepam"], ["Tramall", "Tramadol"], ["Tilex", "Codeína"]]) {
    assert.equal(detectarControlado(texto)?.nombre, nombre, texto);
  }
  assert.equal(detectarControlado("Tafirol"), null, "Tafirol es paracetamol");
  assert.equal(detectarControlado("Tempra"), null);
});

test("v3 · m-1: «tradol» pegado a un número o como principio de palabra cae; dentro de «Ultradol» no", () => {
  assert.equal(detectarControlado("Tradol50")?.nombre, "Tramadol");
  assert.equal(detectarControlado("TradolRetard")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Tradol-retard")?.nombre, "Tramadol");
  assert.equal(detectarControlado("tradol 50 mg")?.nombre, "Tramadol");
  assert.equal(detectarControlado("Ultradol"), null);
  assert.equal(detectarControlado("Ultradol 300 mg"), null);
});

test("v3 · m-2: marcas confirmadas con registro sanitario (vademecum.es/mexico)", () => {
  for (const [texto, nombre] of [["Kriadex", "Clonazepam"], ["Ortopsique", "Diazepam"], ["Alzam", "Alprazolam"], ["Tramacet", "Tramadol"], ["Sideril", "Trazodona"], ["Efexor XR", "Venlafaxina"], ["Cymbalta", "Duloxetina"], ["Remeron SolTab", "Mirtazapina"], ["Abilify", "Aripiprazol"]]) {
    assert.equal(detectarControlado(texto)?.nombre, nombre, texto);
  }
});

test("v3 · m-3: ketorolaco trometamina, trometamol, hexetidina, cannabidiol y EDTA NO son controlados", () => {
  for (const libre of ["Ketorolaco trometamina", "Ketorolaco trometamina 10 mg", "Trometamina", "Ketorolaco trometamol", "Dexketoprofeno trometamol", "Hexetidina", "Cannabidiol", "Ácido etilendiaminotetraacético", "Cefaclor acetato", "Ornidazol maleato", "Ácido fólico dinitrato", "Keflex procaínica", "Dabigatrán maleato", "Levetiracetam maleato"]) {
    assert.equal(detectarControlado(libre), null, `«${libre}» no es controlado y no debería caer`);
  }
  assert.equal(detectarControlado("Ketamina")?.nombre, "Ketamina");
  assert.equal(detectarControlado("Ketalar")?.nombre, "Ketamina");
  assert.equal(detectarControlado("Ketamine HCl")?.nombre, "Ketamina");
  assert.equal(detectarControlado("Cannabis")?.nombre, "Cannabis");
  assert.equal(detectarControlado("Petidina")?.nombre, "Petidina (meperidina)");
  assert.equal(detectarControlado("Meperidina")?.nombre, "Petidina (meperidina)");
});

test("v3 · m-3: prueba amplia — todo el catálogo IV/V/VI y ~150 nombres de consultorio, con sus sales y en mayúsculas, sin falsos positivos", () => {
  const SALES = ["", " trometamina", " trometamol", " clorhidrato", " sódico", " potásico", " maleato", " besilato", " citrato", " fosfato", " sulfato", " acetato", " succinato", " mesilato", " tartrato", " hidrobromuro", " dipropionato", " valerato", " dinitrato", " cálcico", " monohidratado", " trihidratada", " benzatínica", " procaínica"];
  const EXTRA = ["Ketorolaco trometamina", "Trometamina", "Cannabidiol", "Articaína con epinefrina", "Lidocaína con epinefrina", "Mepivacaína con levonordefrina", "Prilocaína con felipresina", "Bupivacaína", "Epinefrina", "Levonordefrina", "Felipresina", "Norepinefrina", "Adrenalina", "Vasopresina", "Benzocaína", "Tetracaína", "Procaína", "Ropivacaína", "Pramoxina", "Ibuprofeno", "Ketoprofeno", "Dexketoprofeno trometamol", "Flurbiprofeno", "Naproxeno sódico", "Diclofenaco potásico", "Aceclofenaco", "Etodolaco", "Indometacina", "Meloxicam", "Piroxicam", "Tenoxicam", "Nimesulida", "Celecoxib", "Etoricoxib", "Parecoxib", "Paracetamol", "Acetaminofén", "Metamizol sódico", "Dipirona", "Ácido acetilsalicílico", "Clonixinato de lisina", "Ácido mefenámico", "Nabumetona", "Amoxicilina", "Amoxicilina clavulanato", "Ampicilina", "Dicloxacilina", "Fenoximetilpenicilina", "Penicilina G benzatínica", "Cefalexina", "Cefadroxilo", "Cefaclor", "Cefuroxima axetilo", "Cefixima", "Ceftriaxona", "Clindamicina fosfato", "Lincomicina", "Eritromicina", "Azitromicina", "Claritromicina", "Metronidazol", "Tinidazol", "Secnidazol", "Ornidazol", "Espiramicina", "Doxiciclina hiclato", "Minociclina", "Tetraciclina", "Ciprofloxacino", "Levofloxacino", "Moxifloxacino", "Gentamicina", "Amikacina", "Vancomicina", "Linezolid", "Trimetoprima sulfametoxazol", "Nitrofurantoína", "Fosfomicina", "Rifampicina", "Bacitracina", "Neomicina", "Mupirocina", "Ácido fusídico", "Nistatina", "Fluconazol", "Itraconazol", "Ketoconazol", "Miconazol", "Clotrimazol", "Terbinafina", "Anfotericina B", "Aciclovir", "Valaciclovir", "Famciclovir", "Penciclovir", "Dexametasona", "Betametasona", "Prednisona", "Prednisolona", "Metilprednisolona", "Hidrocortisona", "Triamcinolona acetónido", "Fluocinolona", "Clobetasol", "Mometasona", "Budesonida", "Deflazacort", "Clorhexidina", "Cloruro de cetilpiridinio", "Hexetidina", "Triclosán", "Povidona yodada", "Peróxido de hidrógeno", "Peróxido de carbamida", "Fluoruro de sodio", "Fluoruro estañoso", "Monofluorofosfato", "Xilitol", "Hidroxiapatita", "Nitrato de potasio", "Arginina", "Bencidamina", "Hialuronato de sodio", "Ácido hialurónico", "Carboximetilcelulosa", "Pilocarpina", "Cevimelina", "Hidróxido de calcio", "Óxido de zinc eugenol", "Eugenol", "Hipoclorito de sodio", "EDTA", "Ácido etilendiaminotetraacético", "Gluconato de clorhexidina", "Paramonoclorofenol", "Formocresol", "Yodoformo", "Gutapercha", "Trióxido mineral agregado", "Ionómero de vidrio", "Ácido fosfórico", "Ácido poliacrílico", "Alginato", "Loratadina", "Desloratadina", "Cetirizina", "Fexofenadina", "Clorfenamina", "Difenhidramina", "Hidroxicina", "Ranitidina", "Famotidina", "Omeprazol", "Pantoprazol", "Metoclopramida", "Ondansetrón", "Butilhioscina", "Enalapril", "Losartán", "Amlodipino", "Metoprolol", "Propranolol", "Furosemida", "Atorvastatina", "Metformina", "Levotiroxina", "Warfarina", "Rivaroxabán", "Apixabán", "Dabigatrán", "Clopidogrel", "Ácido tranexámico", "Heparina", "Enoxaparina", "Nitroglicerina", "Salbutamol", "Montelukast", "Ambroxol", "Acetilcisteína", "Ácido fólico", "Sulfato ferroso", "Cianocobalamina", "Vitamina C", "Vitamina D3", "Melatonina", "Carbamazepina", "Oxcarbazepina", "Gabapentina", "Pregabalina", "Amitriptilina", "Levetiracetam", "Ácido valproico", "Tiamina", "Nitazoxanida", "Albendazol", "Tafirol", "Tempra", "Tylenol", "Advil", "Motrin", "Dolac", "Supradol", "Neurobion", "Flanax", "Cataflam", "Voltaren", "Febrax", "Lertus", "Dorixina", "Novalgina", "Neo-Melubrina", "Amoxil", "Clavulin", "Augmentin", "Dalacin", "Flagyl", "Rodogyl", "Keflex", "Zitromax", "Klaricid", "Ceclor", "Zovirax", "Diflucan", "Micostatin", "Daktarin", "Canesten", "Decadron", "Alin", "Meticorten", "Medrol", "Oralgene", "Periogard", "Perioxidin", "Listerine", "Sensodyne", "Duraphat", "Clinpro", "Opalescence", "Xilocaína", "Xylocaina", "Septocaine", "Ultracaine", "Scandonest", "Citanest", "Marcaína", "Carbocaína", "Hurricaine", "Topex", "Orajel", "Anbesol", "Oragesic", "Ultradol", "Lodine"];
  const nombres = [...CUMS_ESSENTIALS.filter((e) => !["I", "II", "III"].includes(e.cofeprisGroup ?? "")).map((e) => e.descripcion), ...EXTRA];
  const falsos: string[] = [];
  let n = 0;
  for (const base of nombres) {
    for (const sal of SALES) {
      for (const v of [base + sal, (base + sal).toUpperCase()]) {
        n++;
        const c = detectarControlado(v);
        if (c) falsos.push(`${v} → ${c.nombre} ${c.grupo}`);
      }
    }
  }
  assert.ok(n > 25_000, `solo ${n} combinaciones`);
  assert.deepEqual(falsos.slice(0, 20), [], `${falsos.length} falsos positivos`);
});

// ── v4 · la revisión v3 de t8 (m-1, m-2) ──────────────────────────────────

test("v4 · m-1: errata + palabra partida por un signo o por un espacio cae (la tabla de t8)", () => {
  for (const [texto, nombre] of [
    ["Trama-dool", "Tramadol"], ["Tra.madool", "Tramadol"], ["Clonaze-pan", "Clonazepam"], ["Alpra-zolan", "Alprazolam"],
    ["Trama dool", "Tramadol"], ["Clona zepan", "Clonazepam"], ["Fenobar bitol", "Fenobarbital"], ["Bupre norfin", "Buprenorfina"],
  ]) {
    assert.equal(detectarControlado(texto)?.nombre, nombre, texto);
  }
  // La pareja se compara ENTERA: no vuelven los falsos positivos de v3.
  assert.equal(detectarControlado("Cefaclor acetato"), null);
  assert.equal(detectarControlado("Ácido fólico dinitrato"), null);
});

test("v5 · m-1: un signo suelto entre espacios o la palabra en tres trozos ya no esconden la errata (la tabla de t8)", () => {
  for (const [texto, nombre] of [
    ["Trama - dool", "Tramadol"], ["Tra ma dool", "Tramadol"], ["Tram a dool", "Tramadol"], ["Cl ona zepan", "Clonazepam"],
  ]) {
    assert.equal(detectarControlado(texto)?.nombre, nombre, texto);
  }
  // El trío se compara ENTERO: tres palabras legítimas no se vuelven un controlado.
  assert.equal(detectarControlado("Cefaclor acetato 500 mg"), null);
  assert.equal(detectarControlado("Ácido fólico dinitrato"), null);
  assert.equal(detectarControlado("Ketorolaco - trometamina"), null);
});

test("v4 · m-2: los signos de dosis que imitan letras no disfrazan un controlado (la tabla de t8)", () => {
  const casos: Array<[string, string, string]> = [
    ["", "Mºrfina caja", "Morfina"],
    ["", "Tramªdol", "Tramadol"],
    ["", "Trªmªdol caja c/10", "Tramadol"],
    ["", "Trªmadºl", "Tramadol"],
    ["Trªmªdºl 50 mg", "", "Tramadol"],
    ["", "Diazepªm", "Diazepam"],
    ["Nµbain 10 mg", "", "Nalbufina"],
    ["N\u03BCbain 10 mg", "", "Nalbufina"],
    ["", "Tr°m°dol", "Tramadol"],
    ["", "Tramad×l", "Tramadol"],
    ["", "X½nax", "Alprazolam"],
  ];
  for (const [concentracion, presentacion, nombre] of casos) {
    assert.equal(detectarControlado("Analgésico", concentracion, presentacion, "Tableta", "Oral")?.nombre, nombre, `${concentracion}|${presentacion}`);
  }
  assert.equal(normalizarNombre("Mºrfina"), "morfina");
  assert.equal(normalizarNombre("Tramªdol"), "tramadol");
  assert.equal(normalizarNombre("Nµbain"), "nubain");
});

test("v4 · los signos de dosis legítimos siguen sin disparar nada", () => {
  for (const [concentracion, presentacion] of [
    ["50 µg/mL", ""], ["50 \u03BCg", ""], ["37 °C", ""], ["", "N° 2, 1ª dosis, 2×10"], ["½ tableta", ""], ["¼ tableta", "¾ frasco"],
    ["100 mg; 200 mg", ""], ["1' 30''", ""], ["1:100,000", "caja c/50 cartuchos"],
    // v5: los signos de dosis PEGADOS a letras del barrido de t8 (donde actúan el comodín y los tríos).
    ["1000µg/mL", ""], ["25µg/h parche", ""], ["Vitamina D 25µg", ""], ["Ácido fólico 400µg", ""], ["Cianocobalamina 1000µg", ""],
    ["Biotina 5000µg", ""], ["Selenio 200µg", ""], ["10 µL", ""], ["37°C", ""], ["1°", ""], ["1ªtoma", ""], ["2ª y 3ª dosis", ""], ["Nº3", ""],
    ["0.5mg×2 al día", ""], ["Clorhexidina 0.12%×250 mL", ""], ["c/12h×5 días", ""], ["15 mL×3", ""],
    ["½tab c/8h", ""], ["x½ tableta", ""], ["tableta ½ o ¼", ""], ["¾ de cucharadita", ""],
  ]) {
    assert.equal(detectarControlado("Lidocaína con epinefrina", concentracion, presentacion, "Inyectable", "Bucal"), null, `${concentracion}|${presentacion}`);
  }
});

test("v4 · barrido: cada fila IV/V/VI del catálogo con su presentación, en las 16 formas × 14 vías y en MAYÚSCULAS, sin falsos positivos", () => {
  const filas = CUMS_ESSENTIALS.filter((e) => !["I", "II", "III"].includes(e.cofeprisGroup ?? ""));
  const falsos: string[] = [];
  let n = 0;
  for (const e of filas) {
    for (const [, forma] of FORMAS_FARMACEUTICAS) {
      for (const [, via] of VIAS) {
        n++;
        const c = detectarControlado(e.descripcion, e.presentacion, "", forma, via);
        if (c) falsos.push(`${e.clave} ${e.descripcion} · ${e.presentacion} · ${forma} · ${via} → ${c.nombre}`);
      }
    }
    const mayus = detectarControlado(e.descripcion.toUpperCase(), e.presentacion.toUpperCase());
    n++;
    if (mayus) falsos.push(`${e.clave} EN MAYÚSCULAS → ${mayus.nombre}`);
  }
  assert.ok(n > 60_000, `solo ${n} combinaciones`);
  assert.deepEqual(falsos.slice(0, 20), [], `${falsos.length} falsos positivos`);
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
  assert.ok(TERMINOS_CONTROLADOS > 170, `solo ${TERMINOS_CONTROLADOS} términos`);
});
