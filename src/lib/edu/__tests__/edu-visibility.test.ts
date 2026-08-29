/**
 * QUIÉN VE QUÉ — la prueba central de la Ola 2 de DaleControl
 * INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-visibility.test.ts
 *
 * (No hay `npm run test:edu-visibility`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo esto se comprueba SIN base de datos: `visibility.ts` devuelve
 * objetos `where` y no ejecuta nada, así que aquí se lee lo que Prisma
 * recibiría. Es a propósito — una prueba de integración contra Postgres
 * habría verificado lo mismo y no se habría podido correr en este entorno.
 *
 * Lo que fija este archivo:
 *  1. la matriz rol × recurso, incluida la línea del contrato "CAJA no ve
 *     casos";
 *  2. que el institutionId esté SIEMPRE (un undefined borra el filtro de
 *     tenant y una escuela ve los pacientes de otra);
 *  3. 🔴 QUE UNA ASIGNACIÓN VENCIDA NO DÉ ACCESO — el docente rota, y el
 *     día que entrega su grupo deja de ver a esos pacientes;
 *  4. que los filtros de pantalla no PISEN el recorte;
 *  5. que las uniones de types.ts no se desincronicen de los enums de
 *     Prisma (chequeo de TIPOS, lo verifica `tsc --noEmit`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  EduAppointmentStatus as PrismaApptStatus,
  EduAppointmentType as PrismaApptType,
  EduCaseStatus as PrismaCaseStatus,
  EduPatientStatus as PrismaPatientStatus,
  EduSex as PrismaSex,
} from "@prisma/client";
import {
  EDU_VISIBILITY_NONE_DETAIL,
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeCoversStudent,
  eduScopeIsEmpty,
  eduVisibility,
  type EduVisibilityResource,
  type EduVisibilityScope,
} from "../visibility";
import type {
  EduAppointmentStatus,
  EduAppointmentType,
  EduCaseStatus,
  EduPatientStatus,
  EduRole,
  EduSex,
} from "../types";
import {
  EDU_APPOINTMENT_FREE_STATUSES,
  EDU_APPOINTMENT_STATUSES,
  EDU_CASE_CLOSED_STATUSES,
  EDU_CASE_STATUSES,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: las uniones de types.ts == los enums de Prisma
//     Si una ola agrega un valor al schema y no lo agrega a types.ts (o al
//     revés), `tsc --noEmit` falla aquí. En runtime esto no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _patientStatus: Exacto<EduPatientStatus, PrismaPatientStatus> = true;
const _sex: Exacto<EduSex, PrismaSex> = true;
const _caseStatus: Exacto<EduCaseStatus, PrismaCaseStatus> = true;
const _apptType: Exacto<EduAppointmentType, PrismaApptType> = true;
const _apptStatus: Exacto<EduAppointmentStatus, PrismaApptStatus> = true;
void _patientStatus;
void _sex;
void _caseStatus;
void _apptType;
void _apptStatus;

// ─────────────────────────────────────────────────────────────────────
// Utilería
// ─────────────────────────────────────────────────────────────────────
const INST = "inst_1";
const OTRO_INST = "inst_2";
const AHORA = new Date("2026-08-29T18:00:00.000Z");

const RECURSOS: EduVisibilityResource[] = ["patients", "appointments", "cases"];
const ROLES: EduRole[] = ["DIRECCION", "DOCENTE", "ALUMNO", "CAJA"];

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

/** Recorre un objeto y junta todos los valores de una clave. */
function valoresDe(obj: unknown, clave: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(obj)) {
    for (const x of obj) valoresDe(x, clave, out);
    return out;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === clave) out.push(v);
      valoresDe(v, clave, out);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 1 · La matriz rol × recurso
// ─────────────────────────────────────────────────────────────────────

test("DIRECCION lo ve todo, en los tres recursos", () => {
  for (const r of RECURSOS) {
    assert.deepEqual(eduVisibility(actor("DIRECCION"), r), { kind: "all" });
  }
});

test("CAJA ve pacientes y agenda completos, y NINGÚN caso", () => {
  assert.deepEqual(eduVisibility(actor("CAJA"), "patients"), { kind: "all" });
  assert.deepEqual(eduVisibility(actor("CAJA"), "appointments"), { kind: "all" });
  // La línea del contrato: "CAJA → todos los pacientes y toda la agenda.
  // SIN expediente clínico". Cerrada aquí ADEMÁS del permiso, para que
  // encenderle "casos.view" por error no le abra nada.
  assert.deepEqual(eduVisibility(actor("CAJA"), "cases"), { kind: "none" });
});

test("DOCENTE ve lo de los alumnos que supervisa; ALUMNO, lo suyo", () => {
  for (const r of RECURSOS) {
    assert.deepEqual(eduVisibility(actor("DOCENTE", "doc_1"), r), {
      kind: "supervised",
      supervisorUserId: "doc_1",
    });
    assert.deepEqual(eduVisibility(actor("ALUMNO", "al_1"), r), {
      kind: "own",
      studentUserId: "al_1",
    });
  }
});

test("un rol desconocido cae en 'none', nunca en 'all'", () => {
  for (const r of RECURSOS) {
    assert.deepEqual(eduVisibility({ role: "RECTOR" as EduRole, eduUserId: "x" }, r), {
      kind: "none",
    });
    assert.deepEqual(eduVisibility(null as never, r), { kind: "none" });
    assert.deepEqual(eduVisibility("DIRECCION" as never, r), { kind: "none" });
  }
});

test("un DOCENTE o un ALUMNO sin id caen en 'none' (no en 'all')", () => {
  for (const r of RECURSOS) {
    assert.deepEqual(eduVisibility({ role: "DOCENTE", eduUserId: "" }, r), { kind: "none" });
    assert.deepEqual(eduVisibility({ role: "ALUMNO", eduUserId: "" }, r), { kind: "none" });
  }
});

test("cada recurso tiene su explicación en español para la pantalla vacía", () => {
  for (const r of RECURSOS) {
    const texto = EDU_VISIBILITY_NONE_DETAIL[r];
    assert.ok(texto && texto.length > 40, `falta el texto de ${r}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 2 · El tenant, SIEMPRE
// ─────────────────────────────────────────────────────────────────────

const CONSTRUCTORES = [
  { nombre: "eduPatientScopeWhere", fn: eduPatientScopeWhere },
  { nombre: "eduAppointmentScopeWhere", fn: eduAppointmentScopeWhere },
  { nombre: "eduCaseScopeWhere", fn: eduCaseScopeWhere },
] as const;

test("sin institutionId LANZAN (un undefined borra el filtro de tenant)", () => {
  for (const { nombre, fn } of CONSTRUCTORES) {
    for (const malo of ["", undefined, null]) {
      assert.throws(
        () => fn({ institutionId: malo as unknown as string, scope: { kind: "all" }, now: AHORA }),
        /institutionId/,
        `${nombre} aceptó un institutionId ${JSON.stringify(malo)}`,
      );
    }
  }
});

test("el institutionId del `where` es el que se pasó, en los cuatro roles", () => {
  for (const rol of ROLES) {
    for (const { fn } of CONSTRUCTORES) {
      const where = fn({ institutionId: INST, scope: eduVisibility(actor(rol), "patients"), now: AHORA });
      assert.equal(
        (where as { institutionId?: string }).institutionId,
        INST,
        `${rol}: el where salió sin el institutionId de la sesión`,
      );
      const ids = valoresDe(where, "institutionId");
      assert.ok(ids.length > 0);
      for (const id of ids) {
        assert.equal(id, INST, `${rol}: se coló un institutionId ajeno en el where`);
        assert.notEqual(id, OTRO_INST);
      }
    }
  }
});

test("el alcance 'none' no devuelve NI UNA fila (y no un where vacío)", () => {
  for (const { nombre, fn } of CONSTRUCTORES) {
    const where = fn({ institutionId: INST, scope: { kind: "none" }, now: AHORA }) as {
      institutionId?: string;
      id?: { in?: string[] };
    };
    assert.equal(where.institutionId, INST, `${nombre} perdió el tenant`);
    assert.deepEqual(where.id, { in: [] }, `${nombre} con alcance none no cierra la consulta`);
  }
});

test("eduScopeIsEmpty solo es cierto para 'none'", () => {
  assert.equal(eduScopeIsEmpty({ kind: "none" }), true);
  assert.equal(eduScopeIsEmpty({ kind: "all" }), false);
  assert.equal(eduScopeIsEmpty({ kind: "own", studentUserId: "u" }), false);
  assert.equal(eduScopeIsEmpty({ kind: "supervised", supervisorUserId: "d" }), false);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · La forma del recorte
// ─────────────────────────────────────────────────────────────────────

test("DIRECCION y CAJA: el where de agenda es SOLO el tenant (sin recorte por alumno)", () => {
  const where = eduAppointmentScopeWhere({ institutionId: INST, scope: { kind: "all" }, now: AHORA });
  assert.deepEqual(where, { institutionId: INST });
});

test("ALUMNO: la cita se recorta por el userId del alumno dueño", () => {
  const scope = eduVisibility(actor("ALUMNO", "al_1"), "appointments");
  const where = eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.deepEqual(where, {
    institutionId: INST,
    student: { institutionId: INST, userId: "al_1" },
  });
});

test("DOCENTE: la cita se recorta por asignación VIGENTE, con el predicado del padrón", () => {
  const scope = eduVisibility(actor("DOCENTE", "doc_1"), "appointments");
  const where = eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA }) as {
    student?: { supervisors?: { some?: Record<string, unknown> } };
  };
  const some = where.student?.supervisors?.some;
  assert.ok(some, "el docente no quedó recortado por sus asignaciones");
  assert.equal(some.supervisorUserId, "doc_1");
  assert.equal(some.institutionId, INST);
  // 🔴 El predicado de vigencia: empezada Y no cerrada. Si faltara el
  // startsAt, el docente vería alumnos que todavía no le tocan; si faltara
  // el endsAt, seguiría viendo los que ya entregó.
  assert.deepEqual(some.startsAt, { lte: AHORA });
  assert.deepEqual(some.OR, [{ endsAt: null }, { endsAt: { gt: AHORA } }]);
});

test("el paciente es 'mío' por CASO o por CITA — las dos, no una", () => {
  for (const scope of [
    eduVisibility(actor("ALUMNO", "al_1"), "patients"),
    eduVisibility(actor("DOCENTE", "doc_1"), "patients"),
  ]) {
    const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA }) as {
      OR?: Record<string, unknown>[];
    };
    assert.equal(where.OR?.length, 2, "el paciente tiene que verse por caso Y por cita");
    assert.ok("cases" in (where.OR?.[0] ?? {}), "falta la rama de los casos");
    assert.ok(
      "appointments" in (where.OR?.[1] ?? {}),
      // La cita de TAMIZAJE existe ANTES que el caso (es la que lo abre):
      // sin esta rama, quien hace la valoración no podría abrir la ficha
      // del paciente que tiene enfrente.
      "falta la rama de las citas",
    );
  }
});

test("el caso del DOCENTE cuelga de la asignación vigente, NO de EduCase.supervisorUserId", () => {
  const scope = eduVisibility(actor("DOCENTE", "doc_1"), "cases");
  const where = eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA }) as Record<string, unknown>;
  // Si la visibilidad se calculara con la columna del caso, un docente que
  // ya rotó seguiría leyéndolo para siempre. Esa columna guarda quién era
  // el responsable, no quién puede mirar.
  assert.ok(!("supervisorUserId" in where), "el where del caso usa la columna congelada");
  assert.ok(valoresDe(where, "supervisorUserId").includes("doc_1"));
  assert.deepEqual(valoresDe(where, "startsAt"), [{ lte: AHORA }]);
});

// ─────────────────────────────────────────────────────────────────────
// 4 · Los filtros de pantalla NO pisan el recorte
// ─────────────────────────────────────────────────────────────────────

test("filtrar por especialidad no borra el recorte del alumno", () => {
  const scope = eduVisibility(actor("ALUMNO", "al_1"), "appointments");
  const where = eduAppointmentScopeWhere({
    institutionId: INST,
    scope,
    now: AHORA,
    studentExtra: { programId: "prog_1" },
  }) as { student?: Record<string, unknown> };

  // Los dos filtros viven en el MISMO objeto `student`. Escribir
  // `where.student` dos veces perdería uno de los dos EN SILENCIO, y el
  // que se perdería sería el recorte.
  assert.equal(where.student?.userId, "al_1");
  assert.equal(where.student?.programId, "prog_1");
  assert.equal(where.student?.institutionId, INST);
});

test("filtrar por especialidad no borra el recorte del docente", () => {
  const scope = eduVisibility(actor("DOCENTE", "doc_1"), "appointments");
  const where = eduAppointmentScopeWhere({
    institutionId: INST,
    scope,
    now: AHORA,
    studentExtra: { programId: "prog_1" },
  }) as { student?: Record<string, unknown> };

  assert.equal(where.student?.programId, "prog_1");
  assert.ok(where.student?.supervisors, "el filtro de especialidad se llevó la supervisión");
});

test("un filtro sobre DIRECCION agrega recorte donde no había", () => {
  const where = eduCaseScopeWhere({
    institutionId: INST,
    scope: { kind: "all" },
    now: AHORA,
    studentExtra: { id: "st_9" },
  }) as { student?: Record<string, unknown> };
  assert.deepEqual(where.student, { id: "st_9" });
});

// ─────────────────────────────────────────────────────────────────────
// 5 · 🔴 UNA ASIGNACIÓN VENCIDA NO DA ACCESO
//
// Es lo más importante de la ola. El docente ROTA a media generación: el
// día que entrega su grupo deja de ver a esos pacientes y el que entra
// empieza a verlos. Por eso la Ola 1A guarda vigencia en vez de
// sobrescribir, y por eso esto se prueba con fechas concretas.
// ─────────────────────────────────────────────────────────────────────

const DOC = "doc_1";
const OTRO_DOC = "doc_2";
const DIA = 24 * 60 * 60 * 1000;

function alumnoCon(
  supervisores: { supervisorUserId: string; startsAt: Date | string; endsAt: Date | string | null }[],
  userId = "al_1",
) {
  return { userId, supervisors: supervisores };
}

const SUPERVISADO: EduVisibilityScope = { kind: "supervised", supervisorUserId: DOC };

test("asignación abierta (endsAt null) que ya empezó → SÍ ve", () => {
  const alumno = alumnoCon([
    { supervisorUserId: DOC, startsAt: new Date(AHORA.getTime() - 30 * DIA), endsAt: null },
  ]);
  assert.equal(eduScopeCoversStudent(SUPERVISADO, alumno, AHORA), true);
});

test("asignación VENCIDA ayer → NO ve", () => {
  const alumno = alumnoCon([
    {
      supervisorUserId: DOC,
      startsAt: new Date(AHORA.getTime() - 200 * DIA),
      endsAt: new Date(AHORA.getTime() - DIA),
    },
  ]);
  assert.equal(
    eduScopeCoversStudent(SUPERVISADO, alumno, AHORA),
    false,
    "un docente que ya entregó su grupo seguiría viendo a sus pacientes",
  );
});

test("asignación cerrada EN ESTE INSTANTE → NO ve (endsAt es exclusivo)", () => {
  // Cerrar es escribir endsAt = ahora. Con `>=` el docente saliente y el
  // entrante serían los dos "vigentes" durante el mismo instante.
  const alumno = alumnoCon([
    { supervisorUserId: DOC, startsAt: new Date(AHORA.getTime() - DIA), endsAt: AHORA },
  ]);
  assert.equal(eduScopeCoversStudent(SUPERVISADO, alumno, AHORA), false);
});

test("asignación que empieza MAÑANA → todavía NO ve", () => {
  const alumno = alumnoCon([
    { supervisorUserId: DOC, startsAt: new Date(AHORA.getTime() + DIA), endsAt: null },
  ]);
  assert.equal(eduScopeCoversStudent(SUPERVISADO, alumno, AHORA), false);
});

test("asignación que empieza HOY MISMO → sí ve (startsAt es inclusivo)", () => {
  const alumno = alumnoCon([{ supervisorUserId: DOC, startsAt: AHORA, endsAt: null }]);
  assert.equal(eduScopeCoversStudent(SUPERVISADO, alumno, AHORA), true);
});

test("la asignación VIGENTE de OTRO docente no me sirve", () => {
  const alumno = alumnoCon([
    { supervisorUserId: OTRO_DOC, startsAt: new Date(AHORA.getTime() - DIA), endsAt: null },
  ]);
  assert.equal(eduScopeCoversStudent(SUPERVISADO, alumno, AHORA), false);
});

test("la rotación: el saliente deja de ver y el entrante empieza a ver", () => {
  const rotacion = new Date(AHORA.getTime() - DIA);
  const alumno = alumnoCon([
    { supervisorUserId: DOC, startsAt: new Date(AHORA.getTime() - 100 * DIA), endsAt: rotacion },
    { supervisorUserId: OTRO_DOC, startsAt: rotacion, endsAt: null },
  ]);
  assert.equal(eduScopeCoversStudent({ kind: "supervised", supervisorUserId: DOC }, alumno, AHORA), false);
  assert.equal(
    eduScopeCoversStudent({ kind: "supervised", supervisorUserId: OTRO_DOC }, alumno, AHORA),
    true,
  );
  // Y ANTES de la rotación era al revés. La historia no se borra.
  const antes = new Date(rotacion.getTime() - DIA);
  assert.equal(eduScopeCoversStudent({ kind: "supervised", supervisorUserId: DOC }, alumno, antes), true);
  assert.equal(
    eduScopeCoversStudent({ kind: "supervised", supervisorUserId: OTRO_DOC }, alumno, antes),
    false,
  );
});

test("una fecha ilegible NO se da por vigente", () => {
  const alumno = alumnoCon([{ supervisorUserId: DOC, startsAt: "no-es-fecha", endsAt: null }]);
  assert.equal(eduScopeCoversStudent(SUPERVISADO, alumno, AHORA), false);
  const alumno2 = alumnoCon([
    { supervisorUserId: DOC, startsAt: new Date(AHORA.getTime() - DIA), endsAt: "basura" },
  ]);
  assert.equal(eduScopeCoversStudent(SUPERVISADO, alumno2, AHORA), false);
});

test("el ALUMNO solo se cubre a sí mismo, y 'none' no cubre a nadie", () => {
  const propio: EduVisibilityScope = { kind: "own", studentUserId: "al_1" };
  assert.equal(eduScopeCoversStudent(propio, alumnoCon([], "al_1"), AHORA), true);
  assert.equal(eduScopeCoversStudent(propio, alumnoCon([], "al_2"), AHORA), false);

  assert.equal(eduScopeCoversStudent({ kind: "none" }, alumnoCon([], "al_1"), AHORA), false);
  assert.equal(eduScopeCoversStudent({ kind: "all" }, alumnoCon([], "al_1"), AHORA), true);
  // Basura de entrada: se niega en vez de adivinar.
  assert.equal(eduScopeCoversStudent(SUPERVISADO, null as never, AHORA), false);
});

// ─────────────────────────────────────────────────────────────────────
// 6 · Constantes que otras capas dan por buenas
// ─────────────────────────────────────────────────────────────────────

test("los estados que LIBERAN el sillón son exactamente cancelada y no llegó", () => {
  assert.deepEqual([...EDU_APPOINTMENT_FREE_STATUSES].sort(), ["CANCELLED", "NO_SHOW"]);
  // Una cita TERMINADA sigue ocupando su hueco: ocurrió.
  assert.equal(EDU_APPOINTMENT_FREE_STATUSES.includes("COMPLETED"), false);
  for (const s of EDU_APPOINTMENT_FREE_STATUSES) {
    assert.ok(EDU_APPOINTMENT_STATUSES.includes(s), `${s} no está en el catálogo de estados`);
  }
});

test("los estados finales del caso son los tres del contrato", () => {
  assert.deepEqual([...EDU_CASE_CLOSED_STATUSES].sort(), [
    "ABANDONED",
    "COMPLETED",
    "TRANSFERRED",
  ]);
  for (const s of EDU_CASE_CLOSED_STATUSES) {
    assert.ok(EDU_CASE_STATUSES.includes(s), `${s} no está en el catálogo de estados del caso`);
  }
});
