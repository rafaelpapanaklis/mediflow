/**
 * DaleControl INSTITUCIONAL — la ficha de un ESTUDIANTE.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-estudiante.test.ts
 *       (o `npm run test:edu`, que descubre este archivo solo)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ SE PRUEBA Y POR QUÉ AQUÍ
 *
 * La ficha del estudiante es la primera pantalla del vertical que cruza LOS
 * DOS alcances: el académico (¿puedo abrir esta carpeta?) y el clínico (¿qué
 * papeles de dentro me tocan?). Todo lo que puede fallar en silencio vive en
 * un `where`, y por eso los `where` están en un módulo PURO: se comprueban
 * aquí, sin base, sin sesión y sin levantar Postgres.
 *
 * Lo que se prueba es lo que NO daría error si estuviera mal:
 *
 *   · el `institutionId`, que si falta NO filtra — Prisma descarta la clave
 *     y devuelve las filas de todos los institutos. Cero excepciones, cero
 *     pantalla roja: solo los pacientes de la escuela de al lado;
 *   · ALUMNO y CAJA, que tienen que salir con 404 y no con media ficha;
 *   · el recorte del DOCENTE, que cuelga de una asignación VIGENTE — y la
 *     vigencia se prueba en el BORDE, que es donde se rompe;
 *   · las tres vías de "paciente atendido", por separado y combinadas;
 *   · el tope, que tiene que devolver 300 y decir que había más.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_ESTUDIANTE_MAX_PACIENTES,
  eduEstudianteFichaWhere,
  eduEstudiantePacientesOrden,
  eduEstudiantePacientesWhere,
  type EduEstudiantePacienteRow,
} from "../estudiante-core";
import { eduPadronScope } from "../padron-core";
import { eduPatientScopeWhere, eduVisibility } from "../visibility";
import type { EduRole } from "../types";

const INST = "inst_1";
const AHORA = new Date("2026-03-15T18:00:00.000Z");
const ROLES: EduRole[] = ["DIRECCION", "DOCENTE", "ALUMNO", "CAJA"];

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

/** Recorre un objeto y dice si `institutionId` aparece en el nivel de arriba. */
function tieneTenant(where: Record<string, unknown>): boolean {
  return typeof where.institutionId === "string" && where.institutionId.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · QUIÉN ABRE LA FICHA
// ═══════════════════════════════════════════════════════════════════════

test("ALUMNO y CAJA no abren NINGUNA ficha de estudiante (404, no media ficha)", () => {
  // Es eduPadronScope quien lo decide, y la ficha ni consulta cuando es
  // "none". Un alumno no abre ni la suya: su avance lo ve en su bitácora.
  assert.equal(eduPadronScope(actor("ALUMNO")).kind, "none");
  assert.equal(eduPadronScope(actor("CAJA")).kind, "none");
  assert.equal(eduPadronScope(actor("DIRECCION")).kind, "all");
  assert.equal(eduPadronScope(actor("DOCENTE")).kind, "supervised");
});

test("un DOCENTE sin eduUserId cae en 'none', no en 'all'", () => {
  // La opción segura es la que NO filtra datos. Sin id no hay a quién
  // atribuirle alumnos.
  assert.equal(eduPadronScope({ role: "DOCENTE", eduUserId: "" }).kind, "none");
});

test("el where de la ficha lleva SIEMPRE institutionId, con los cuatro roles", () => {
  for (const role of ROLES) {
    const scope = eduPadronScope(actor(role));
    const where = eduEstudianteFichaWhere({
      institutionId: INST,
      scope,
      studentId: "st_1",
      now: AHORA,
    });
    assert.ok(
      tieneTenant(where as Record<string, unknown>),
      `${role}: el where salió sin institutionId — un undefined ahí devuelve el padrón de TODOS los institutos`,
    );
    assert.equal(where.id, "st_1", `${role}: el where perdió el id del alumno`);
  }
});

test("sin institutionId el where LANZA (no devuelve un objeto a medias)", () => {
  assert.throws(
    () =>
      eduEstudianteFichaWhere({
        institutionId: "",
        scope: { kind: "all" },
        studentId: "st_1",
        now: AHORA,
      }),
    /institutionId/,
  );
});

test("DIRECCION no arrastra recorte por supervisor; DOCENTE sí", () => {
  const dir = eduEstudianteFichaWhere({
    institutionId: INST,
    scope: eduPadronScope(actor("DIRECCION")),
    studentId: "st_1",
    now: AHORA,
  });
  assert.equal(dir.supervisors, undefined, "dirección no debería llevar filtro de supervisores");

  const doc = eduEstudianteFichaWhere({
    institutionId: INST,
    scope: eduPadronScope(actor("DOCENTE", "u_doc")),
    studentId: "st_1",
    now: AHORA,
  });
  const some = (doc.supervisors as { some: Record<string, unknown> } | undefined)?.some;
  assert.ok(some, "un docente TIENE que llevar el recorte por asignación");
  assert.equal(some.supervisorUserId, "u_doc");
  assert.equal(some.institutionId, INST, "la relación repite el tenant a propósito");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA VIGENCIA, EN EL BORDE
// ═══════════════════════════════════════════════════════════════════════

test("la asignación del docente se comprueba en el BORDE: endsAt justo antes y justo después", () => {
  const doc = eduEstudianteFichaWhere({
    institutionId: INST,
    scope: eduPadronScope(actor("DOCENTE", "u_doc")),
    studentId: "st_1",
    now: AHORA,
  });
  const some = (doc.supervisors as { some: Record<string, unknown> }).some;

  // El predicado que viaja a Prisma: startsAt <= T && (endsAt == null || endsAt > T)
  assert.deepEqual(some.startsAt, { lte: AHORA });
  assert.deepEqual(some.OR, [{ endsAt: null }, { endsAt: { gt: AHORA } }]);

  // Y lo que ese predicado significa en los dos bordes, escrito a mano para
  // que se lea: una cerrada UN MILISEGUNDO antes de `now` ya NO cuenta; una
  // que cierra un milisegundo después, sí. Cerrar es escribir endsAt = ahora,
  // así que con `>=` el docente saliente y el entrante estarían vigentes a la
  // vez durante ese instante.
  const justoAntes = new Date(AHORA.getTime() - 1);
  const justoDespues = new Date(AHORA.getTime() + 1);
  const gt = (some.OR as { endsAt: { gt: Date } | null }[])[1].endsAt as { gt: Date };
  assert.equal(justoAntes.getTime() > gt.gt.getTime(), false, "cerrada antes: NO vigente");
  assert.equal(justoDespues.getTime() > gt.gt.getTime(), true, "cierra después: vigente");
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · LAS TRES VÍAS DE "PACIENTE ATENDIDO"
// ═══════════════════════════════════════════════════════════════════════

/** Las tres opciones del OR, en el orden en que las escribe el módulo. */
function vias(studentId = "st_1", role: EduRole = "DIRECCION") {
  const scope = eduVisibility(actor(role, "u_1"), "patients");
  const where = eduEstudiantePacientesWhere({
    institutionId: INST,
    clinico: eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA }),
    studentId,
  });
  // El AND se arma en un orden FIJO: [0] el alcance clínico de quien mira,
  // [1] las tres vías. Se accede por posición y no buscando "el que tiene un
  // OR" porque el alcance clínico de un DOCENTE también trae su propio OR —
  // buscar por forma encuentra el equivocado.
  const and = where.AND as Record<string, unknown>[];
  const clinico = and[0];
  const tresVias = and[1] as { OR: Record<string, unknown>[] };
  return { where, and, clinico, or: tresVias.OR };
}

test("un paciente entra por CASO, por CITA o porque lo TRAJO — las tres, por separado", () => {
  const { or } = vias();
  assert.equal(or.length, 3, "son exactamente tres vías, ni una más");

  // (a) un caso suyo
  assert.deepEqual(or[0], { cases: { some: { institutionId: INST, studentId: "st_1" } } });
  // (b) una cita suya — existe ANTES que el caso (la de tamizaje lo abre),
  //     así que sin ella el alumno que valora no aparecería atendiendo a
  //     quien tiene enfrente
  assert.deepEqual(or[1], { appointments: { some: { institutionId: INST, studentId: "st_1" } } });
  // (c) "lo trajo"
  assert.deepEqual(or[2], { referredByStudentId: "st_1" });
});

test("las tres vías van en OR y el alcance clínico en AND — combinadas, sin duplicar", () => {
  const { where, and, or } = vias();

  // El tenant, arriba del todo y otra vez dentro de cada relación.
  assert.equal(where.institutionId, INST);
  // Las tres vías son UNA sola cláusula: la consulta devuelve PACIENTES, no
  // cruces, así que quien cumple las tres es UNA fila con tres banderas y no
  // tres filas. Es lo que hace imposible el duplicado.
  assert.equal(or.length, 3);
  assert.equal(and.length, 2, "sin búsqueda son exactamente dos: alcance + vías");
  for (const rama of or) {
    const clave = Object.keys(rama)[0];
    assert.ok(
      ["cases", "appointments", "referredByStudentId"].includes(clave),
      `rama inesperada en el OR: ${clave}`,
    );
  }

  // Y el alcance clínico viaja como hermano del OR, no fundido con él: si se
  // mezclaran, una de las vías podría dejar pasar lo que el alcance acababa
  // de cerrar.
  assert.ok(
    tieneTenant(and[0]),
    "el alcance clínico tiene que ir en su propia cláusula del AND, con su tenant",
  );
});

test("el alcance de quien mira se APILA: un DOCENTE no hereda el llavero del alumno", () => {
  const { clinico, or } = vias("st_1", "DOCENTE");
  // eduPatientScopeWhere de un DOCENTE trae su propio OR de casos/citas
  // acotado por SUS alumnos vigentes. Tiene que llegar ENTERO y con tenant.
  assert.ok(tieneTenant(clinico));
  assert.ok(
    Array.isArray(clinico.OR),
    "el recorte del docente tiene que llegar entero, no aplanado",
  );
  // Y el supervisor del docente tiene que aparecer dentro de ese recorte:
  // es lo que impide que la ficha de un alumno suyo le abra pacientes que
  // ese alumno atendió bajo otro titular.
  assert.ok(
    JSON.stringify(clinico).includes("supervisorUserId"),
    "el recorte del docente tiene que colgar de su asignación",
  );
  // Las tres vías siguen intactas al lado.
  assert.equal(or.length, 3);
});

test("sin institutionId o sin studentId, el where de pacientes LANZA", () => {
  const clinico = eduPatientScopeWhere({ institutionId: INST, scope: { kind: "all" }, now: AHORA });
  assert.throws(
    () => eduEstudiantePacientesWhere({ institutionId: "", clinico, studentId: "st_1" }),
    /institutionId/,
  );
  assert.throws(
    () => eduEstudiantePacientesWhere({ institutionId: INST, clinico, studentId: "" }),
    /studentId/,
    "sin studentId las tres vías dejarían pasar a TODOS los pacientes del alcance",
  );
});

test("el buscador es el de la lista de pacientes, no uno nuevo", () => {
  const clinico = eduPatientScopeWhere({ institutionId: INST, scope: { kind: "all" }, now: AHORA });
  const sin = eduEstudiantePacientesWhere({ institutionId: INST, clinico, studentId: "st_1" });
  const con = eduEstudiantePacientesWhere({
    institutionId: INST,
    clinico,
    studentId: "st_1",
    q: "Rodríguez",
  });
  const nSin = (sin.AND as unknown[]).length;
  const nCon = (con.AND as unknown[]).length;
  assert.ok(nCon > nSin, "la búsqueda tiene que añadir cláusulas al AND");

  // Y mira la columna NORMALIZADA (sin acentos, en minúsculas): comparar
  // contra firstName con `contains` es como "Rodriguez" no encontraba a
  // "Rodríguez".
  const json = JSON.stringify(con);
  assert.ok(json.includes("searchIndex"), "el buscador tiene que mirar searchIndex");
  assert.ok(!json.includes("Rodríguez"), "el término no puede viajar con acentos");
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL TOPE Y EL ORDEN
// ═══════════════════════════════════════════════════════════════════════

test("el tope es 300 y se piden 301 para poder decir que había más", () => {
  assert.equal(EDU_ESTUDIANTE_MAX_PACIENTES, 300);

  // La convención del padrón, escrita como la aplica la capa de datos.
  const traidas = Array.from({ length: EDU_ESTUDIANTE_MAX_PACIENTES + 1 }, (_, i) => i);
  const truncated = traidas.length > EDU_ESTUDIANTE_MAX_PACIENTES;
  const usadas = truncated ? traidas.slice(0, EDU_ESTUDIANTE_MAX_PACIENTES) : traidas;
  assert.equal(truncated, true);
  assert.equal(usadas.length, 300, "devuelve 300, NO 301");

  // Con exactamente 300 en la base, no hay recorte y no se avisa de nada.
  const justas = Array.from({ length: EDU_ESTUDIANTE_MAX_PACIENTES }, (_, i) => i);
  assert.equal(justas.length > EDU_ESTUDIANTE_MAX_PACIENTES, false);
});

test("el orden es por última visita descendente, y quien no tiene ninguna va al FINAL", () => {
  const fila = (folio: string, ultimaVisitaISO: string | null): EduEstudiantePacienteRow => ({
    patientId: `p_${folio}`,
    folio,
    name: folio,
    ageYears: null,
    porCaso: true,
    porCita: false,
    porReferido: false,
    citas: 0,
    ultimaVisitaISO,
    ultimaVisitaLabel: null,
    casosAbiertos: 0,
    casosCerrados: 0,
  });

  const filas = [
    fila("P-003", null),
    fila("P-001", "2026-01-10T10:00:00.000Z"),
    fila("P-002", "2026-03-01T10:00:00.000Z"),
    fila("P-004", null),
  ];
  filas.sort(eduEstudiantePacientesOrden);

  assert.deepEqual(
    filas.map((f) => f.folio),
    ["P-002", "P-001", "P-003", "P-004"],
    "🔴 en Postgres un ORDER BY DESC pone los NULL PRIMERO: encabezaría la lista de 'a quién ha atendido' con los que todavía no ha atendido",
  );
});

test("dos pacientes con la MISMA última visita no se barajan solos", () => {
  const mismo = "2026-03-01T10:00:00.000Z";
  const base = {
    ageYears: null,
    porCaso: true,
    porCita: false,
    porReferido: false,
    citas: 0,
    ultimaVisitaISO: mismo,
    ultimaVisitaLabel: null,
    casosAbiertos: 0,
    casosCerrados: 0,
  };
  const a = { ...base, patientId: "p_a", folio: "P-002", name: "A" };
  const b = { ...base, patientId: "p_b", folio: "P-001", name: "B" };

  // El desempate por folio da un orden TOTAL: sin él, dos cargas de la misma
  // pantalla pueden salir en distinto orden y la lista parece moverse sola.
  assert.deepEqual([a, b].sort(eduEstudiantePacientesOrden).map((f) => f.folio), ["P-001", "P-002"]);
  assert.deepEqual([b, a].sort(eduEstudiantePacientesOrden).map((f) => f.folio), ["P-001", "P-002"]);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · NI UN DATO DE DINERO
// ═══════════════════════════════════════════════════════════════════════

test("la ficha no puede enseñar dinero: 'charges' es none para DOCENTE y ALUMNO", () => {
  assert.equal(eduVisibility(actor("DOCENTE"), "charges").kind, "none");
  assert.equal(eduVisibility(actor("ALUMNO"), "charges").kind, "none");
  // Y los dos que sí lo ven no abren esta ficha (CAJA) o lo ven todo igual.
  assert.equal(eduVisibility(actor("DIRECCION"), "charges").kind, "all");
  assert.equal(eduVisibility(actor("CAJA"), "charges").kind, "all");
  assert.equal(eduPadronScope(actor("CAJA")).kind, "none");
});
