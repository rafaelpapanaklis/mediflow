/**
 * EL TRASPASO DE CASO, EN LAS DOS DIRECCIONES — Ola 6 de DaleControl
 * INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-traspaso.test.ts
 *
 * (No hay `npm run test:edu-traspaso`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo se comprueba SIN base de datos: `visibility.ts` devuelve objetos
 * `where` y no ejecuta nada, así que aquí se lee exactamente lo que Prisma
 * recibiría — que es donde vive la regla.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE FIJA ESTE ARCHIVO, Y POR QUÉ ES LA PRUEBA CENTRAL DE LA OLA
 *
 * Un traspaso NO reescribe el `studentId` del caso: cierra el viejo como
 * TRANSFERRED y abre uno nuevo. Eso quiere decir que, después de
 * traspasar, el alumno SALIENTE sigue teniendo un caso con su id encima —
 * y si el `where` de pacientes no lo descartara, seguiría abriendo la
 * ficha, el expediente, el odontograma y las radiografías de un paciente
 * que ya no atiende. El traspaso "funcionaría" perfectamente; solo que el
 * que se fue se quedaría con la llave.
 *
 * Por eso se prueban LAS DOS DIRECCIONES:
 *   · el saliente PIERDE  → su rama de casos exige status ≠ TRANSFERRED,
 *     y su rama de citas descarta las que cuelgan del caso transferido;
 *   · el entrante GANA    → el caso nuevo nace ASSIGNED, así que el mismo
 *     `where` lo encuentra sin ninguna regla nueva.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduStudentScopeWhere,
  eduVisibility,
} from "../visibility";
import { EDU_CASE_STATUSES, type EduCaseStatus, type EduRole } from "../types";

const INST = "inst_1";
const AHORA = new Date("2026-03-01T12:00:00.000Z");

const SALIENTE = "u_alumno_sale";
const ENTRANTE = "u_alumno_entra";

function actor(role: EduRole, eduUserId: string) {
  return { role, eduUserId };
}

/** Todos los valores que aparecen bajo una clave, a cualquier profundidad. */
function valoresDe(objeto: unknown, clave: string): unknown[] {
  const out: unknown[] = [];
  const visitar = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(visitar);
      return;
    }
    if (typeof v !== "object" || v === null) return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === clave) out.push(val);
      visitar(val);
    }
  };
  visitar(objeto);
  return out;
}

/** ¿Existe en algún punto del objeto un `{ status: { not: "TRANSFERRED" } }`? */
function descartaTransferidos(where: unknown): boolean {
  return valoresDe(where, "status").some(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      (v as Record<string, unknown>).not === "TRANSFERRED",
  );
}

// ═════════════════════════════════════════════════════════════════════
// 1 · EL SALIENTE PIERDE AL PACIENTE
// ═════════════════════════════════════════════════════════════════════

test("🔴 el `where` de pacientes del ALUMNO descarta sus casos TRANSFERIDOS", () => {
  const scope = eduVisibility(actor("ALUMNO", SALIENTE), "patients");
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA }) as {
    OR?: Record<string, unknown>[];
  };

  const ramaCasos = where.OR?.[0];
  assert.ok(ramaCasos && "cases" in ramaCasos, "falta la rama de los casos");
  assert.ok(
    descartaTransferidos(ramaCasos),
    "un caso TRANSFERIDO seguiría dándole acceso al paciente que entregó",
  );
});

test("🔴 y también descarta las CITAS que colgaban del caso transferido", () => {
  const scope = eduVisibility(actor("ALUMNO", SALIENTE), "patients");
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA }) as {
    OR?: Record<string, unknown>[];
  };

  const ramaCitas = where.OR?.[1];
  assert.ok(ramaCitas && "appointments" in ramaCitas, "falta la rama de las citas");
  assert.ok(
    descartaTransferidos(ramaCitas),
    "sin esto, una cita vieja del caso entregado seguiría abriendo la ficha del paciente",
  );

  // Y la cita de TAMIZAJE anterior al caso tiene que seguir contando: es
  // la razón de que esta rama exista.
  const orDeCitas = valoresDe(ramaCitas, "OR").find(
    (v) => Array.isArray(v) && v.some((x) => x && typeof x === "object" && "caseId" in x),
  ) as Record<string, unknown>[] | undefined;
  assert.ok(orDeCitas, "la rama de citas tiene que contemplar la cita sin caso");
  assert.deepEqual(
    orDeCitas.find((x) => "caseId" in x),
    { caseId: null },
    "la cita de tamizaje (sin caso todavía) no puede quedar fuera",
  );
});

test("🔴 lo mismo para el DOCENTE: el caso que su alumno entregó deja de contar", () => {
  const scope = eduVisibility(actor("DOCENTE", "u_doc"), "patients");
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.ok(
    descartaTransferidos(where),
    "un docente seguiría viendo al paciente por un caso que su alumno ya entregó",
  );
  // Y sigue colgando de la asignación VIGENTE, que es la regla de la Ola 1A.
  assert.deepEqual(valoresDe(where, "startsAt"), [{ lte: AHORA }, { lte: AHORA }]);
});

test("DIRECCIÓN y CAJA no pierden nada: para ellos el `where` no recorta por caso", () => {
  for (const rol of ["DIRECCION", "CAJA"] as EduRole[]) {
    const scope = eduVisibility(actor(rol, "u_x"), "patients");
    const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA });
    assert.deepEqual(where, { institutionId: INST });
    assert.equal(descartaTransferidos(where), false);
  }
});

// ═════════════════════════════════════════════════════════════════════
// 2 · EL ENTRANTE GANA AL PACIENTE
//
// No hace falta una regla nueva y ése es el punto: el caso nuevo nace
// ASSIGNED, así que el MISMO `where` lo encuentra. Lo que se comprueba
// aquí es que el recorte cuelga del alumno y de nada más — si colgara,
// por ejemplo, de "el caso lo abrió el tamizaje", un caso nacido de un
// traspaso (que no tiene tamizaje) no se lo daría a nadie.
// ═════════════════════════════════════════════════════════════════════

test("🔴 el `where` del ENTRANTE lo filtra por SU userId, y por nada más", () => {
  const scope = eduVisibility(actor("ALUMNO", ENTRANTE), "patients");
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA });

  const userIds = valoresDe(where, "userId");
  assert.deepEqual(userIds, [ENTRANTE, ENTRANTE], "las dos ramas cuelgan del alumno");
  assert.equal(
    JSON.stringify(where).includes(SALIENTE),
    false,
    "el alumno que entra no puede heredar nada del que salió",
  );
  // Nada de `screeningAppointmentId` ni de `openedAt`: un caso nacido de
  // un traspaso no tiene tamizaje, y si el recorte lo exigiera, el
  // paciente traspasado no sería de nadie.
  assert.deepEqual(valoresDe(where, "screeningAppointmentId"), []);
});

test("el estado del caso NO entra en el recorte del entrante salvo por el descarte", () => {
  // ASSIGNED, IN_TREATMENT, ON_HOLD, COMPLETED, SCREENING y ABANDONED
  // TODOS siguen contando: el único estado que quita el acceso es
  // TRANSFERRED, porque es el único que significa "ya no es mío".
  const scope = eduVisibility(actor("ALUMNO", ENTRANTE), "patients");
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA });
  const statuses = valoresDe(where, "status");
  for (const s of statuses) {
    assert.deepEqual(
      s,
      { not: "TRANSFERRED" },
      "ningún otro estado puede aparecer en el recorte de pacientes",
    );
  }
  assert.equal(statuses.length, 2, "una condición por rama, ni más ni menos");
});

test("TRANSFERRED existe en el enum de casos (si se renombra, esta ola se rompe en silencio)", () => {
  assert.ok(
    (EDU_CASE_STATUSES as string[]).includes("TRANSFERRED"),
    "visibility.ts compara contra este literal",
  );
  const estado: EduCaseStatus = "TRANSFERRED";
  assert.equal(estado, "TRANSFERRED");
});

// ═════════════════════════════════════════════════════════════════════
// 3 · LA LISTA DE CASOS SÍ CONSERVA EL TRANSFERIDO
//
// Es la asimetría deliberada de la ola: el saliente pierde al PACIENTE
// (su expediente vivo) pero conserva el CASO en su historia académica —
// la bitácora tiene que poder decir "lo llevó de marzo a julio y lo
// entregó".
// ═════════════════════════════════════════════════════════════════════

test("🔴 `eduCaseScopeWhere` NO descarta los transferidos (es la historia del alumno)", () => {
  for (const rol of ["ALUMNO", "DOCENTE", "DIRECCION"] as EduRole[]) {
    const scope = eduVisibility(actor(rol, "u_1"), "cases");
    const where = eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA });
    assert.equal(
      descartaTransferidos(where),
      false,
      `${rol}: la lista de casos perdería la historia académica del alumno`,
    );
  }
});

test("la AGENDA tampoco los descarta: una cita pasada ocurrió", () => {
  const scope = eduVisibility(actor("ALUMNO", SALIENTE), "appointments");
  const where = eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.equal(descartaTransferidos(where), false);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · EL ALCANCE DE ALUMNOS (la pantalla de Evaluación)
// ═════════════════════════════════════════════════════════════════════

test("🔴 un ALUMNO se alcanza a SÍ MISMO y a nadie más", () => {
  const scope = eduVisibility(actor("ALUMNO", SALIENTE), "cases");
  const where = eduStudentScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.deepEqual(where, { institutionId: INST, userId: SALIENTE });
});

test("un DOCENTE alcanza a los alumnos que supervisa HOY", () => {
  const scope = eduVisibility(actor("DOCENTE", "u_doc"), "cases");
  const where = eduStudentScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.deepEqual(valoresDe(where, "supervisorUserId"), ["u_doc"]);
  assert.deepEqual(valoresDe(where, "startsAt"), [{ lte: AHORA }]);
  assert.deepEqual(valoresDe(where, "endsAt"), [null, { gt: AHORA }]);
});

test("DIRECCIÓN alcanza a todos; CAJA a ninguno", () => {
  const dir = eduStudentScopeWhere({
    institutionId: INST,
    scope: eduVisibility(actor("DIRECCION", "u_d"), "cases"),
    now: AHORA,
  });
  assert.deepEqual(dir, { institutionId: INST });

  const caja = eduStudentScopeWhere({
    institutionId: INST,
    scope: eduVisibility(actor("CAJA", "u_c"), "cases"),
    now: AHORA,
  });
  assert.deepEqual(caja, { institutionId: INST, id: { in: [] } });
});

test("sin institutionId LANZA (un undefined borra el filtro de tenant)", () => {
  for (const malo of ["", undefined, null]) {
    assert.throws(
      () =>
        eduStudentScopeWhere({
          institutionId: malo as unknown as string,
          scope: { kind: "all" },
          now: AHORA,
        }),
      /institutionId/,
    );
  }
});
