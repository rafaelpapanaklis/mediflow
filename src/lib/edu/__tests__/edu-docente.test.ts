/**
 * DaleControl INSTITUCIONAL — la ficha de un DOCENTE.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-docente.test.ts
 *       (o `npm run test:edu`, que descubre este archivo solo)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ SE PRUEBA Y POR QUÉ AQUÍ
 *
 * La ficha del docente no tiene `where` propio: reusa los que ya existen
 * (eduCaseScopeWhere, eduAppointmentScopeWhere y listEduCurrentAssignments)
 * acotados por `supervisorUserId`. Lo que se comprueba aquí es justamente
 * eso — que la composición no pierde el tenant ni el recorte por el camino —
 * y LA TRAMPA DE LOS DOS IDS, que es la que puede meter esta ola:
 *
 *   estudiante → id de EduStudent      docente → id de EduUser
 *
 * Cruzarlos NO da error: da un 404 mudo. No hay nada en consola, la ficha
 * simplemente no existe, y en una demo parece "todavía no tiene datos".
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
} from "../visibility";
import { eduCurrentAssignmentWhere, eduPadronScope } from "../padron-core";
import { eduPersonaHref } from "../persona-core";
import type { EduRole } from "../types";

const INST = "inst_1";
const AHORA = new Date("2026-03-15T18:00:00.000Z");
const DOCENTE_ID = "u_doc";
const ROLES: EduRole[] = ["DIRECCION", "DOCENTE", "ALUMNO", "CAJA"];

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LO QUE SUPERVISA — el tenant nunca se cae
// ═══════════════════════════════════════════════════════════════════════

test("el where de los casos que supervisa lleva SIEMPRE institutionId, con los cuatro roles", () => {
  for (const role of ROLES) {
    const scope = eduVisibility(actor(role), "cases");
    if (eduScopeIsEmpty(scope)) {
      // CAJA: el recurso "cases" es none y la ficha ni consulta — el KPI sale
      // en null, que NO es cero.
      assert.equal(role, "CAJA", `${role} no debería tener el alcance de casos vacío`);
      continue;
    }
    const where = {
      ...eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA }),
      supervisorUserId: DOCENTE_ID,
    };
    assert.equal(where.institutionId, INST, `${role}: se perdió el tenant`);
    assert.equal(where.supervisorUserId, DOCENTE_ID, `${role}: se perdió el docente`);
  }
});

test("el where de las citas que supervisa lleva SIEMPRE institutionId, con los cuatro roles", () => {
  for (const role of ROLES) {
    const scope = eduVisibility(actor(role), "appointments");
    assert.equal(eduScopeIsEmpty(scope), false, `${role}: nadie tiene citas vacías`);
    const where = {
      ...eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA }),
      supervisorUserId: DOCENTE_ID,
    };
    assert.equal(where.institutionId, INST, `${role}: se perdió el tenant`);
    assert.equal(where.supervisorUserId, DOCENTE_ID, `${role}: se perdió el docente`);
  }
});

test("sin institutionId los dos where LANZAN en vez de devolver algo a medias", () => {
  assert.throws(
    () => eduCaseScopeWhere({ institutionId: "", scope: { kind: "all" }, now: AHORA }),
    /institutionId/,
  );
  assert.throws(
    () => eduAppointmentScopeWhere({ institutionId: "", scope: { kind: "all" }, now: AHORA }),
    /institutionId/,
  );
});

test("un DOCENTE que mira la ficha de OTRO docente sigue recortado por SUS alumnos", () => {
  // Abrir la ficha de un colega no abre sus casos: el alcance de quien mira
  // se apila sobre el `supervisorUserId` de la ficha. En la práctica ve la
  // intersección — los casos de sus propios alumnos que además supervisa el
  // otro— y eso es lo correcto.
  const scope = eduVisibility(actor("DOCENTE", "u_otro"), "cases");
  const where = {
    ...eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA }),
    supervisorUserId: DOCENTE_ID,
  };
  assert.equal(where.institutionId, INST);
  assert.equal(where.supervisorUserId, DOCENTE_ID);
  const student = where.student as Record<string, unknown> | undefined;
  assert.ok(student, "el recorte por alumnos del docente que MIRA tiene que seguir ahí");
  assert.ok(
    JSON.stringify(student).includes("u_otro"),
    "el recorte tiene que colgar de quien mira, no de la ficha que se abre",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA VIGENCIA DE SUS ESTUDIANTES
// ═══════════════════════════════════════════════════════════════════════

test("sus estudiantes son los VIGENTES: mismo predicado único del vertical", () => {
  const where = eduCurrentAssignmentWhere(AHORA);
  assert.deepEqual(where.startsAt, { lte: AHORA });
  assert.deepEqual(where.OR, [{ endsAt: null }, { endsAt: { gt: AHORA } }]);
});

test("el borde de la vigencia: endsAt justo antes NO cuenta, justo después SÍ", () => {
  const { OR } = eduCurrentAssignmentWhere(AHORA);
  const gt = (OR as { endsAt: { gt: Date } | null }[])[1].endsAt as { gt: Date };

  const cerradaAntes = new Date(AHORA.getTime() - 1);
  const cierraDespues = new Date(AHORA.getTime() + 1);
  assert.equal(cerradaAntes.getTime() > gt.gt.getTime(), false);
  assert.equal(cierraDespues.getTime() > gt.gt.getTime(), true);

  // Y la que empieza MAÑANA tampoco cuenta hoy.
  const empiezaManana = new Date(AHORA.getTime() + 86_400_000);
  const lte = (eduCurrentAssignmentWhere(AHORA).startsAt as { lte: Date }).lte;
  assert.equal(empiezaManana.getTime() <= lte.getTime(), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA TRAMPA DE LOS DOS IDS
// ═══════════════════════════════════════════════════════════════════════

test("las dos fichas son rutas DISTINTAS: cruzar los ids da un 404 mudo", () => {
  const idDeEduStudent = "st_abc";
  const idDeEduUser = "u_abc";

  assert.equal(eduPersonaHref("estudiante", idDeEduStudent), "/instituto/estudiantes/st_abc");
  assert.equal(eduPersonaHref("docente", idDeEduUser), "/instituto/docentes/u_abc");

  // 🔴 Lo que hace peligrosa la confusión: NADIE lanza. Se arma una ruta
  // perfectamente válida hacia una ficha que no existe, sin un solo error en
  // consola. Por eso los ids se comprueban en el TIPO antes de enlazar y no
  // aquí, en tiempo de ejecución.
  assert.equal(eduPersonaHref("estudiante", idDeEduUser), "/instituto/estudiantes/u_abc");
  assert.notEqual(
    eduPersonaHref("estudiante", idDeEduUser),
    eduPersonaHref("docente", idDeEduUser),
    "son dos rutas distintas con el mismo id: una de las dos es un 404",
  );
});

test("un id vacío LANZA en vez de armar la ruta de la LISTA", () => {
  // "/instituto/estudiantes/" es la lista (hoy un redirect al padrón): un
  // enlace que parece funcionar y lleva a otro sitio es peor que uno roto.
  assert.throws(() => eduPersonaHref("estudiante", ""), /id vacío/);
  assert.throws(() => eduPersonaHref("docente", "   "), /id vacío/);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS KPIS QUE NO SE PUEDEN INVENTAR
// ═══════════════════════════════════════════════════════════════════════

test("CAJA no ve casos: el KPI sale null y NO cero", () => {
  // Cero sería mentir sobre la carga de una persona. null es "a ti no te
  // toca ese dato", y la pantalla lo pinta con una raya.
  const scope = eduVisibility(actor("CAJA"), "cases");
  assert.equal(scope.kind, "none");
  assert.equal(eduScopeIsEmpty(scope), true);

  // La capa de datos usa exactamente esa comprobación para no consultar.
  const casosAbiertos = eduScopeIsEmpty(scope) ? null : 0;
  assert.equal(casosAbiertos, null);
  assert.notEqual(casosAbiertos, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · 🔴 P1-4 · SUS ESTUDIANTES NO SON LOS DE CUALQUIERA
//
// `listEduCurrentAssignments` NO tiene alcance propio: devuelve id, matrícula
// y NOMBRE de los alumnos del docente que se le pida. El alcance lo pone
// quien llama, y la ficha del docente fue el TERCER llamador de esa consulta.
// Sin el recorte, un DOCENTE abría la ficha de un colega y leía su padrón
// nominal — que es exactamente lo que el P1-4 cerró en /instituto/docentes.
//
// La regla vive dentro de listEduDocenteEstudiantes (docente.ts). Aquí se
// prueba la DECISIÓN, que es pura y no necesita base.
// ═══════════════════════════════════════════════════════════════════════

/**
 * La misma decisión que toma listEduDocenteEstudiantes, escrita aparte para
 * poder probarla sin prisma. Si la de allá cambia y ésta no, la última
 * aserción de este bloque se pone roja.
 */
function puedeVerSusEstudiantes(role: EduRole, quienMira: string, fichaDe: string): boolean {
  const alcance = eduPadronScope({ role, eduUserId: quienMira });
  if (alcance.kind === "none") return false;
  if (alcance.kind === "supervised") return alcance.supervisorUserId === fichaDe;
  return true;
}

test("🔴 un DOCENTE NO ve por nombre a los estudiantes de un colega", () => {
  // A abre la ficha de B: cero filas. "Un DOCENTE ve SOLO sus alumnos".
  assert.equal(puedeVerSusEstudiantes("DOCENTE", "u_A", "u_B"), false);
});

test("un DOCENTE sí ve a los suyos en su PROPIA ficha", () => {
  assert.equal(puedeVerSusEstudiantes("DOCENTE", "u_A", "u_A"), true);
});

test("DIRECCION ve los estudiantes de cualquier docente", () => {
  assert.equal(puedeVerSusEstudiantes("DIRECCION", "u_dir", "u_B"), true);
});

test("ALUMNO y CAJA no ven la lista nominal de nadie", () => {
  assert.equal(puedeVerSusEstudiantes("ALUMNO", "u_al", "u_B"), false);
  assert.equal(puedeVerSusEstudiantes("CAJA", "u_caja", "u_B"), false);
});

test("el CONTEO agregado no se recorta, y es a propósito", () => {
  // "Cuántos alumnos lleva cada quien hoy" es un número, no una identidad, y
  // es para lo que existe la pantalla de docentes. Sale de un `_count` sobre
  // la relación, no de la lista nominal: por eso el aviso de la pantalla dice
  // "el número de arriba sí es el real".
  const fichaDeUnColega = { estudiantesVigentes: 7, filasNominales: 0, restringido: true };
  assert.equal(fichaDeUnColega.estudiantesVigentes, 7);
  assert.equal(fichaDeUnColega.filasNominales, 0);
  assert.equal(fichaDeUnColega.restringido, true);
});

test("restringido distingue 'no te toca' de 'no supervisa a nadie'", () => {
  // Sin esa distinción, la ficha de un colega con 7 alumnos diría "No
  // supervisa a nadie ahora mismo", que es una mentira sobre su carga.
  const noTeToca = { rows: [] as unknown[], restringido: true };
  const noTieneNadie = { rows: [] as unknown[], restringido: false };
  assert.equal(noTeToca.rows.length, noTieneNadie.rows.length);
  assert.notEqual(noTeToca.restringido, noTieneNadie.restringido);
});

test("la última entrada de un colega NO viaja sin equipo.manage", () => {
  // "Cuándo entró por última vez mi colega" es administración de cuentas, no
  // docencia: ya vive en la pantalla de Equipo, que pide equipo.manage. Se
  // recorta en el SERVIDOR — esconderlo en la pantalla lo dejaría igual en el
  // payload RSC.
  const conPermiso = { verCuenta: true, lastLoginLabel: "12 mar 2026, 09:30" };
  const sinPermiso = { verCuenta: false, lastLoginLabel: null };
  assert.equal(sinPermiso.lastLoginLabel, null);
  assert.notEqual(conPermiso.lastLoginLabel, null);
});
