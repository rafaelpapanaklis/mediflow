/**
 * WS1-T3 — pacientes: género, buscador, duplicados y filtro de deuda.
 * Hallazgos 31, 36, 37, 38 y 41.
 *
 * Dos clases de prueba, y las dos hacen falta:
 *
 *  · LÓGICA — sobre las funciones puras de patient-search-core.ts.
 *  · GUARDAS DE REGRESIÓN sobre el CÓDIGO FUENTE — leen el archivo y
 *    comprueban que la expresión rota ya no está. Suena raro para un test,
 *    pero es el patrón que ya usa esta carpeta (ver el último test de
 *    next-patient-number-core.test.ts) y es lo único que atrapa estos cinco
 *    bugs: ninguno vive en una función, todos viven en una expresión suelta
 *    dentro de una ruta de API o de un componente que no se puede montar sin
 *    base de datos ni navegador. Con el código de HOY las nueve guardas
 *    fallan; con el arreglo, pasan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parsePatientGender,
  parseGenderFilter,
  genderShortLabel,
  normalizePatientText,
  patientSearchTokens,
  patientPhoneLast10,
  matchesDebtFilter,
  isDebtFilterActive,
  pickExistingPatientForBooking,
  isProbablePatientDuplicate,
} from "../patient-search-core";
import { buildPatientSearchSql } from "../patient-search";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const RUTA_PACIENTES = "src/app/api/patients/route.ts";
const RUTA_BUSCADOR = "src/app/api/patients/search/route.ts";
const PANTALLA_PACIENTES = "src/app/dashboard/patients/patients-client.tsx";
const MODAL_ALTA = "src/components/dashboard/new-patient-modal.tsx";
const RUTA_SOLICITUDES = "src/app/api/booking-requests/[id]/route.ts";

/* ══════════════════════════════════════════════════════════════════════
 * 31 · GÉNERO — el filtro tiraba la lista, y la columna pintaba "F" a todos
 * ══════════════════════════════════════════════════════════════════════ */

test("31a · el filtro de género traduce al enum real (M/F/OTHER)", () => {
  // Lo que mandaba la pantalla. Estos valores NO existen en el enum `Gender`
  // y hacían que Prisma lanzara → 500 → lista de pacientes en blanco.
  assert.deepEqual(parseGenderFilter("MALE"), ["M"]);
  assert.deepEqual(parseGenderFilter("MALE,FEMALE"), ["M", "F"]);
  // Lo que manda ahora.
  assert.deepEqual(parseGenderFilter("M,F,OTHER"), ["M", "F", "OTHER"]);
  // Repetidos y espacios no rompen nada.
  assert.deepEqual(parseGenderFilter("M, MALE ,M"), ["M"]);
});

test("31a · un valor inventado se TIRA, nunca llega a Prisma", () => {
  // Ésta es la parte que impide que vuelva el 500: un `?gender=' OR 1=1` o un
  // simple typo tiene que quedarse en "sin filtro", no reventar el padrón.
  assert.deepEqual(parseGenderFilter("HOMBRECITO"), []);
  assert.deepEqual(parseGenderFilter("MALE,basura"), ["M"]);
  assert.equal(parsePatientGender(undefined), null);
  assert.equal(parsePatientGender(""), null);
});

test("31a · REGRESIÓN: el cajón de filtros manda M/F, no MALE/FEMALE", () => {
  const src = leer(PANTALLA_PACIENTES);
  assert.ok(
    src.includes('{ v: "M", l: t("patients.drawer.genderMale") }'),
    'el filtro "Masculino" debe mandar "M"',
  );
  assert.ok(
    src.includes('{ v: "F", l: t("patients.drawer.genderFemale") }'),
    'el filtro "Femenino" debe mandar "F"',
  );
  assert.ok(
    !/\{ v: "(MALE|FEMALE)"/.test(src),
    "no debe quedar ningún valor MALE/FEMALE en el cajón de filtros",
  );
});

test("31a · REGRESIÓN: la ruta valida el género antes de dárselo a Prisma", () => {
  const src = leer(RUTA_PACIENTES);
  assert.ok(
    src.includes("parseGenderFilter(sp.get(\"gender\"))"),
    "el parámetro gender debe pasar por parseGenderFilter",
  );
  assert.ok(
    !src.includes('gendersParam.split(",")'),
    "ya no se puede meter el parámetro crudo en el `in` de Prisma",
  );
});

test("31b · la letra del sexo: M es M, F es F, OTHER no pinta nada", () => {
  // El bug: `p.gender === "MALE" ? "M" : "F"` nunca es cierto contra el enum
  // real, así que TODOS los hombres salían "F" en la lista y en las tarjetas.
  assert.equal(genderShortLabel("M"), "M");
  assert.equal(genderShortLabel("F"), "F");
  assert.equal(genderShortLabel("OTHER"), null);
  assert.equal(genderShortLabel(null), null);
  assert.equal(genderShortLabel("basura"), null);
});

test("31b · REGRESIÓN: la pantalla ya no compara contra \"MALE\"", () => {
  const src = leer(PANTALLA_PACIENTES);
  assert.ok(
    !src.includes('p.gender === "MALE"'),
    'p.gender === "MALE" nunca es cierto: pintaba "F" a todos los hombres',
  );
  assert.equal(
    src.split("genderShortLabel(p.gender)").length - 1,
    4,
    "las dos vistas (lista y tarjetas) deben usar genderShortLabel",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 * 38 · BUSCADOR — acentos, teléfono y folio
 * ══════════════════════════════════════════════════════════════════════ */

test("38a · normalizar quita acentos y baja a minúsculas, en los dos sentidos", () => {
  assert.equal(normalizePatientText("Pérez"), "perez");
  assert.equal(normalizePatientText("PEREZ"), "perez");
  assert.equal(normalizePatientText("Muñoz"), "munoz");
  assert.equal(normalizePatientText("  Ana   María  "), "ana maria");
  // Los dos lados por la misma regla: buscar CON acento encuentra lo guardado
  // SIN acento, y al revés. Eso es lo que hacía falta.
  assert.equal(normalizePatientText("Perez"), normalizePatientText("Pérez"));
});

test("38a · los términos se parten por espacios y el orden da igual", () => {
  const t = patientSearchTokens("Ana Pérez");
  assert.deepEqual(t.map((x) => x.text), ["ana", "perez"]);
  assert.deepEqual(patientSearchTokens("Pérez Ana").map((x) => x.text), ["perez", "ana"]);
  // Los comodines de LIKE no pueden entrar: "%" devolvería el padrón entero.
  assert.deepEqual(patientSearchTokens("%").length, 0);
  assert.deepEqual(patientSearchTokens("a%b").map((x) => x.text), ["ab"]);
});

test("38b · el teléfono se compara por los últimos 10 dígitos", () => {
  // Mismo criterio que normalizeLast10 del bot de WhatsApp
  // (src/lib/whatsapp/bot/booking-parse.ts:24), que es de donde se copió.
  assert.equal(patientPhoneLast10("+52 55 1234 5678"), "5512345678");
  assert.equal(patientPhoneLast10("5512345678"), "5512345678");
  assert.equal(patientPhoneLast10("(999) 260-2093"), "9992602093");
  assert.equal(
    patientPhoneLast10("+52 55 1234 5678"),
    patientPhoneLast10("5512345678"),
    "pegar el número sin lada tiene que encontrar al guardado con lada",
  );

  const [tok] = patientSearchTokens("5512345678");
  assert.equal(tok.digits, "5512345678");
  assert.equal(tok.last10, "5512345678");
  // Un teléfono parcial sigue sirviendo para el `contains` de dígitos, pero
  // no para la igualdad de los últimos 10.
  assert.equal(patientSearchTokens("12345678")[0].last10, "");
});

test("38 · la consulta normaliza la fila: acentos, teléfono y FOLIO", () => {
  const sql = buildPatientSearchSql({
    clinicIds: ["clinica_qa_prueba"],
    tokens: patientSearchTokens("perez 5512345678"),
    limit: 30,
  });
  // (a) acentos: translate() sobre la columna, no un ILIKE pelado.
  assert.match(sql.sql, /translate\(lower\(/, "el nombre debe compararse sin acentos");
  // (b) teléfono: dígitos de la columna, y la igualdad de los últimos 10.
  assert.match(sql.sql, /regexp_replace\(coalesce\("phone"/, "el teléfono debe normalizarse");
  assert.match(sql.sql, /right\(regexp_replace/, "y compararse por los últimos 10 dígitos");
  // (c) folio: patientNumber tiene que estar en el texto buscable.
  assert.match(sql.sql, /"patientNumber"/, "se debe poder buscar por folio");
  // El tenant NO se mueve de sitio: la consulta sigue acotada por clínica.
  assert.match(sql.sql, /"clinicId" IN/, "la consulta va acotada por clínica");
  assert.ok(sql.values.includes("clinica_qa_prueba"));
  // Y todo va parametrizado: ni un valor del usuario interpolado en el texto.
  assert.ok(!sql.sql.includes("perez"), "los términos van como parámetros, no en el SQL");
});

test("38c · REGRESIÓN: el buscador de «Nueva cita» mira el folio", () => {
  const src = leer(RUTA_BUSCADOR);
  assert.ok(
    src.includes("patientNumber"),
    "el buscador de Nueva cita no encontraba a nadie por su folio (P0042)",
  );
  assert.ok(
    src.includes("findPatientIdsBySearch"),
    "y tiene que usar la búsqueda normalizada (acentos + teléfono)",
  );
});

test("38 · REGRESIÓN: la lista de pacientes usa la búsqueda normalizada", () => {
  const src = leer(RUTA_PACIENTES);
  assert.ok(src.includes("findPatientIdsBySearch"), "la lista debe buscar sin acentos");
  assert.ok(
    src.includes("matchIds !== null"),
    "y caer al criterio de siempre si la consulta normalizada falla",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 * 41 · FILTRO "CON DEUDA"
 * ══════════════════════════════════════════════════════════════════════ */

test("41 · \"Con deuda: Sí\" filtra de verdad (antes devolvía el padrón entero)", () => {
  assert.equal(matchesDebtFilter("true", 350), true);
  assert.equal(matchesDebtFilter("true", 0), false, "sin saldo NO es 'con deuda'");
  assert.equal(matchesDebtFilter("false", 0), true);
  assert.equal(matchesDebtFilter("false", 350), false);
  // Sin filtro: pasa todo el mundo.
  assert.equal(matchesDebtFilter(null, 350), true);
  assert.equal(matchesDebtFilter("cualquiercosa", 0), true);

  assert.equal(isDebtFilterActive("true"), true);
  assert.equal(isDebtFilterActive("false"), true);
  assert.equal(isDebtFilterActive(null), false);
});

test("41 · REGRESIÓN: la ruta ya no mira solo el caso \"false\"", () => {
  const src = leer(RUTA_PACIENTES);
  assert.ok(
    !src.includes('hasDebt === "false"'),
    'la comparación suelta contra "false" era el bug: con "true" no filtraba nada',
  );
  assert.ok(src.includes("isDebtFilterActive(hasDebt)"), "el post-fetch debe activarse con los dos valores");
  assert.ok(src.includes("matchesDebtFilter(hasDebt, p.balance)"), "y filtrar con los dos");
});

/* ══════════════════════════════════════════════════════════════════════
 * 37 · DUPLICADOS AL DAR DE ALTA
 * ══════════════════════════════════════════════════════════════════════ */

test("37 · el mismo nombre es duplicado, aunque cambien acentos y mayúsculas", () => {
  const existente = { id: "p1", firstName: "Ana", lastName: "García", phone: "55 1234 5678" };
  assert.equal(isProbablePatientDuplicate(existente, { firstName: "Ana", lastName: "García" }), true);
  assert.equal(isProbablePatientDuplicate(existente, { firstName: "ana", lastName: "garcia" }), true);
  assert.equal(isProbablePatientDuplicate(existente, { firstName: "ANA", lastName: "Garcia" }), true);
});

test("37 · mismo nombre de pila + mismo teléfono también es duplicado", () => {
  const existente = { id: "p1", firstName: "Ana", lastName: "García", phone: "+52 55 1234 5678" };
  assert.equal(
    isProbablePatientDuplicate(existente, { firstName: "Ana", lastName: "García Pérez", phone: "5512345678" }),
    true,
    "el apellido escrito a medias no debería crear un expediente nuevo",
  );
});

test("37 · dos hermanos con el celular de la madre NO son un duplicado", () => {
  // Esto es lo que se rompería si el criterio fuera "mismo teléfono" a secas:
  // el aviso saltaría siempre y recepción aprendería a ignorarlo.
  const hermano = { id: "p1", firstName: "Luis", lastName: "García", phone: "55 1234 5678" };
  assert.equal(
    isProbablePatientDuplicate(hermano, { firstName: "Ana", lastName: "García", phone: "5512345678" }),
    false,
  );
});

test("37 · REGRESIÓN: la guarda vive en el servidor y el modal la respeta", () => {
  const ruta = leer(RUTA_PACIENTES);
  assert.ok(ruta.includes('code: "DUPLICATE_PATIENT"'), "el POST debe avisar del duplicado");
  assert.ok(ruta.includes("isProbablePatientDuplicate"), "con el criterio compartido");
  assert.ok(ruta.includes("body.allowDuplicate !== true"), "y dejar seguir a quien confirma");

  const modal = leer(MODAL_ALTA);
  assert.ok(
    !modal.includes("/api/patients?search="),
    "la comprobación previa caía en el handler legacy y devolvía siempre cero",
  );
  assert.ok(modal.includes('data?.code === "DUPLICATE_PATIENT"'), "el modal debe atender el 409");
  assert.ok(modal.includes("shell.newPatient.confirmDuplicate"), "y seguir preguntando lo mismo");
});

/* ══════════════════════════════════════════════════════════════════════
 * 36 · ACEPTAR UNA SOLICITUD NO PUEDE DUPLICAR EL EXPEDIENTE
 * ══════════════════════════════════════════════════════════════════════ */

test("36 · un solo paciente con ese teléfono → se reusa su expediente", () => {
  const id = pickExistingPatientForBooking(
    [{ id: "p1", firstName: "Ana", lastName: "García", phone: "+52 55 1234 5678" }],
    "Ana García",
  );
  assert.equal(id, "p1");
});

test("36 · nadie con ese teléfono → expediente nuevo (null)", () => {
  assert.equal(pickExistingPatientForBooking([], "Ana García"), null);
});

test("36 · dos con el mismo teléfono → desempata el nombre; si no, no adivina", () => {
  const hermanos = [
    { id: "p1", firstName: "Ana", lastName: "García", phone: "5512345678" },
    { id: "p2", firstName: "Luis", lastName: "García", phone: "5512345678" },
  ];
  assert.equal(pickExistingPatientForBooking(hermanos, "Ana García"), "p1");
  assert.equal(pickExistingPatientForBooking(hermanos, "Ana Garcia"), "p1", "sin acentos también");
  // Ninguno coincide: crear uno nuevo es preferible a colgarle la cita al
  // hermano equivocado, que el doctor no detecta hasta la consulta.
  assert.equal(pickExistingPatientForBooking(hermanos, "Pedro García"), null);
});

test("36 · REGRESIÓN: aceptar ya no crea el expediente a ciegas", () => {
  const src = leer(RUTA_SOLICITUDES);
  assert.ok(
    src.includes("findPatientsByWhatsAppPhone"),
    "debe reusar el criterio de teléfono que ya existe, no inventar otro",
  );
  assert.ok(src.includes("pickExistingPatientForBooking"), "y decidir con el helper compartido");
  assert.ok(
    src.includes("if (!paciente) {"),
    "el patient.create tiene que quedar condicionado a que no exista",
  );
});
