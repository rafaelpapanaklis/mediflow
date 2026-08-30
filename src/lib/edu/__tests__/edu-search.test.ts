/**
 * EL BUSCADOR SIN ACENTOS del vertical (Ola 1B), probado SIN base de datos.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-search.test.ts
 *
 * (No hay `npm run test:edu-search`: package.json es un archivo del
 * producto dental y este vertical no lo toca. Cuando se integre a main, es
 * una línea.)
 *
 * ── EL BUG QUE FIJA ESTE ARCHIVO ────────────────────────────────────────
 * Reproducido en producción, en /instituto/pacientes: buscar "Mar"
 * encontraba a "María Elena Rodríguez"; buscar "Rodriguez" SIN acento
 * devolvía CERO, con el apellido "Rodríguez" en la ficha. Nadie escribe
 * acentos en un buscador.
 *
 * ── QUÉ FIJA ────────────────────────────────────────────────────────────
 *  1. que el normalizador quita acentos, ñ, diéresis y mayúsculas;
 *  2. que el índice de CADA tabla lleva lo que se busca en ella;
 *  3. las CUATRO búsquedas del reporte: "Rodriguez", "rodríguez", "MARIA" y
 *     "P-0001", todas encontrando a la misma paciente;
 *  4. que funciona en las DOS direcciones (buscar con acento encuentra al
 *     que se guardó sin él);
 *  5. que el `where` que se le manda a Prisma mira SOLO la columna
 *     normalizada — mirar `firstName` con `mode: "insensitive"` es
 *     exactamente el bug que había.
 *
 * ── HASTA DÓNDE LLEGA ───────────────────────────────────────────────────
 * Aquí no hay Postgres. El `where` se comprueba con un intérprete mínimo
 * (la función `cumple`) contra filas de mentira, igual que en
 * edu-padron.test.ts. Lo que NO prueba: que el .sql de backfill deje las
 * filas viejas con el mismo texto que escribe la aplicación. Eso solo lo
 * demuestra una base de datos de verdad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_SEARCH_INDEX_MAX,
  eduDigitsOnly,
  eduIndexMatches,
  eduNormalizeSearch,
  eduPatientSearchIndex,
  eduSearchIndexOf,
  eduStudentSearchIndex,
  eduUserSearchIndex,
} from "../search";
import { eduSearchTokens } from "../padron-core";
import { eduPatientSearchAnd } from "../pacientes-core";

// ═══════════════════════════════════════════════════════════════════════
// LA PACIENTE DEL REPORTE
// ═══════════════════════════════════════════════════════════════════════

const MARIA = {
  folio: "P-0001",
  firstName: "María Elena",
  lastName: "Rodríguez Gómez",
  phone: "+525544332211",
  email: "maria@correo.mx",
};

/** ¿Este texto encuentra a la paciente? Es lo mismo que hará Postgres: se
 *  parte el término en palabras y se piden TODAS contra el índice. */
function encuentra(termino: string, indice = eduPatientSearchIndex(MARIA)): boolean {
  const tokens = eduSearchTokens(termino);
  if (tokens.length === 0) return false;
  return eduIndexMatches(indice, tokens);
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL NORMALIZADOR
// ═══════════════════════════════════════════════════════════════════════

test("quita tildes, diéresis, ñ y cedilla, y baja a minúsculas", () => {
  assert.equal(eduNormalizeSearch("Rodríguez"), "rodriguez");
  assert.equal(eduNormalizeSearch("MARÍA"), "maria");
  assert.equal(eduNormalizeSearch("Muñoz"), "munoz");
  assert.equal(eduNormalizeSearch("Güemes"), "guemes");
  assert.equal(eduNormalizeSearch("Gonçalves"), "goncalves");
  assert.equal(eduNormalizeSearch("ÁÉÍÓÚ áéíóú"), "aeiou aeiou");
});

test("colapsa los espacios y recorta las puntas", () => {
  assert.equal(eduNormalizeSearch("  Juan   Pérez  "), "juan perez");
  assert.equal(eduNormalizeSearch("\t Ana \n López "), "ana lopez");
});

test("lo que no es texto devuelve cadena vacía en vez de reventar", () => {
  assert.equal(eduNormalizeSearch(null), "");
  assert.equal(eduNormalizeSearch(undefined), "");
  assert.equal(eduNormalizeSearch(42 as unknown as string), "");
  assert.equal(eduNormalizeSearch({} as unknown as string), "");
});

test("los dígitos del teléfono salen sin adornos", () => {
  assert.equal(eduDigitsOnly("+52 (55) 4433-2211"), "525544332211");
  assert.equal(eduDigitsOnly(null), "");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · LAS CUATRO BÚSQUEDAS DEL REPORTE
// ═══════════════════════════════════════════════════════════════════════

test('🔴 "Rodriguez" SIN acento encuentra a "Rodríguez" (el bug reportado)', () => {
  assert.equal(encuentra("Rodriguez"), true);
});

test('🔴 "rodríguez" CON acento y en minúsculas también la encuentra', () => {
  assert.equal(encuentra("rodríguez"), true);
});

test('🔴 "MARIA" en mayúsculas y sin acento encuentra a "María"', () => {
  assert.equal(encuentra("MARIA"), true);
});

test('🔴 "P-0001" encuentra por folio (y "p-0001" en minúsculas también)', () => {
  assert.equal(encuentra("P-0001"), true);
  assert.equal(encuentra("p-0001"), true);
});

test("las dos direcciones: quien se guardó SIN acento se encuentra CON acento", () => {
  // El caso simétrico del reportado, y el que se olvida: la recepcionista
  // capturó "Rodriguez" sin acento y quien busca sí lo escribe.
  const sinAcento = eduPatientSearchIndex({ ...MARIA, lastName: "Rodriguez Gomez" });
  assert.equal(encuentra("Rodríguez", sinAcento), true);
  assert.equal(encuentra("Gómez", sinAcento), true);
});

test("se piden TODAS las palabras: nombre y apellido juntos, en cualquier orden", () => {
  assert.equal(encuentra("maria rodriguez"), true);
  assert.equal(encuentra("rodriguez maria"), true);
  assert.equal(encuentra("Mar"), true, "la búsqueda que SÍ funcionaba tiene que seguir funcionando");
  assert.equal(encuentra("maria beltran"), false, "un apellido que no es suyo no la trae");
});

test("el teléfono se encuentra tecleado como lo dicta la gente", () => {
  // El índice guarda SOLO dígitos, así que el número entero y los trozos
  // separados por espacios se encuentran tal cual. Lo que trae adornos
  // ("55-4433") lo resuelve el `where`, no el índice: se prueba abajo.
  assert.equal(encuentra("5544332211"), true);
  assert.equal(encuentra("4433 2211"), true);
});

test("el correo también entra al índice del paciente", () => {
  assert.equal(encuentra("maria@correo.mx"), true);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · QUÉ LLEVA EL ÍNDICE DE CADA TABLA
// ═══════════════════════════════════════════════════════════════════════

test("el índice del paciente lleva folio, nombre, apellido, dígitos y correo", () => {
  assert.equal(
    eduPatientSearchIndex(MARIA),
    "p-0001 maria elena rodriguez gomez 525544332211 maria@correo.mx",
  );
});

test("el índice de una cuenta lleva nombre, apellido, correo y dígitos", () => {
  assert.equal(
    eduUserSearchIndex({
      firstName: "Ana Sofía",
      lastName: "Núñez",
      email: "ANA@instituto.mx",
      phone: "55 1122 3344",
    }),
    "ana sofia nunez ana@instituto.mx 5511223344",
  );
});

test("el índice del alumno lleva SOLO la matrícula (el nombre es de su cuenta)", () => {
  // 🔴 Si arrastrara el nombre de su EduUser, renombrar a la persona
  // dejaría la matrícula pegada a un nombre viejo y nadie se enteraría.
  assert.equal(eduStudentSearchIndex({ matricula: "ENDO-2026-01" }), "endo-2026-01");
});

test("los trozos vacíos o nulos no dejan espacios de más", () => {
  assert.equal(eduSearchIndexOf(["Juan", null, "", "  ", "Pérez"]), "juan perez");
  assert.equal(eduSearchIndexOf([]), "");
  assert.equal(eduUserSearchIndex({ firstName: "Ana", lastName: "Ruiz" }), "ana ruiz");
});

test("un índice larguísimo se recorta al tamaño de la columna", () => {
  const largo = eduSearchIndexOf([("ana ").repeat(300)]);
  assert.equal(largo.length <= EDU_SEARCH_INDEX_MAX, true);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS TÉRMINOS QUE SE LE MANDAN A POSTGRES
// ═══════════════════════════════════════════════════════════════════════

test("los términos salen ya normalizados (si no, solo se arregla la mitad)", () => {
  // Ésta es la otra mitad de la corrección: normalizar la columna y NO el
  // término dejaría el bug igual de roto, solo que al revés.
  assert.deepEqual(eduSearchTokens("Rodríguez"), ["rodriguez"]);
  assert.deepEqual(eduSearchTokens("MARÍA ELENA"), ["maria", "elena"]);
});

test("se siguen quitando los comodines de LIKE (Prisma NO los escapa)", () => {
  assert.deepEqual(eduSearchTokens("%"), []);
  assert.deepEqual(eduSearchTokens("%juan%"), ["juan"]);
  assert.deepEqual(eduSearchTokens("a_b"), ["a", "b"]);
  assert.deepEqual(eduSearchTokens("juan\\"), ["juan"]);
  assert.deepEqual(eduSearchTokens("   "), []);
  assert.deepEqual(eduSearchTokens(null), []);
  // Máximo tres palabras: es un buscador, no un motor de consultas.
  assert.deepEqual(eduSearchTokens("uno dos tres cuatro"), ["uno", "dos", "tres"]);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL `where` DE PACIENTES
//
// Un intérprete mínimo del where —el mismo enfoque que edu-padron.test.ts—
// para comprobar contra filas de mentira que la consulta encuentra lo que
// tiene que encontrar. NO es Prisma: entiende AND, OR y `contains`, que es
// todo lo que este where usa.
// ═══════════════════════════════════════════════════════════════════════

type Cualquiera = Record<string, unknown>;

function cumple(fila: Cualquiera, where: unknown): boolean {
  if (where === null || typeof where !== "object") return false;
  for (const [clave, cond] of Object.entries(where as Cualquiera)) {
    if (clave === "AND") {
      if (!(cond as unknown[]).every((w) => cumple(fila, w))) return false;
      continue;
    }
    if (clave === "OR") {
      if (!(cond as unknown[]).some((w) => cumple(fila, w))) return false;
      continue;
    }
    const valor = fila[clave];
    if (cond && typeof cond === "object" && "contains" in (cond as Cualquiera)) {
      const op = cond as Cualquiera;
      const texto = String(valor ?? "");
      const aguja = String(op.contains);
      const ok =
        op.mode === "insensitive"
          ? texto.toLowerCase().includes(aguja.toLowerCase())
          : texto.includes(aguja);
      if (!ok) return false;
      continue;
    }
    if (valor !== cond) return false;
  }
  return true;
}

const FILA = { searchIndex: eduPatientSearchIndex(MARIA) };

function busca(q: string): boolean {
  const and = eduPatientSearchAnd(q);
  if (and.length === 0) return false;
  return cumple(FILA, { AND: and });
}

test("🔴 el where de pacientes encuentra por las cuatro vías del reporte", () => {
  assert.equal(busca("Rodriguez"), true);
  assert.equal(busca("rodríguez"), true);
  assert.equal(busca("MARIA"), true);
  assert.equal(busca("P-0001"), true);
});

test("🔴 el where NO mira firstName ni lastName: solo la columna normalizada", () => {
  // Si alguien vuelve a meter `{ firstName: { contains, mode:"insensitive" } }`
  // el bug vuelve, porque `mode` arregla las mayúsculas y NO los acentos.
  // Esta prueba lo caza: la fila de mentira NO tiene esas columnas, así que
  // un where que las mirara dejaría de encontrar nada.
  const claves = new Set<string>();
  for (const clausula of eduPatientSearchAnd("maria rodriguez 5544")) {
    for (const rama of (clausula as { OR: Cualquiera[] }).OR) {
      for (const k of Object.keys(rama)) claves.add(k);
    }
  }
  assert.deepEqual(Array.from(claves), ["searchIndex"]);
});

test("el where reduce a dígitos un término con adornos (55-4433)", () => {
  // Sin esta rama, teclear el teléfono como lo dicta la gente no
  // encontraría a nadie: el índice lo guarda sin guiones.
  assert.equal(busca("55-4433"), true);
  assert.equal(busca("55-4433 2211"), true);
  // ⚠️ Un trozo que se queda en MENOS de tres dígitos no cuenta como
  // teléfono, y está bien que no cuente: "55" aparecería en media clínica.
  // Es el umbral de eduPhoneSearchToken y esta prueba lo deja escrito.
  assert.equal(busca("(55)"), false);
});

test("el where de pacientes exige TODAS las palabras", () => {
  assert.equal(busca("maria rodriguez"), true);
  assert.equal(busca("maria beltran"), false);
});

test("un término que se queda en nada no genera filtro (y no trae la tabla)", () => {
  assert.deepEqual(eduPatientSearchAnd("%"), []);
  assert.deepEqual(eduPatientSearchAnd(null), []);
  assert.deepEqual(eduPatientSearchAnd("   "), []);
});
