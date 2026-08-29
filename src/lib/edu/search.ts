/**
 * DaleControl INSTITUCIONAL — el BUSCADOR del vertical, sin acentos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"): lo usan las
 * consultas del servidor para ESCRIBIR el índice, los `where` para
 * BUSCARLO, y las pantallas que filtran en memoria (la lista de docentes)
 * para hacer exactamente lo mismo en el navegador.
 *
 * ── EL BUG QUE ARREGLA ─────────────────────────────────────────────────
 * Buscar "Mar" encontraba a "María Elena Rodríguez"; buscar "Rodriguez"
 * SIN acento devolvía CERO, aunque el apellido guardado es "Rodríguez".
 * Nadie escribe acentos en un buscador, así que el producto se sentía
 * roto: el paciente estaba ahí y no aparecía.
 *
 * ── POR QUÉ UNA COLUMNA Y NO `unaccent` DE POSTGRES ────────────────────
 * `unaccent()` existe y sería más corto de escribir, pero solo se puede
 * usar desde SQL crudo: el `contains` de Prisma no admite una función
 * alrededor de la columna. Meter `$queryRaw` en el buscador significaría
 * sacar el `where` del punto único donde hoy vive (padron-core.ts,
 * pacientes.ts, caja.ts) y, con él, el filtro de tenant — que es
 * exactamente el filtro que nadie puede olvidar.
 *
 * Así que se guarda una columna NORMALIZADA ("searchIndex") por fila, se
 * escribe en cada alta y en cada edición, y se busca con el `contains` de
 * siempre. La consulta sigue siendo Prisma tipado, el `where` sigue
 * llevando el institutionId, y las pruebas siguen corriendo sin base.
 *
 * ── LAS DOS DIRECCIONES ────────────────────────────────────────────────
 * Se normalizan LOS DOS lados: lo que se guarda y lo que se teclea. Por eso
 * funciona en las dos direcciones y no solo en una:
 *   · "Rodriguez"  → "rodriguez" ⟶ encuentra a "Rodríguez"  (índice "rodriguez")
 *   · "Rodríguez"  → "rodriguez" ⟶ encuentra a "Rodriguez"  (índice "rodriguez")
 * Y de paso queda insensible a mayúsculas sin `mode: "insensitive"`: los
 * dos lados están ya en minúsculas.
 */

/**
 * Techo del índice, en caracteres. Es el tamaño de la columna
 * (VARCHAR(400)) y se recorta AQUÍ para que una fila larga no reviente el
 * INSERT con un error de Postgres que nadie sabría leer.
 *
 * Con los máximos de las columnas que se indexan (nombre 80 + apellido 80 +
 * correo 160 + folio 30 + teléfono 30 = 380) no se llega nunca; el recorte
 * es un cinturón, no una regla de negocio.
 */
export const EDU_SEARCH_INDEX_MAX = 400;

/**
 * El normalizador. UN solo sitio, y de él salen tanto lo que se guarda como
 * lo que se busca — si fueran dos funciones, tarde o temprano una quitaría
 * la diéresis y la otra no, y el buscador fallaría solo para "Muñoz".
 *
 * Qué hace, en este orden:
 *  1. NFD: descompone "á" en "a" + tilde combinante;
 *  2. borra las marcas combinantes (U+0300–U+036F): tildes, diéresis, la
 *     virgulilla de la ñ y la cedilla de la ç;
 *  3. minúsculas;
 *  4. colapsa los espacios.
 *
 * ⚠️ "ñ" acaba en "n" y "ü" en "u", a propósito: quien busca "Munoz" quiere
 * encontrar a Muñoz. Lo que se PINTA sigue siendo el nombre real — esta
 * columna no se enseña nunca.
 *
 * ⚠️ Lo que NO cubre: las letras que no se descomponen en NFD (ø, đ, ł).
 * No aparecen en un padrón mexicano y añadir un mapa a mano por ellas sería
 * una tabla que nadie mantiene.
 */
export function eduNormalizeSearch(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Solo los dígitos. El teléfono se guarda sin adornos y se busca igual:
 *  quien teclea "55 4433" tiene que encontrar al que se capturó
 *  "5544332211". */
export function eduDigitsOnly(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\D/g, "");
}

/**
 * Arma el valor de la columna a partir de los trozos que se buscan.
 *
 * Se pegan con un espacio y se normaliza el conjunto: el índice es UN
 * texto, así que "juan" y "perez" se encuentran por separado (cada token va
 * en su propio `contains`) y el orden de los trozos no importa.
 */
export function eduSearchIndexOf(parts: Array<string | null | undefined>): string {
  const limpio = parts
    .map((p) => eduNormalizeSearch(p))
    .filter((p) => p.length > 0)
    .join(" ");
  return limpio.slice(0, EDU_SEARCH_INDEX_MAX);
}

// ═══════════════════════════════════════════════════════════════════════
// Un constructor por tabla. Vive aquí y no junto a cada consulta para que
// el alta y la edición de una misma fila no puedan escribir índices
// distintos — que es como se llega a que un paciente sea buscable al
// crearlo y deje de serlo al corregirle el teléfono.
//
// 🔴 CADA UNO SE ALIMENTA SOLO DE SU PROPIA FILA. Ninguno sube por una
// relación: si el índice del alumno llevara el nombre de su EduUser,
// cambiarle el nombre a la persona dejaría la matrícula apuntando a un
// nombre viejo y nadie se enteraría hasta que alguien lo buscara.
// ═══════════════════════════════════════════════════════════════════════

/** edu_users: nombre, apellido, correo y los dígitos del teléfono. */
export function eduUserSearchIndex(u: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  return eduSearchIndexOf([u.firstName, u.lastName, u.email, eduDigitsOnly(u.phone)]);
}

/** edu_students: la matrícula. El nombre del alumno vive en su EduUser y
 *  se busca por ahí (el `where` del padrón mira las dos columnas). */
export function eduStudentSearchIndex(s: { matricula?: string | null }): string {
  return eduSearchIndexOf([s.matricula]);
}

/** edu_patients: folio, nombre, apellido, dígitos del teléfono y correo. */
export function eduPatientSearchIndex(p: {
  folio?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}): string {
  return eduSearchIndexOf([
    p.folio,
    p.firstName,
    p.lastName,
    eduDigitsOnly(p.phone),
    p.email,
  ]);
}

/**
 * ¿Este texto contiene TODOS estos términos? Es el equivalente EN MEMORIA
 * del `where` que se manda a Postgres, para las listas que ya están
 * completas en el navegador (los docentes de una escuela son veinte, pedir
 * un viaje al servidor por cada tecla sería peor).
 *
 * Recibe los tokens YA saneados (eduSearchTokens) para que el navegador y
 * la base partan el término exactamente igual.
 */
export function eduIndexMatches(index: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const heno = eduNormalizeSearch(index);
  return tokens.every((t) => heno.includes(t));
}
