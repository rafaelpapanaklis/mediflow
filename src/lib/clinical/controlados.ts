/**
 * CANDADO de los medicamentos controlados (ws1-t10, decisión de Rafael del
 * 28-oct-2026): un medicamento de los grupos COFEPRIS I, II o III NO se puede
 * agregar «a mano» a la lista propia de la clínica. Quien lo intente se manda
 * al catálogo, donde la receta pide el folio del recetario y el servidor aplica
 * el tope legal de vigencia (ver `cofepris.ts`). Nadie salta el control
 * escribiéndolo libre: la detección corre en el servidor (la pantalla solo la
 * repite para avisar antes).
 *
 * De dónde salen los nombres — Ley General de Salud (texto vigente, últimas
 * reformas DOF 15-01-2026, leído del PDF de la Cámara de Diputados):
 *   · art. 234 (estupefacientes → fracción I, receta especial con código de
 *     barras): fentanilo y análogos, morfina, codeína, hidrocodona,
 *     hidromorfona, oxicodona, oximorfona, metadona, petidina (meperidina),
 *     buprenorfina, dextropropoxifeno, pentazocina, difenoxilato, tilidina,
 *     metilfenidato, opio, cocaína, cannabis…
 *   · art. 245 fr. II (psicotrópicos, receta que se retiene): nalbufina,
 *     butorfanol, anfetaminas, pseudoefedrina, barbitúricos de acción corta
 *     (amobarbital, pentobarbital, secobarbital, ciclobarbital), fenciclidina,
 *     metacualona, catina, nicergolina…
 *   · art. 245 fr. III (receta surtible hasta 3 veces): TODAS las
 *     benzodiazepinas (alprazolam, clonazepam, diazepam, lorazepam, midazolam,
 *     bromazepam, triazolam…), zopiclona, ketamina, TRAMADOL (añadido por la
 *     reforma del 15-ene-2026), bupropión (ídem), carisoprodol, meprobamato,
 *     fentermina, anfepramona, clobenzorex, fenproporex, hidrato de cloral,
 *     trihexifenidilo, risperidona, clozapina, pimozida, efedrina, ergotamina…
 *   · art. 245 fr. IV (psicotrópicos de amplio uso, fracción IV): los
 *     barbitúricos de acción larga —fenobarbital, barbital, butalbital,
 *     metilfenobarbital, tiopental (pentotal)—. Legalmente NO son I/II/III,
 *     pero son psicotrópicos con potencial de abuso y la revisión v2 (t8)
 *     pidió cerrarlos: se bloquean igual, con su grupo real «IV» en el aviso.
 * Se añaden además las variantes en inglés, las sales (clorhidrato, sulfato…
 * no hacen falta: se busca el nombre base dentro del texto) y las marcas con
 * las que un doctor podría escribirlos en México o en Estados Unidos.
 *
 * Qué grupo se devuelve: el que usa el CATÁLOGO de esta app para ese
 * medicamento (`cums-essentials.ts`), para que el aviso de la pantalla diga lo
 * mismo que dirá la receta al elegirlo del catálogo. Los antidepresivos y
 * antipsicóticos van como III porque así los clasifica el catálogo (más
 * estricto que la fracción IV de la ley); en el candado solo importa que NO se
 * puedan escribir libres.
 *
 * CÓMO SE COMPARA (v2, hallazgo M-1 de t8):
 *   1. el texto se normaliza: minúsculas, sin acentos, sin espacios ni signos
 *      («T r a m a d o l», «Tra-ma.dol» → «tramadol»);
 *   2. se compara TAL CUAL y además con los dígitos y símbolos que se usan como
 *      letras traducidos (0→o, 1→i y 1→l, 3→e, 4→a, 5→s, 7→t, @→a, $→s):
 *      «Tramad0l», «Fentan1lo», «C1onazepam» caen;
 *   3. para los términos de 7 letras o más se tolera UNA letra de diferencia
 *      (cambiada, sobrante o faltante): «Tramadool», «Clonazepan» caen. Hay
 *      términos sin tolerancia (`SIN_TOLERANCIA`) porque a una letra están de
 *      medicamentos de uso diario (cocaína ⇄ procaína/lidocaína/benzocaína);
 *      la prueba del catálogo exige que NINGÚN IV/V/VI caiga.
 *   Lo que no son letras latinas (cirílico, griego, ancho completo) no llega
 *   aquí: lo corta antes `CARACTERES_PERMITIDOS` del contrato con un 400.
 *
 * PURO: sin Prisma ni React. Lo usan el servidor y la pantalla.
 */

export type GrupoControlado = "I" | "II" | "III" | "IV";

export interface Controlado {
  /** Nombre con el que se avisa (denominación genérica). */
  nombre: string;
  grupo: GrupoControlado;
}

/**
 * Términos que se buscan DENTRO del texto normalizado (sin acentos, sin
 * espacios ni signos, en minúsculas). Un término de la lista «contenido en» el
 * texto basta: «paracetamol con codeína» cae por «codeina», «clonazepam gotas»
 * por «zepam». Nada con menos de 5 letras entra aquí (ver PALABRAS_EXACTAS).
 * El ORDEN importa cuando un término contiene a otro (pseudoefedrina II antes
 * que efedrina III; amobarbital II antes que el genérico barbital IV).
 */
const CONTENIDOS: ReadonlyArray<[termino: string, nombre: string, grupo: GrupoControlado]> = [
  // ── Fracción I · estupefacientes (art. 234) ──────────────────────────────
  ["fentanil", "Fentanilo", "I"], // fentanilo, fentanil, fentanilo citrato, carfentanilo, sufentanil, alfentanil, remifentanilo
  ["fentanyl", "Fentanilo", "I"],
  ["morfina", "Morfina", "I"],
  ["morphin", "Morfina", "I"],
  ["codein", "Codeína", "I"], // codeína, codeine, dihidrocodeína
  ["hidrocodona", "Hidrocodona", "I"],
  ["hydrocodone", "Hidrocodona", "I"],
  ["hidromorfona", "Hidromorfona", "I"],
  ["hydromorphone", "Hidromorfona", "I"],
  ["oxicodona", "Oxicodona", "I"],
  ["oxycodone", "Oxicodona", "I"],
  ["oximorfona", "Oximorfona", "I"],
  ["oxymorphone", "Oximorfona", "I"],
  ["metadona", "Metadona", "I"],
  ["methadone", "Metadona", "I"],
  ["petidina", "Petidina (meperidina)", "I"],
  ["meperidina", "Petidina (meperidina)", "I"],
  ["pethidine", "Petidina (meperidina)", "I"],
  ["meperidine", "Petidina (meperidina)", "I"],
  ["buprenorfina", "Buprenorfina", "I"],
  ["buprenorphine", "Buprenorfina", "I"],
  ["tapentadol", "Tapentadol", "I"],
  ["propoxifeno", "Dextropropoxifeno", "I"], // dextropropoxifeno
  ["propoxyphene", "Dextropropoxifeno", "I"],
  ["pentazocina", "Pentazocina", "I"],
  ["difenoxilato", "Difenoxilato", "I"],
  ["tilidina", "Tilidina", "I"],
  ["levorfanol", "Levorfanol", "I"],
  ["cocaina", "Cocaína", "I"],
  ["cannabis", "Cannabis", "I"],
  ["mariguana", "Cannabis", "I"],
  ["marihuana", "Cannabis", "I"],
  ["tetrahidrocannabinol", "Tetrahidrocannabinol", "I"],
  ["metilfenidato", "Metilfenidato", "II"], // art. 234, pero el catálogo lo lleva como II
  ["methylphenidate", "Metilfenidato", "II"],
  ["heroina", "Heroína", "I"],
  // Marcas (México y EE. UU.)
  ["durogesic", "Fentanilo", "I"],
  ["fentanest", "Fentanilo", "I"],
  ["oxycontin", "Oxicodona", "I"],
  ["percocet", "Oxicodona", "I"], // oxicodona + paracetamol
  ["vicodin", "Hidrocodona", "I"], // hidrocodona + paracetamol
  ["dilaudid", "Hidromorfona", "I"],
  ["demerol", "Petidina (meperidina)", "I"],
  ["palexia", "Tapentadol", "I"],
  ["nucynta", "Tapentadol", "I"],
  ["graten", "Morfina", "I"],
  ["temgesic", "Buprenorfina", "I"],
  ["transtec", "Buprenorfina", "I"],
  ["subutex", "Buprenorfina", "I"],
  ["suboxone", "Buprenorfina", "I"],
  ["ritalin", "Metilfenidato", "II"],
  ["concerta", "Metilfenidato", "II"],
  ["tylex", "Codeína", "II"], // paracetamol + codeína, en el catálogo como II

  // ── Fracción II · psicotrópicos grupo II (art. 245) ──────────────────────
  ["nalbufina", "Nalbufina", "II"],
  ["nalbuphine", "Nalbufina", "II"],
  ["nubain", "Nalbufina", "II"],
  ["butorfanol", "Butorfanol", "II"],
  ["butorphanol", "Butorfanol", "II"],
  ["anfetamina", "Anfetamina", "II"], // anfetamina, dextroanfetamina, metanfetamina, lisdexanfetamina
  ["amphetamine", "Anfetamina", "II"], // amphetamine, lisdexamfetamine
  ["amfetamine", "Anfetamina", "II"],
  ["pseudoefedrina", "Pseudoefedrina", "II"],
  ["pseudoephedrine", "Pseudoefedrina", "II"],
  ["amobarbital", "Amobarbital", "II"],
  ["pentobarbital", "Pentobarbital", "II"],
  ["secobarbital", "Secobarbital", "II"],
  ["ciclobarbital", "Ciclobarbital", "II"],
  ["fenciclidina", "Fenciclidina", "II"],
  ["metacualona", "Metacualona", "II"],
  ["nicergolina", "Nicergolina", "II"],
  ["zolpidem", "Zolpidem", "II"], // en el catálogo como II
  ["stilnox", "Zolpidem", "II"],

  // ── Fracción III · psicotrópicos grupo III (art. 245) ────────────────────
  // Benzodiazepinas con nombre propio (≥7 letras: así les alcanza la tolerancia
  // de una letra: «Clonazepan», «Alprazolan»); después, la terminación genérica.
  ["clonazepam", "Clonazepam", "III"],
  ["diazepam", "Diazepam", "III"],
  ["lorazepam", "Lorazepam", "III"],
  ["alprazolam", "Alprazolam", "III"],
  ["midazolam", "Midazolam", "III"],
  ["triazolam", "Triazolam", "III"],
  ["flunitrazepam", "Flunitrazepam", "III"],
  ["nitrazepam", "Nitrazepam", "III"],
  ["flurazepam", "Flurazepam", "III"],
  ["oxazepam", "Oxazepam", "III"],
  ["temazepam", "Temazepam", "III"],
  ["estazolam", "Estazolam", "III"],
  ["brotizolam", "Brotizolam", "III"],
  // Benzodiazepinas: todas terminan en -zepam o -azolam, salvo las de abajo.
  ["zepam", "Benzodiazepina", "III"], // diazepam, clonazepam, lorazepam, oxazepam, temazepam, flurazepam, nitrazepam…
  ["azolam", "Benzodiazepina", "III"], // alprazolam, midazolam, triazolam, estazolam, brotizolam
  ["bromazepam", "Bromazepam", "III"],
  ["clordiazepoxido", "Clordiazepóxido", "III"],
  ["chlordiazepoxide", "Clordiazepóxido", "III"],
  ["cloracepato", "Cloracepato", "III"],
  ["clorazepato", "Cloracepato", "III"],
  ["clobazam", "Clobazam", "III"],
  ["ketazolam", "Ketazolam", "III"],
  ["zopiclona", "Zopiclona", "III"], // zopiclona, eszopiclona
  ["zopiclone", "Zopiclona", "III"],
  ["ketamina", "Ketamina", "III"], // ketamina, esketamina
  ["ketamine", "Ketamina", "III"],
  ["tramadol", "Tramadol", "III"],
  ["bupropion", "Bupropión", "III"],
  ["anfebutamona", "Bupropión", "III"],
  ["carisoprodol", "Carisoprodol", "III"],
  ["meprobamato", "Meprobamato", "III"],
  ["fentermina", "Fentermina", "III"],
  ["phentermine", "Fentermina", "III"],
  ["anfepramona", "Anfepramona", "III"],
  ["dietilpropion", "Anfepramona", "III"],
  ["clobenzorex", "Clobenzorex", "III"],
  ["fenproporex", "Fenproporex", "III"],
  ["mefenorex", "Mefenorex", "III"],
  ["fendimetrazina", "Fendimetrazina", "III"],
  ["hidratodecloral", "Hidrato de cloral", "III"],
  ["trihexifenidilo", "Trihexifenidilo", "III"],
  ["risperidona", "Risperidona", "III"],
  ["risperidone", "Risperidona", "III"],
  ["clozapina", "Clozapina", "III"],
  ["pimozida", "Pimozida", "III"],
  ["pimozide", "Pimozida", "III"],
  ["efedrina", "Efedrina", "III"],
  ["ergotamina", "Ergotamina", "III"],
  ["ergometrina", "Ergometrina", "III"],
  ["ergonovina", "Ergometrina", "III"],
  ["fenilpropanolamina", "Fenilpropanolamina", "III"],
  ["pemolina", "Pemolina", "III"],
  ["zipeprol", "Zipeprol", "III"],
  // Antidepresivos y antipsicóticos: el catálogo los lleva como III.
  ["fluoxetina", "Fluoxetina", "III"],
  ["fluoxetine", "Fluoxetina", "III"],
  ["sertralina", "Sertralina", "III"],
  ["sertraline", "Sertralina", "III"],
  ["paroxetina", "Paroxetina", "III"],
  ["paroxetine", "Paroxetina", "III"],
  ["citalopram", "Citalopram", "III"], // citalopram, escitalopram
  ["venlafaxina", "Venlafaxina", "III"],
  ["venlafaxine", "Venlafaxina", "III"],
  ["duloxetina", "Duloxetina", "III"],
  ["duloxetine", "Duloxetina", "III"],
  ["mirtazapina", "Mirtazapina", "III"],
  ["mirtazapine", "Mirtazapina", "III"],
  ["trazodona", "Trazodona", "III"],
  ["trazodone", "Trazodona", "III"],
  ["quetiapina", "Quetiapina", "III"],
  ["quetiapine", "Quetiapina", "III"],
  ["olanzapina", "Olanzapina", "III"],
  ["olanzapine", "Olanzapina", "III"],
  ["aripiprazol", "Aripiprazol", "III"],
  ["aripiprazole", "Aripiprazol", "III"],
  ["carbonatodelitio", "Litio", "III"],
  ["litiocarbonato", "Litio", "III"],
  // Marcas (México y EE. UU.)
  ["rivotril", "Clonazepam", "III"],
  ["klonopin", "Clonazepam", "III"],
  ["tafil", "Alprazolam", "III"],
  ["xanax", "Alprazolam", "III"],
  ["valium", "Diazepam", "III"],
  ["ativan", "Lorazepam", "III"],
  ["lexotan", "Bromazepam", "III"],
  ["dormicum", "Midazolam", "III"],
  ["halcion", "Triazolam", "III"],
  ["rohypnol", "Flunitrazepam", "III"],
  ["imovane", "Zopiclona", "III"],
  ["tramal", "Tramadol", "III"],
  ["ultram", "Tramadol", "III"],
  ["nobligan", "Tramadol", "III"],
  ["zaldiar", "Tramadol", "III"],
  ["adolonta", "Tramadol", "III"],
  ["ketalar", "Ketamina", "III"],
  ["wellbutrin", "Bupropión", "III"],
  ["prozac", "Fluoxetina", "III"],
  ["altruline", "Sertralina", "III"],
  ["lexapro", "Citalopram", "III"],
  ["seroquel", "Quetiapina", "III"],
  ["zyprexa", "Olanzapina", "III"],
  ["risperdal", "Risperidona", "III"],

  // ── Fracción IV · barbitúricos de acción larga (art. 245 fr. IV) ─────────
  // Van DESPUÉS de los de acción corta (II): «barbital» está contenido en todos.
  ["fenobarbital", "Fenobarbital", "IV"],
  ["phenobarbital", "Fenobarbital", "IV"],
  ["butalbital", "Butalbital", "IV"],
  ["barbital", "Barbitúrico", "IV"], // barbital, metilfenobarbital, alobarbital, aprobarbital…
  ["tiopental", "Tiopental", "IV"],
  ["thiopental", "Tiopental", "IV"],
  ["pentotal", "Tiopental", "IV"],
];

/**
 * Nombres cortos o que viven dentro de otros medicamentos: solo cuentan como
 * palabra entera («opio» no cae en «opioide»; «tradol» —tramadol en México—
 * no cae en «Ultradol», que es etodolaco).
 */
const PALABRAS_EXACTAS: ReadonlyArray<[palabra: string, nombre: string, grupo: GrupoControlado]> = [
  ["opio", "Opio", "I"],
  ["thc", "Tetrahidrocannabinol", "I"],
  ["litio", "Litio", "III"],
  ["tradol", "Tramadol", "III"],
];

/** Tolerancia mínima de un término para aceptar una letra de diferencia. */
const LARGO_CON_TOLERANCIA = 7;

/**
 * Términos a los que NO se les tolera una letra: a una letra de distancia hay
 * medicamentos de uso diario en un consultorio dental (medido con la prueba
 * «nada IV/V/VI del catálogo cae»).
 *   cocaina  ⇄ procaína («rocaina»), lidocaína («docaina»), benzocaína («zocaina»)
 *   metadona ⇄ dexametasona / betametasona («metasona»)
 */
const SIN_TOLERANCIA = new Set(["cocaina", "metadona"]);

/** Minúsculas, sin acentos ni diéresis, sin signos; `conEspacios` conserva los espacios (uno) para buscar palabras. */
export function normalizarNombre(texto: string, conEspacios = false): string {
  const base = String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return conEspacios
    ? base.replace(/[^a-z0-9]+/g, " ").trim()
    : base.replace(/[^a-z0-9]+/g, "");
}

/**
 * Los dígitos y símbolos que se usan como letras, traducidos. El «1» puede ser
 * «i» o «l» (Fentan1lo / C1onazepam): se devuelven las dos lecturas.
 */
export function lecturasConDigitos(normalizado: string): string[] {
  const base = normalizado.replace(/[0@3457$]/g, (c) => ({ "0": "o", "@": "a", "3": "e", "4": "a", "5": "s", "7": "t", $: "s" })[c] ?? c);
  if (!base.includes("1")) return [base];
  return [base.replace(/1/g, "i"), base.replace(/1/g, "l")];
}

/** ¿`ventana` está a UNA letra (cambiada, sobrante o faltante) de `termino`? Ambas sin espacios. */
function aUnaLetra(ventana: string, termino: string): boolean {
  const a = ventana;
  const b = termino;
  if (a === b) return true;
  const d = a.length - b.length;
  if (d < -1 || d > 1) return false;
  let i = 0;
  let j = 0;
  let usada = false;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (usada) return false;
    usada = true;
    if (d === 0) { i++; j++; } // una letra cambiada
    else if (d === 1) i++;     // una letra sobrante en la ventana
    else j++;                  // una letra faltante en la ventana
  }
  // Lo que quede colgando al final cuenta como la única diferencia.
  return (a.length - i) + (b.length - j) <= (usada ? 0 : 1);
}

/** ¿El texto contiene algo a una letra del término? Ventanas de largo ±1 sobre el texto. */
function contieneCasi(texto: string, termino: string): boolean {
  for (const largo of [termino.length - 1, termino.length, termino.length + 1]) {
    if (largo < 1 || largo > texto.length) continue;
    for (let i = 0; i + largo <= texto.length; i++) {
      if (aUnaLetra(texto.slice(i, i + largo), termino)) return true;
    }
  }
  return false;
}

/**
 * ¿El texto nombra un medicamento controlado? Se revisa el nombre y, si se
 * mandan, la concentración, la forma, la vía y la presentación (un doctor
 * podría escribir «analgésico» de nombre y «tramadol 50 mg» en la
 * presentación). Devuelve el primero que encuentre, con su grupo; `null` si
 * no hay ninguno.
 */
export function detectarControlado(...textos: Array<string | null | undefined>): Controlado | null {
  const junto = textos.filter(Boolean).join(" ");
  if (!junto.trim()) return null;
  const pegado = normalizarNombre(junto);
  // 1 y 2: tal cual y con los dígitos leídos como letras.
  const lecturas = Array.from(new Set([pegado, ...lecturasConDigitos(pegado)]));
  for (const [termino, nombre, grupo] of CONTENIDOS) {
    for (const lectura of lecturas) {
      if (lectura.includes(termino)) return { nombre, grupo };
    }
  }
  const palabras = new Set(normalizarNombre(junto, true).split(" "));
  for (const [palabra, nombre, grupo] of PALABRAS_EXACTAS) {
    if (palabras.has(palabra)) return { nombre, grupo };
  }
  // 3: una letra de tolerancia en los términos largos.
  for (const [termino, nombre, grupo] of CONTENIDOS) {
    if (termino.length < LARGO_CON_TOLERANCIA || SIN_TOLERANCIA.has(termino)) continue;
    for (const lectura of lecturas) {
      if (contieneCasi(lectura, termino)) return { nombre, grupo };
    }
  }
  return null;
}

/** Cuántos términos vigila el candado (para la prueba que fija que la lista no se vacíe por accidente). */
export const TERMINOS_CONTROLADOS = CONTENIDOS.length + PALABRAS_EXACTAS.length;
