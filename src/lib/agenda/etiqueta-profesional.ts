// Cómo se rotula a un profesional en la Agenda (revisión de ws1-t10, 2-oct-2026). PURO.
//
// Antes: «Dr. » + la primera palabra del nombre. Salía «Dr. Dr» (el título ya venía escrito en el nombre),
// «Dr. Cuenta» para el dueño y tres «Dr. QA» en el mismo selector; las columnas, con las iniciales de eso,
// repetían «DC». El usuario no tiene campo de tratamiento ni de género (ver `nombre-profesional.ts`), así que
// no se le inventa título: se usa el nombre tal como está en Equipo, y si alguien escribió «Dra.» en su nombre,
// así sale.
//
//  - `nombre`: el nombre visible completo («Mariana Cortés López»). Selectores (Nueva cita, Buscar espacio…).
//  - `corto`:  nombre de pila + inicial del apellido («Mariana C.»), para columnas y carriles. Si dos chocan,
//              se alarga solo a esos dos: apellido entero → nombre completo → número.
//
// Las dos son ÚNICAS dentro de la lista que se les pasa (el padrón de la clínica).

import { nombreDeProfesional, type ProfesionalConNombre } from "@/lib/nombre-profesional";

/** Títulos que no distinguen a nadie: no cuentan como «nombre de pila» en la etiqueta corta. */
const TITULO = /^(dr|dra|dr\(a\)|dr\/a|doc|doctor|doctora|lic|lica|licda|lcda|mtro|mtra|ing)\.?$/i;

function palabras(v: string | null | undefined): string[] {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function comparable(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Las formas de nombrarlo, de la más corta a la más larga (sin repetidos). La primera es la etiqueta corta
 * «base»: la que sale sin mirar a nadie más (la usa la cita suelta, que no trae el padrón).
 */
function formas(p: ProfesionalConNombre): string[] {
  let pila = palabras(p.firstName).filter((w) => !TITULO.test(w));
  let apellidos = palabras(p.lastName).filter((w) => !TITULO.test(w));
  // «Dr» como nombre y todo lo demás en el apellido: el nombre de pila es lo primero que no sea título.
  if (pila.length === 0) {
    pila = apellidos.slice(0, 1);
    apellidos = apellidos.slice(1);
  }
  const completo = nombreDeProfesional(p);
  const salida: string[] = [];
  const agrega = (s: string) => {
    if (s && !salida.includes(s)) salida.push(s);
  };
  if (pila.length > 0) {
    const ap = apellidos[0];
    agrega(ap ? `${pila[0]} ${ap[0]!.toUpperCase()}.` : pila[0]!);
    if (ap) agrega(`${pila[0]} ${ap}`);
    agrega([...pila, ...apellidos].join(" "));
  }
  agrega(completo);
  if (salida.length === 0) salida.push("Profesional");
  return salida;
}

/** La etiqueta corta de UNA persona sin mirar a nadie más («Mariana C.»). */
export function etiquetaCortaProfesional(p: ProfesionalConNombre | null | undefined): string {
  return p ? formas(p)[0]! : "Profesional";
}

/**
 * Elige, para cada id, la forma más corta que no se repita en la lista. Solo se alargan los que chocan; si
 * ni el nombre completo los separa, se numeran («Juan Pérez 2») en el orden de la lista (estable).
 */
function unicas(lista: ReadonlyArray<{ id: string; formas: string[] }>): Map<string, string> {
  const nivel = new Map(lista.map((x) => [x.id, 0]));
  const actual = (x: { id: string; formas: string[] }) => x.formas[Math.min(nivel.get(x.id)!, x.formas.length - 1)]!;
  for (;;) {
    const grupos = new Map<string, Array<{ id: string; formas: string[] }>>();
    for (const x of lista) {
      const k = comparable(actual(x));
      grupos.set(k, [...(grupos.get(k) ?? []), x]);
    }
    let avanzo = false;
    for (const g of Array.from(grupos.values())) {
      if (g.length < 2) continue;
      for (const x of g) {
        if (nivel.get(x.id)! < x.formas.length - 1) {
          nivel.set(x.id, nivel.get(x.id)! + 1);
          avanzo = true;
        }
      }
    }
    if (!avanzo) break;
  }
  const salida = new Map<string, string>();
  const vistos = new Map<string, number>();
  for (const x of lista) {
    const s = actual(x);
    const k = comparable(s);
    const n = (vistos.get(k) ?? 0) + 1;
    vistos.set(k, n);
    salida.set(x.id, n === 1 ? s : `${s} ${n}`);
  }
  return salida;
}

export interface EtiquetasProfesional {
  /** Nombre visible completo, único en la lista. Para selectores. */
  nombre: string;
  /** «Mariana C.», alargado solo si choca. Para columnas, carriles y su chip de iniciales. */
  corto: string;
}

/** Las dos etiquetas de cada profesional del padrón, únicas dentro de él. */
export function etiquetasDeProfesionales(
  lista: ReadonlyArray<ProfesionalConNombre & { id: string }>,
): Map<string, EtiquetasProfesional> {
  const cortos = unicas(lista.map((p) => ({ id: p.id, formas: formas(p) })));
  const nombres = unicas(lista.map((p) => ({ id: p.id, formas: [nombreDeProfesional(p) || "Profesional"] })));
  return new Map(lista.map((p) => [p.id, { nombre: nombres.get(p.id)!, corto: cortos.get(p.id)! }]));
}
