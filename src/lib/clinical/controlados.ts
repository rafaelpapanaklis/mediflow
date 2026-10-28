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
 * Se añaden además las variantes en inglés, las sales (clorhidrato, sulfato…
 * no hacen falta: se busca el nombre base dentro del texto) y las marcas con
 * las que un doctor podría escribirlos en México.
 *
 * Qué grupo se devuelve: el que usa el CATÁLOGO de esta app para ese
 * medicamento (`cums-essentials.ts`), para que el aviso de la pantalla diga lo
 * mismo que dirá la receta al elegirlo del catálogo. Los antidepresivos y
 * antipsicóticos van como III porque así los clasifica el catálogo (más
 * estricto que la fracción IV de la ley); en el candado solo importa que NO se
 * puedan escribir libres.
 *
 * PURO: sin Prisma ni React. Lo usan el servidor y la pantalla.
 */

export type GrupoControlado = "I" | "II" | "III";

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
  // Marcas (México)
  ["durogesic", "Fentanilo", "I"],
  ["fentanest", "Fentanilo", "I"],
  ["oxycontin", "Oxicodona", "I"],
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
  // Marcas (México)
  ["rivotril", "Clonazepam", "III"],
  ["tafil", "Alprazolam", "III"],
  ["valium", "Diazepam", "III"],
  ["ativan", "Lorazepam", "III"],
  ["lexotan", "Bromazepam", "III"],
  ["dormicum", "Midazolam", "III"],
  ["halcion", "Triazolam", "III"],
  ["imovane", "Zopiclona", "III"],
  ["tramal", "Tramadol", "III"],
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
];

/** Nombres cortos: solo cuentan como palabra entera (para no caer en «opioide», «litiasis»…). */
const PALABRAS_EXACTAS: ReadonlyArray<[palabra: string, nombre: string, grupo: GrupoControlado]> = [
  ["opio", "Opio", "I"],
  ["thc", "Tetrahidrocannabinol", "I"],
  ["litio", "Litio", "III"],
];

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
 * ¿El texto nombra un medicamento controlado? Se revisa el nombre y, si se
 * manda, la presentación/notas (un doctor podría escribir «analgésico» de
 * nombre y «tramadol 50 mg» en la presentación). Devuelve el primero que
 * encuentre, con su grupo; `null` si no hay ninguno.
 */
export function detectarControlado(...textos: Array<string | null | undefined>): Controlado | null {
  const junto = textos.filter(Boolean).join(" ");
  if (!junto.trim()) return null;
  const pegado = normalizarNombre(junto);
  for (const [termino, nombre, grupo] of CONTENIDOS) {
    if (pegado.includes(termino)) return { nombre, grupo };
  }
  const palabras = new Set(normalizarNombre(junto, true).split(" "));
  for (const [palabra, nombre, grupo] of PALABRAS_EXACTAS) {
    if (palabras.has(palabra)) return { nombre, grupo };
  }
  return null;
}

/** Cuántos términos vigila el candado (para la prueba que fija que la lista no se vacíe por accidente). */
export const TERMINOS_CONTROLADOS = CONTENIDOS.length + PALABRAS_EXACTAS.length;
