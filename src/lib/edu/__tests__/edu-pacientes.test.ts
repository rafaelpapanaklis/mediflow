/**
 * LOS PACIENTES sin base de datos — Ola 2 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-pacientes.test.ts
 *
 * Lo que fija este archivo son las cuatro cosas que en este repo ya
 * mordieron una vez:
 *  1. el FOLIO normalizado (Postgres distingue mayúsculas y el índice
 *     único es (institutionId, folio));
 *  2. el TELÉFONO normalizado — si se guarda "55 4433 2211" tal cual,
 *     buscar "5544332211" no lo encuentra;
 *  3. la EDAD sin el off-by-one del cumpleaños;
 *  4. el BUSCADOR sin comodines de LIKE: Prisma NO los escapa y buscar "%"
 *     vuelca la tabla entera.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_PATIENT_EMPTY_FILTERS,
  eduAgeYears,
  eduHasPatientFilters,
  eduPatientFullName,
  eduPatientSearchTokens,
  eduPhoneSearchToken,
  normalizeEduEmail,
  normalizeEduFolio,
  normalizeEduPhone,
  parseEduPatientFilters,
  parseEduPatientStatus,
  parseEduSex,
} from "../pacientes-core";
import {
  EDU_PATIENT_STATUSES,
  EDU_PATIENT_STATUS_DESCRIPTIONS,
  EDU_PATIENT_STATUS_LABELS,
  EDU_SEXES,
  EDU_SEX_LABELS,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// 1 · El folio
// ─────────────────────────────────────────────────────────────────────

test("el folio se guarda en MAYÚSCULAS y sin espacios", () => {
  // Sin esto, "p-01" y "P-01" serían dos pacientes con el mismo folio
  // impreso en el expediente de papel: el índice único es de Postgres, que
  // distingue mayúsculas.
  assert.equal(normalizeEduFolio("p-01"), "P-01");
  assert.equal(normalizeEduFolio("  end 2026 07 "), "END202607");
  assert.equal(normalizeEduFolio("P-0001"), "P-0001");
});

test("un folio vacío o larguísimo se rechaza (la columna mide 30)", () => {
  assert.equal(normalizeEduFolio(""), null);
  assert.equal(normalizeEduFolio("   "), null);
  assert.equal(normalizeEduFolio("A".repeat(31)), null);
  assert.equal(normalizeEduFolio("A".repeat(30))?.length, 30);
  assert.equal(normalizeEduFolio(null), null);
  assert.equal(normalizeEduFolio(42), null);
});

// ─────────────────────────────────────────────────────────────────────
// 2 · El teléfono
// ─────────────────────────────────────────────────────────────────────

test("el teléfono se guarda SOLO con dígitos (y el + si venía)", () => {
  assert.equal(normalizeEduPhone("55 4433 2211"), "5544332211");
  assert.equal(normalizeEduPhone("(55) 4433-2211"), "5544332211");
  assert.equal(normalizeEduPhone("+52 55 4433 2211"), "+525544332211");
  assert.equal(normalizeEduPhone(""), null);
  assert.equal(normalizeEduPhone("sin teléfono"), null);
  assert.equal(normalizeEduPhone("1".repeat(31)), null);
});

test("lo que se teclea al buscar se reduce a dígitos, igual que lo guardado", () => {
  // Si el buscador comparara el texto crudo, buscar "55 4433" no
  // encontraría al que está guardado como "5544332211".
  assert.equal(eduPhoneSearchToken("55 4433"), "554433");
  assert.equal(eduPhoneSearchToken("(554)"), "554", "los adornos no cuentan, los dígitos sí");
  assert.equal(eduPhoneSearchToken("juan"), null);
  // Menos de tres dígitos no busca por teléfono: un "55" suelto haría que
  // media agenda coincidiera y el buscador dejaría de servir.
  assert.equal(eduPhoneSearchToken("55"), null);
  assert.equal(eduPhoneSearchToken("(55)"), null);
  assert.equal(eduPhoneSearchToken(null), null);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · El correo
// ─────────────────────────────────────────────────────────────────────

test("el correo se guarda en minúsculas y con una forma mínimamente creíble", () => {
  assert.equal(normalizeEduEmail("  Juan@Ejemplo.MX "), "juan@ejemplo.mx");
  assert.equal(normalizeEduEmail("juan"), null);
  assert.equal(normalizeEduEmail("juan@ejemplo"), null);
  assert.equal(normalizeEduEmail("juan @ejemplo.mx"), null);
  assert.equal(normalizeEduEmail(""), null);
});

// ─────────────────────────────────────────────────────────────────────
// 4 · La edad
// ─────────────────────────────────────────────────────────────────────

test("la edad cuenta años CUMPLIDOS, no milisegundos entre 365 días", () => {
  const hoy = new Date("2026-08-29T12:00:00.000Z");
  assert.equal(eduAgeYears("1990-08-29", hoy), 36, "el día del cumpleaños ya cumplió");
  assert.equal(eduAgeYears("1990-08-30", hoy), 35, "un día antes del cumpleaños, todavía no");
  assert.equal(eduAgeYears("1990-08-28", hoy), 36);
  assert.equal(eduAgeYears("2026-08-29", hoy), 0, "un recién nacido tiene 0, no null");
});

test("los bisiestos no corren la edad un día", () => {
  // Entre 2000 y 2026 hay siete 29 de febrero. Dividir milisegundos entre
  // 365 días se come uno de esos días y equivoca el año en el cumpleaños.
  assert.equal(eduAgeYears("2000-03-01", new Date("2026-02-28T12:00:00.000Z")), 25);
  assert.equal(eduAgeYears("2000-03-01", new Date("2026-03-01T12:00:00.000Z")), 26);
});

test("una fecha ausente o absurda no inventa una edad", () => {
  const hoy = new Date("2026-08-29T12:00:00.000Z");
  assert.equal(eduAgeYears(null, hoy), null);
  assert.equal(eduAgeYears(undefined, hoy), null);
  assert.equal(eduAgeYears("no-es-fecha", hoy), null);
  assert.equal(eduAgeYears("2030-01-01", hoy), null, "nacer en el futuro no da edad negativa");
  assert.equal(eduAgeYears("1800-01-01", hoy), null, "226 años es un dedazo, no un paciente");
});

// ─────────────────────────────────────────────────────────────────────
// 5 · El buscador
// ─────────────────────────────────────────────────────────────────────

test("el buscador quita los comodines de LIKE (Prisma NO los escapa)", () => {
  // Buscar "%" con `contains` pega el texto tal cual dentro de un
  // LIKE '%…%' y devuelve la tabla entera; un término que termina en "\"
  // hace que Postgres tire un error de patrón.
  assert.deepEqual(eduPatientSearchTokens("%"), []);
  assert.deepEqual(eduPatientSearchTokens("_"), []);
  assert.deepEqual(eduPatientSearchTokens("juan%perez"), ["juan", "perez"]);
  assert.deepEqual(eduPatientSearchTokens("garcia\\"), ["garcia"]);
});

test("se piden TODAS las palabras (el nombre y el apellido son dos columnas)", () => {
  assert.deepEqual(eduPatientSearchTokens("juan pe"), ["juan", "pe"]);
  // Máximo tres: es un buscador, no un motor de consultas.
  assert.deepEqual(eduPatientSearchTokens("a b c d e"), ["a", "b", "c"]);
  assert.deepEqual(eduPatientSearchTokens("   "), []);
  assert.deepEqual(eduPatientSearchTokens(null), []);
});

// ─────────────────────────────────────────────────────────────────────
// 6 · Los filtros de la URL
// ─────────────────────────────────────────────────────────────────────

test("los filtros descartan lo que no reconocen en vez de reventar", () => {
  assert.deepEqual(parseEduPatientFilters({ estado: "ACTIVE", origen: "st_1", q: " ana " }), {
    status: "ACTIVE",
    referredByStudentId: "st_1",
    q: "ana",
  });
  assert.deepEqual(parseEduPatientFilters({ estado: "DROP TABLE", origen: "'; --" }), {
    status: null,
    referredByStudentId: null,
    q: null,
  });
  assert.deepEqual(parseEduPatientFilters(null), EDU_PATIENT_EMPTY_FILTERS);
  assert.deepEqual(parseEduPatientFilters(undefined), EDU_PATIENT_EMPTY_FILTERS);
});

test("los filtros NO leen ningún institutionId (el tenant sale de la sesión)", () => {
  // Si esta función lo aceptara, bastaría con teclear `?institutionId=…`
  // para leer los pacientes de otra escuela.
  const f = parseEduPatientFilters({ institutionId: "inst_ajeno" }) as unknown as Record<
    string,
    unknown
  >;
  assert.equal("institutionId" in f, false);
  for (const v of Object.values(f)) assert.notEqual(v, "inst_ajeno");
});

test("eduHasPatientFilters detecta cualquiera de los tres", () => {
  assert.equal(eduHasPatientFilters(EDU_PATIENT_EMPTY_FILTERS), false);
  assert.equal(eduHasPatientFilters({ ...EDU_PATIENT_EMPTY_FILTERS, status: "NEW" }), true);
  assert.equal(eduHasPatientFilters({ ...EDU_PATIENT_EMPTY_FILTERS, q: "ana" }), true);
  assert.equal(
    eduHasPatientFilters({ ...EDU_PATIENT_EMPTY_FILTERS, referredByStudentId: "st_1" }),
    true,
  );
});

// ─────────────────────────────────────────────────────────────────────
// 7 · Enums y etiquetas
// ─────────────────────────────────────────────────────────────────────

test("los enums de paciente solo aceptan sus propios valores", () => {
  assert.equal(parseEduPatientStatus("ACTIVE"), "ACTIVE");
  assert.equal(parseEduPatientStatus("EN_TRATAMIENTO"), null);
  assert.equal(parseEduSex("FEMALE"), "FEMALE");
  assert.equal(parseEduSex("F"), null);
  assert.equal(parseEduSex(1), null);
});

test("la UI nunca tendría que pintar el valor del enum: hay etiqueta para todos", () => {
  for (const s of EDU_PATIENT_STATUSES) {
    assert.ok(EDU_PATIENT_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_PATIENT_STATUS_LABELS[s], s);
    assert.ok(EDU_PATIENT_STATUS_DESCRIPTIONS[s]?.length > 15, `falta la explicación de ${s}`);
  }
  for (const s of EDU_SEXES) {
    assert.ok(EDU_SEX_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_SEX_LABELS[s], s);
  }
  // "Sin especificar" existe a propósito: obligar a elegir en recepción
  // produce datos inventados.
  assert.ok(EDU_SEXES.includes("UNSPECIFIED"));
});

test("el nombre completo no deja el espacio de más cuando falta el apellido", () => {
  assert.equal(eduPatientFullName({ firstName: "Ana", lastName: "López" }), "Ana López");
  assert.equal(eduPatientFullName({ firstName: "Ana", lastName: "" }), "Ana");
  assert.equal(eduPatientFullName({ firstName: "", lastName: "" }), "Sin nombre");
});
