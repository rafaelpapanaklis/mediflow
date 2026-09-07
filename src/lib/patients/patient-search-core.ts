/**
 * Búsqueda, cotejo y filtros de PACIENTES — LÓGICA PURA, sin Prisma y sin
 * React. Vive aparte (convención `*-core.ts` de esta carpeta, igual que
 * next-patient-number-core.ts) para poder probarla sin base de datos, y para
 * que el MISMO criterio lo usen el servidor y la pantalla.
 *
 * Sin imports a propósito: lo importa un componente `"use client"`
 * (patients-client.tsx) y tres rutas de API. Si algún día arrastra Prisma,
 * el bundle del navegador se lo lleva.
 *
 * ── LOS BUGS QUE ARREGLA ───────────────────────────────────────────────
 *
 * 31 · GÉNERO. El enum real es `M | F | OTHER` (prisma/schema.prisma:1500),
 *      pero el cajón de filtros mandaba `MALE`/`FEMALE` → Prisma lanzaba
 *      PrismaClientValidationError y la LISTA ENTERA devolvía 500. Y la
 *      columna pintaba `gender === "MALE" ? "M" : "F"`, que nunca es cierto:
 *      todos los hombres salían "F".
 *
 * 38 · BUSCADOR. `mode:"insensitive"` es ILIKE: ignora mayúsculas, NO
 *      acentos, así que "Perez" no encontraba a "Pérez". Y el teléfono se
 *      guarda como lo teclea recepción ("+52 55 1234 5678") pero se buscaba
 *      literal, así que pegar "5512345678" no encontraba a nadie.
 *
 * 37 · DUPLICADOS. El aviso "ya existe este paciente" no saltó nunca.
 *
 * 41 · "Con deuda: Sí" devolvía el padrón entero (el servidor solo miraba
 *      el caso "false").
 */

/* ══════════════════════════════════════════════════════════════════════
 * 31 · GÉNERO
 * ══════════════════════════════════════════════════════════════════════ */

/** El enum `Gender` de la base, tal cual. NO existe "MALE" ni "FEMALE". */
export const PATIENT_GENDERS = ["M", "F", "OTHER"] as const;
export type PatientGender = (typeof PATIENT_GENDERS)[number];

/**
 * Texto → valor del enum, o `null` si no se reconoce.
 *
 * Acepta los alias históricos (`MALE`/`FEMALE`, y el español que usa el
 * importador) porque siguen vivos en URLs guardadas, en pestañas abiertas
 * con el bundle viejo y en el `?gender=MALE` que este mismo cajón mandó
 * durante meses. Devolver `null` en vez de adivinar es lo que impide que un
 * valor basura llegue a Prisma y tumbe la lista con un 500.
 *
 * ⚠️ NO confundir con `parseGender()` de src/lib/import/engine.ts: aquel
 * cae a "OTHER" ante cualquier cosa, que es lo correcto al IMPORTAR una
 * celda de Excel y lo contrario de lo que quiere un FILTRO (filtrar por un
 * valor que el usuario nunca pidió es peor que no filtrar).
 */
export function parsePatientGender(raw: unknown): PatientGender | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (v === "M" || v === "MALE" || v === "MASCULINO" || v === "HOMBRE") return "M";
  if (v === "F" || v === "FEMALE" || v === "FEMENINO" || v === "MUJER") return "F";
  if (v === "OTHER" || v === "O" || v === "OTRO") return "OTHER";
  return null;
}

/**
 * `?gender=MALE,FEMALE` → `["M","F"]`. Ignora lo que no reconoce y quita
 * repetidos. Una lista que quede vacía significa "sin filtro de género" —
 * nunca "ningún género", que dejaría la lista en blanco sin explicación.
 */
export function parseGenderFilter(param: string | null | undefined): PatientGender[] {
  if (!param) return [];
  const out: PatientGender[] = [];
  for (const trozo of param.split(",")) {
    const g = parsePatientGender(trozo);
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * La letra que se pinta junto a la edad en la lista y en las tarjetas.
 * `null` para OTHER y para cualquier valor desconocido: mejor no pintar
 * nada que pintar el sexo equivocado en la ficha de un paciente.
 */
export function genderShortLabel(raw: unknown): "M" | "F" | null {
  const g = parsePatientGender(raw);
  return g === "M" || g === "F" ? g : null;
}

/* ══════════════════════════════════════════════════════════════════════
 * 38 · NORMALIZACIÓN DEL BUSCADOR
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Minúsculas, sin acentos, espacios colapsados. Es el espejo EN JS de la
 * expresión SQL que normaliza la columna (ver patient-search.ts): los dos
 * lados de la comparación pasan por la misma regla, que es lo único que
 * hace que funcione en las dos direcciones —"Perez" encuentra a "Pérez" y
 * "Pérez" encuentra a "Perez"—.
 *
 * Mismo enfoque que el vertical instituto (src/lib/edu/search.ts), donde ya
 * está resuelto y explicado. La diferencia: allí el texto normalizado se
 * GUARDA en una columna; aquí se calcula en la consulta, para no tener que
 * escribir un índice desde las seis rutas que dan de alta pacientes (la
 * importación, el bot de WhatsApp, el portal, la mini-web…), que es donde
 * un índice a medio escribir volvería INVISIBLE a un paciente.
 *
 * ⚠️ "ñ" acaba en "n" y "ü" en "u", a propósito: quien teclea "Munoz"
 * quiere encontrar a Muñoz. Esto no se pinta nunca; el nombre que se
 * muestra sigue siendo el real.
 */
export function normalizePatientText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Solo los dígitos. "+52 55 1234 5678" → "525512345678". */
export function patientDigitsOnly(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\D/g, "");
}

/**
 * Últimos 10 dígitos: la convención de emparejamiento por teléfono que ya
 * usan el bot de WhatsApp (normalizeLast10, booking-parse.ts:23), el Inbox
 * (inbox-log.ts) y el importador (last10, import/engine.ts). Ignora la lada
 * de país, que es justo lo que distingue "+52 55 1234 5678" de
 * "5512345678" sin que sean personas distintas.
 */
export function patientPhoneLast10(raw: unknown): string {
  return patientDigitsOnly(raw).slice(-10);
}

/**
 * Un término de búsqueda ya listo para comparar contra la base.
 *  · `text`   — normalizado (sin acentos, minúsculas) para nombre/correo/folio.
 *  · `digits` — solo dígitos, para el teléfono. "" si el término no trae.
 *  · `last10` — los últimos 10 dígitos, o "" si no llega a 10.
 */
export interface PatientSearchToken {
  text: string;
  digits: string;
  last10: string;
}

/**
 * Los caracteres que LIKE trata como comodín. Se QUITAN del término en vez
 * de escaparlos: no aparecen en un nombre, un correo, un folio ni un
 * teléfono, y dejarlos pasar convertiría un "%" tecleado por accidente en
 * "devuélveme el padrón entero".
 */
function stripLikeWildcards(s: string): string {
  return s.replace(/[%_\\]/g, "");
}

/**
 * "Ana Pérez 55-1234" → tres términos. Se parte por espacios y CADA término
 * tiene que casar en ALGÚN campo (AND de ORs), así que el orden da igual:
 * "Pérez Ana" encuentra lo mismo que "Ana Pérez".
 */
export function patientSearchTokens(query: unknown): PatientSearchToken[] {
  const norm = normalizePatientText(query);
  if (!norm) return [];
  const out: PatientSearchToken[] = [];
  for (const crudo of norm.split(" ")) {
    const text = stripLikeWildcards(crudo);
    if (!text) continue;
    const digits = patientDigitsOnly(crudo);
    out.push({
      text,
      digits,
      last10: digits.length >= 10 ? digits.slice(-10) : "",
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════
 * 41 · FILTRO "CON DEUDA"
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * ¿Este saldo pasa el filtro `?hasDebt=`?
 *
 * El servidor solo tenía rama para "false" (En cero); con "true" (Con
 * deuda) la chip se marcaba como filtro activo y devolvía el padrón
 * completo. Cualquier otro valor —o ninguno— es "sin filtro".
 */
export function matchesDebtFilter(hasDebt: string | null | undefined, balance: number): boolean {
  if (hasDebt === "true") return balance > 0;
  if (hasDebt === "false") return balance === 0;
  return true;
}

/** ¿`?hasDebt=` pide filtrar de verdad? (los dos valores, no solo "false"). */
export function isDebtFilterActive(hasDebt: string | null | undefined): boolean {
  return hasDebt === "true" || hasDebt === "false";
}

/* ══════════════════════════════════════════════════════════════════════
 * 36 · REUSAR EXPEDIENTE AL ACEPTAR UNA SOLICITUD DE LA MINI-WEB
 * ══════════════════════════════════════════════════════════════════════ */

/** Lo mínimo que hace falta de un paciente para decidir si es "el mismo". */
export interface PatientIdentity {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

/**
 * De los pacientes que YA tienen ese teléfono, ¿a cuál pertenece esta
 * solicitud? Devuelve el id, o `null` si no se puede afirmar sin adivinar
 * (y entonces el caller crea expediente nuevo, que es lo que hace hoy).
 *
 * · 0 candidatos  → null (paciente nuevo de verdad).
 * · 1 candidato   → ése. Es el criterio del bot de WhatsApp.
 * · >1 candidatos → el celular de la mamá con dos hijos. Se desempata por
 *   nombre normalizado; si sigue habiendo empate (o ninguno coincide), NO
 *   se elige: enlazar a ciegas metería la cita en el expediente del
 *   hermano equivocado, y eso el doctor no lo detecta hasta la consulta.
 *   Es la misma guarda de ambigüedad que linkOrphanThreadsToPatient.
 */
export function pickExistingPatientForBooking(
  candidatos: PatientIdentity[],
  nombreSolicitud: string,
): string | null {
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0].id;

  const buscado = normalizePatientText(nombreSolicitud);
  const porNombre = candidatos.filter(
    (c) => normalizePatientText(`${c.firstName ?? ""} ${c.lastName ?? ""}`) === buscado,
  );
  return porNombre.length === 1 ? porNombre[0].id : null;
}

/* ══════════════════════════════════════════════════════════════════════
 * 37 · DUPLICADOS AL DAR DE ALTA
 * ══════════════════════════════════════════════════════════════════════ */

/** Los datos del alta que se está intentando. */
export interface PatientDuplicateProbe {
  firstName: string;
  lastName: string;
  phone?: string | null;
}

/**
 * ¿Este paciente que ya existe es, con toda probabilidad, el mismo que se
 * está dando de alta?
 *
 * Dos criterios, los dos exigen el NOMBRE:
 *  1. nombre completo normalizado idéntico ("Ana García" = "ana garcia"),
 *  2. o mismo nombre de pila + mismo teléfono (últimos 10 dígitos), para
 *     cazar "Ana García" vs "Ana Garcia Pérez".
 *
 * El teléfono SOLO no basta a propósito: dos hermanos con el celular de la
 * madre no son un duplicado, y avisar en ese caso enseñaría a recepción a
 * ignorar el aviso — que es exactamente como se pierde una guarda.
 */
export function isProbablePatientDuplicate(
  existente: PatientIdentity,
  alta: PatientDuplicateProbe,
): boolean {
  const nombreExistente = normalizePatientText(`${existente.firstName ?? ""} ${existente.lastName ?? ""}`);
  const nombreAlta = normalizePatientText(`${alta.firstName} ${alta.lastName}`);
  if (!nombreAlta) return false;
  if (nombreExistente === nombreAlta) return true;

  const telExistente = patientPhoneLast10(existente.phone ?? "");
  const telAlta = patientPhoneLast10(alta.phone ?? "");
  if (telExistente.length === 10 && telExistente === telAlta) {
    const pilaExistente = normalizePatientText(existente.firstName ?? "");
    const pilaAlta = normalizePatientText(alta.firstName);
    if (pilaExistente && pilaExistente === pilaAlta) return true;
  }
  return false;
}
