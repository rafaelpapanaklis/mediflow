/**
 * LAS SEDES — la prueba de la Ola 11 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-sedes.test.ts
 *
 * Todo esto se comprueba SIN base de datos: campus-core.ts y visibility.ts
 * devuelven objetos y `where`, y no ejecutan nada. Aquí se lee exactamente
 * lo que Prisma recibiría.
 *
 * Lo que fija este archivo, en dos mitades:
 *
 *  A · QUE LAS REGLAS VIEJAS SIGUEN VALIENDO. Esta ola AMPLÍA el punto
 *      único de visibilidad, y ampliar es la forma más fácil de romper sin
 *      darse cuenta. Se vuelve a fijar aquí la matriz rol × recurso
 *      completa, la vigencia del docente, el "caja no ve casos", el "el
 *      dinero no es de docentes ni de alumnos" y el traspaso de la Ola 6 —
 *      todo ello CON y SIN sede puesta.
 *
 *  B · LA REGLA NUEVA, y sobre todo sus dos filos:
 *      1. sin filas de acceso = TODAS las sedes (si no, aplicar la ola
 *         dejaría fuera a todo el mundo);
 *      2. `campusIds: []` NO es `campusIds: null`. El primero no devuelve
 *         ni una fila; el segundo devuelve el instituto entero. Se
 *         escriben casi igual y uno de los dos es una fuga.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_CAMPUS_ALL,
  eduCampusAccessFromRows,
  eduCampusForCharge,
  eduCampusLabel,
  eduResolveCampusScope,
  eduWithCampus,
  normalizeEduCampusCode,
  suggestEduCampusCode,
  type EduCampusOption,
  type EduCampusScope,
} from "../campus-core";
import {
  eduAppointmentScopeWhere,
  eduCampusCovers,
  eduCampusScopeWhere,
  eduCaseScopeWhere,
  eduChairScopeWhere,
  eduChargeScopeWhere,
  eduPatientScopeWhere,
  eduPaymentScopeWhere,
  eduStudentScopeWhere,
  eduVisibility,
  type EduVisibilityResource,
  type EduVisibilityScope,
} from "../visibility";
import { EDU_ROLE_DEFAULTS, getEduEffectivePermissions, hasEduPermission } from "../permissions";
import type { EduRole } from "../types";

// ─────────────────────────────────────────────────────────────────────
// Utilería
// ─────────────────────────────────────────────────────────────────────
const INST = "inst_1";
const OTRA_ESCUELA = "inst_2";
const AHORA = new Date("2026-08-30T18:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

const CDMX = "America/Mexico_City";
const TIJUANA = "America/Tijuana";

const ROLES: EduRole[] = ["DIRECCION", "DOCENTE", "ALUMNO", "CAJA"];

function sede(
  id: string,
  extra: Partial<EduCampusOption> = {},
): EduCampusOption {
  return {
    id,
    name: `Campus ${id.toUpperCase()}`,
    code: id.toUpperCase(),
    timezone: CDMX,
    isActive: true,
    ...extra,
  };
}

const NORTE = sede("norte");
const SUR = sede("sur");
const TIJU = sede("tiju", { timezone: TIJUANA });

function resolver(input: {
  campuses?: EduCampusOption[];
  access?: Parameters<typeof eduResolveCampusScope>[0]["access"];
  requested?: string | null;
  tz?: string;
}): EduCampusScope {
  return eduResolveCampusScope({
    campuses: input.campuses ?? [NORTE, SUR],
    access: input.access ?? { kind: "all" },
    requested: input.requested ?? null,
    institutionTimezone: input.tz ?? CDMX,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// A · LAS REGLAS VIEJAS SIGUEN VALIENDO
//
// La ola AMPLÍA visibility.ts. Si algo de esta sección se pone rojo, la
// sede rompió una regla que ya existía — y ésa, no la nueva, es la que
// tiene pacientes detrás.
// ═══════════════════════════════════════════════════════════════════════

test("VIEJA · la matriz rol × recurso no cambió ni un valor", () => {
  const esperado: Record<EduRole, Record<EduVisibilityResource, string>> = {
    DIRECCION: { patients: "all", appointments: "all", cases: "all", charges: "all" },
    CAJA: { patients: "all", appointments: "all", cases: "none", charges: "all" },
    DOCENTE: {
      patients: "supervised",
      appointments: "supervised",
      cases: "supervised",
      charges: "none",
    },
    ALUMNO: { patients: "own", appointments: "own", cases: "own", charges: "none" },
  };

  for (const rol of ROLES) {
    for (const recurso of ["patients", "appointments", "cases", "charges"] as EduVisibilityResource[]) {
      assert.equal(
        eduVisibility({ role: rol, eduUserId: "u_1" }, recurso).kind,
        esperado[rol][recurso],
        `${rol} sobre ${recurso}`,
      );
    }
  }
});

test("VIEJA · CAJA no ve casos, y ponerle una sede no se los abre", () => {
  const scope = eduVisibility({ role: "CAJA", eduUserId: "u_caja" }, "cases");
  assert.equal(scope.kind, "none");
  // Ni con sede ni sin ella: el recorte por rol se decide ANTES.
  assert.deepEqual(eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA }), {
    institutionId: INST,
    id: { in: [] },
  });
});

test("VIEJA · el DINERO no es de docentes ni de alumnos, con sede o sin ella", () => {
  for (const rol of ["DOCENTE", "ALUMNO"] as EduRole[]) {
    const scope = eduVisibility({ role: rol, eduUserId: "u_1" }, "charges");
    assert.equal(scope.kind, "none", rol);

    // Con una sede puesta el `where` sigue sin devolver una sola fila: el
    // filtro de sede se SUMA, nunca sustituye al recorte por rol.
    const conSede = eduChargeScopeWhere({ institutionId: INST, scope, campusIds: ["norte"] });
    assert.deepEqual(conSede, { institutionId: INST, id: { in: [] } });
    assert.equal("campusId" in conSede, false, "un alcance vacío no necesita filtro de sede");

    assert.deepEqual(eduPaymentScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
      id: { in: [] },
    });
  }
});

test("VIEJA · una asignación VENCIDA sigue sin dar acceso (el docente que rotó)", () => {
  const scope: EduVisibilityScope = { kind: "supervised", supervisorUserId: "doc_1" };
  const where = eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA });

  const asignacion = (where.student as Record<string, any>).supervisors.some;
  assert.equal(asignacion.supervisorUserId, "doc_1");
  assert.deepEqual(asignacion.startsAt, { lte: AHORA });
  assert.deepEqual(asignacion.OR, [{ endsAt: null }, { endsAt: { gt: AHORA } }]);
  // Y el tenant, dentro de la relación.
  assert.equal(asignacion.institutionId, INST);
});

test("VIEJA · el institutionId sigue siendo obligatorio en TODOS los helpers", () => {
  const scope: EduVisibilityScope = { kind: "all" };
  const vacios = ["", null as unknown as string, undefined as unknown as string];

  for (const malo of vacios) {
    assert.throws(() => eduPatientScopeWhere({ institutionId: malo, scope }), /institutionId/);
    assert.throws(() => eduAppointmentScopeWhere({ institutionId: malo, scope }), /institutionId/);
    assert.throws(() => eduCaseScopeWhere({ institutionId: malo, scope }), /institutionId/);
    assert.throws(() => eduStudentScopeWhere({ institutionId: malo, scope }), /institutionId/);
    assert.throws(() => eduChargeScopeWhere({ institutionId: malo, scope }), /institutionId/);
    // Y los DOS nuevos, que si no lo exigieran serían la puerta de atrás.
    assert.throws(() => eduChairScopeWhere({ institutionId: malo }), /institutionId/);
    assert.throws(() => eduCampusScopeWhere({ institutionId: malo }), /institutionId/);
  }
});

test("VIEJA · el caso TRANSFERIDO sigue quitándole el paciente al alumno saliente", () => {
  const where = eduPatientScopeWhere({
    institutionId: INST,
    scope: { kind: "own", studentUserId: "u_alumno" },
    now: AHORA,
  });
  const [porCaso, porCita] = where.OR as Record<string, any>[];
  assert.deepEqual(porCaso.cases.some.status, { not: "TRANSFERRED" });
  assert.deepEqual(porCita.appointments.some.OR, [
    { caseId: null },
    { case: { status: { not: "TRANSFERRED" } } },
  ]);
});

test("VIEJA · SIN sede, el `where` de citas es EXACTAMENTE el de antes", () => {
  const scope: EduVisibilityScope = { kind: "all" };

  // Sin la clave: el caso de todas las pantallas que no filtran por sede
  // (la ficha del paciente, /mi-dia). No aparece `chair` por ningún lado.
  const sinClave = eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.deepEqual(sinClave, { institutionId: INST });

  // Con la clave a null y a undefined: lo mismo. `null` = "sin recorte".
  assert.deepEqual(
    eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA, campusIds: null }),
    { institutionId: INST },
  );
  assert.deepEqual(
    eduAppointmentScopeWhere({ institutionId: INST, scope, now: AHORA, campusIds: undefined }),
    { institutionId: INST },
  );
});

test("VIEJA · los recursos que NO cuelgan de una sede no la aceptan", () => {
  // Pacientes, casos y alumnos NO se recortan por sede: un paciente se
  // atiende donde haga falta y un alumno ROTA. Si algún día alguien les
  // agrega un campusId, esta prueba se entera — y hay que pensarlo dos
  // veces, porque partiría el expediente de una persona en dos mitades.
  const scope: EduVisibilityScope = { kind: "all" };
  assert.deepEqual(eduPatientScopeWhere({ institutionId: INST, scope }), { institutionId: INST });
  assert.deepEqual(eduCaseScopeWhere({ institutionId: INST, scope }), { institutionId: INST });
  assert.deepEqual(eduStudentScopeWhere({ institutionId: INST, scope }), { institutionId: INST });
});

test("VIEJA · los defaults de permisos de las olas anteriores no se movieron", () => {
  // Se comprueban las líneas que las olas anteriores declararon como
  // contrato, no la lista entera (que crece cada ola).
  assert.equal(hasEduPermission({ role: "CAJA" }, "expediente.view"), false);
  assert.equal(hasEduPermission({ role: "CAJA" }, "casos.view"), false);
  assert.equal(hasEduPermission({ role: "CAJA" }, "consentimientos.view"), true);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "caja.view"), false);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "autorizaciones.decide"), false);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "evaluacion.grade"), false);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "autorizaciones.request"), false);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "rubricas.manage"), false);
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "equipo.manage"), true);
});

// ═══════════════════════════════════════════════════════════════════════
// B · LA REGLA NUEVA
// ═══════════════════════════════════════════════════════════════════════

// ── B.1 · Sin filas = todas ────────────────────────────────────────────

test("🔴 SIN FILAS DE ACCESO = TODAS LAS SEDES (o aplicar la ola deja fuera a todo el mundo)", () => {
  assert.deepEqual(eduCampusAccessFromRows([], [NORTE, SUR]), { kind: "all" });
  assert.deepEqual(eduCampusAccessFromRows(null, [NORTE, SUR]), { kind: "all" });
  assert.deepEqual(eduCampusAccessFromRows(undefined, [NORTE, SUR]), { kind: "all" });

  // Y el alcance resultante NO filtra: `null`, no una lista con todas.
  const scope = resolver({ access: { kind: "all" } });
  assert.equal(scope.campusIds, null);
  assert.equal(scope.locked, false);
});

test("🔴 CON filas, solo esas sedes", () => {
  const acceso = eduCampusAccessFromRows([{ campusId: "norte" }], [NORTE, SUR]);
  assert.deepEqual(acceso, { kind: "some", campusIds: ["norte"] });

  const scope = resolver({ access: acceso });
  assert.deepEqual(scope.campusIds, ["norte"]);
  assert.deepEqual(
    scope.options.map((c) => c.id),
    ["norte"],
  );
  assert.equal(scope.showPicker, false, "una sola opción NO pinta selector");
  assert.equal(scope.allLabel, "Todas mis sedes", "no son todas las del instituto");
});

test("🔴 filas que apuntan a sedes que ya no existen = NINGUNA sede, no todas", () => {
  // Es el filo peligroso de "sin filas = todas": una lista RESUELTA vacía
  // no es lo mismo que no tener filas. Quien fue restringido sigue
  // restringido aunque su sede desaparezca.
  const acceso = eduCampusAccessFromRows([{ campusId: "fantasma" }], [NORTE, SUR]);
  assert.deepEqual(acceso, { kind: "some", campusIds: [] });

  const scope = resolver({ access: acceso });
  assert.deepEqual(scope.campusIds, [], "tiene que ser [] y JAMÁS null");
  assert.notEqual(scope.campusIds, null);
  assert.equal(scope.locked, true);
  assert.deepEqual(scope.options, []);
});

test("🔴 una fila con la sede de OTRA escuela no se cuela", () => {
  // El cruce con las sedes del instituto es lo que cierra el tenant: la
  // sede es una división DENTRO de una escuela, nunca el aislamiento entre
  // escuelas.
  const acceso = eduCampusAccessFromRows(
    [{ campusId: "norte" }, { campusId: "sede_de_otra_escuela" }],
    [NORTE, SUR],
  );
  assert.deepEqual(acceso, { kind: "some", campusIds: ["norte"] });
});

test("las filas repetidas no duplican la sede", () => {
  assert.deepEqual(
    eduCampusAccessFromRows([{ campusId: "norte" }, { campusId: "norte" }], [NORTE, SUR]),
    { kind: "some", campusIds: ["norte"] },
  );
});

// ── B.2 · El selector ──────────────────────────────────────────────────

test("🔴 con UNA sola sede el selector NO se pinta (nadie elige entre una opción)", () => {
  const scope = resolver({ campuses: [NORTE] });
  assert.equal(scope.showPicker, false);
  assert.equal(scope.campusIds, null, "con una sola sede no hace falta filtrar nada");
});

test("SIN sedes (la ola sin aplicar, o un instituto recién creado) todo sigue como antes", () => {
  const scope = resolver({ campuses: [] });
  assert.equal(scope.campusIds, null);
  assert.equal(scope.showPicker, false);
  assert.equal(scope.locked, false);
  assert.equal(scope.timezone, CDMX, "cae a la zona del instituto");
});

test("con DOS sedes se pinta el selector, y la vista por defecto es la consolidada", () => {
  const scope = resolver({});
  assert.equal(scope.showPicker, true);
  assert.equal(scope.activeId, null);
  assert.equal(scope.campusIds, null);
  assert.equal(scope.allLabel, "Todas las sedes");
});

test("elegir una sede recorta a esa sede y trae SU zona horaria", () => {
  const scope = resolver({ campuses: [NORTE, TIJU], requested: "tiju" });
  assert.deepEqual(scope.campusIds, ["tiju"]);
  assert.equal(scope.activeId, "tiju");
  assert.equal(scope.timezone, TIJUANA, "la agenda de esa sede va en SU hora");
  assert.equal(scope.mixedTimezones, false, "con una sede elegida no hay mezcla");
});

test('el valor "todas" de la cookie es la vista consolidada, no una sede', () => {
  const scope = resolver({ requested: EDU_CAMPUS_ALL });
  assert.equal(scope.activeId, null);
  assert.equal(scope.campusIds, null);
});

test("🔴 una cookie que pide una sede AJENA se degrada a lo suyo, nunca amplía", () => {
  const scope = resolver({
    campuses: [NORTE, SUR],
    access: { kind: "some", campusIds: ["norte"] },
    requested: "sur",
  });
  assert.deepEqual(scope.campusIds, ["norte"], "no puede acabar viendo la sede que no es suya");
  assert.equal(scope.activeId, null);
});

test("una cookie con una sede de otra escuela tampoco abre nada", () => {
  const scope = resolver({ requested: "sede_de_otra_escuela" });
  assert.equal(scope.activeId, null);
  assert.equal(scope.campusIds, null, "vuelve a la consolidada DE LO SUYO");
});

test("una sede CERRADA no se ofrece en el selector… salvo si es la que estás viendo", () => {
  const cerrada = sede("vieja", { isActive: false });

  const sinElegir = resolver({ campuses: [NORTE, SUR, cerrada] });
  assert.deepEqual(
    sinElegir.options.map((c) => c.id),
    ["norte", "sur"],
    "una sede cerrada es ruido en el selector",
  );

  // Pero si alguien tenía esa sede elegida (un enlace guardado), se sigue
  // ofreciendo: si no, la pantalla saltaría de sede sin decir nada.
  const elegida = resolver({ campuses: [NORTE, SUR, cerrada], requested: "vieja" });
  assert.equal(elegida.activeId, "vieja");
  assert.ok(elegida.options.some((c) => c.id === "vieja"));
});

test("husos distintos en la vista consolidada: se AVISA en vez de mentir", () => {
  const mezcla = resolver({ campuses: [NORTE, TIJU] });
  assert.equal(mezcla.mixedTimezones, true);
  assert.equal(mezcla.timezone, CDMX, "cae a la del instituto y la pantalla lo dice");

  const mismas = resolver({ campuses: [NORTE, SUR] });
  assert.equal(mismas.mixedTimezones, false);
});

// ── B.3 · El `where`: null NO es [] ────────────────────────────────────

test("🔴 EL FILO: `null` no filtra, `[]` no devuelve nada", () => {
  // Sillones.
  assert.deepEqual(eduChairScopeWhere({ institutionId: INST, campusIds: null }), {
    institutionId: INST,
  });
  assert.deepEqual(eduChairScopeWhere({ institutionId: INST, campusIds: [] }), {
    institutionId: INST,
    campusId: { in: [] },
  });

  // Sedes.
  assert.deepEqual(eduCampusScopeWhere({ institutionId: INST, campusIds: null }), {
    institutionId: INST,
  });
  assert.deepEqual(eduCampusScopeWhere({ institutionId: INST, campusIds: [] }), {
    institutionId: INST,
    id: { in: [] },
  });

  // Citas.
  const scope: EduVisibilityScope = { kind: "all" };
  const vacio = eduAppointmentScopeWhere({ institutionId: INST, scope, campusIds: [] });
  assert.deepEqual(vacio.chair, { institutionId: INST, campusId: { in: [] } });

  // Cobros.
  assert.deepEqual(eduChargeScopeWhere({ institutionId: INST, scope, campusIds: [] }), {
    institutionId: INST,
    campusId: { in: [] },
  });
});

test("🔴 la sede de una CITA cuelga del SILLÓN, no de una columna copiada", () => {
  const where = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "all" },
    campusIds: ["norte", "sur"],
  });
  assert.deepEqual(where.chair, {
    institutionId: INST,
    campusId: { in: ["norte", "sur"] },
  });
  // Y NO hay un campusId suelto en la cita: si alguien lo agregara, un
  // sillón que se muda de edificio dejaría sus citas en el viejo.
  assert.equal("campusId" in where, false);
});

test("la sede se SUMA al recorte por persona: un alumno sigue viendo solo lo suyo", () => {
  const where = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "own", studentUserId: "u_alumno" },
    now: AHORA,
    campusIds: ["norte"],
  });
  assert.deepEqual(where.student, { institutionId: INST, userId: "u_alumno" });
  assert.deepEqual(where.chair, { institutionId: INST, campusId: { in: ["norte"] } });
  assert.equal(where.institutionId, INST);
});

test("el filtro de especialidad y el de sede conviven sin pisarse", () => {
  const where = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "supervised", supervisorUserId: "doc_1" },
    now: AHORA,
    studentExtra: { programId: "prog_endo" },
    campusIds: ["norte"],
  });
  const student = where.student as Record<string, any>;
  assert.equal(student.programId, "prog_endo", "el filtro de pantalla");
  assert.ok(student.supervisors, "y el recorte del docente");
  assert.deepEqual(where.chair, { institutionId: INST, campusId: { in: ["norte"] } });
});

test("el tenant se repite DENTRO de la relación del sillón", () => {
  // Sin esto, un campusId de otra escuela (por una fila cruzada a mano)
  // podría emparejar. La sede NUNCA es el filtro de tenant.
  const where = eduAppointmentScopeWhere({
    institutionId: OTRA_ESCUELA,
    scope: { kind: "all" },
    campusIds: ["norte"],
  });
  assert.equal((where.chair as Record<string, any>).institutionId, OTRA_ESCUELA);
});

test("un alcance vacío gana a la sede: primero se decide de quién es la fila", () => {
  const where = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "none" },
    campusIds: ["norte"],
  });
  assert.deepEqual(where, { institutionId: INST, id: { in: [] } });
});

// ── B.4 · Escrituras: ¿puedo tocar esta fila? ──────────────────────────

test("eduCampusCovers: sin recorte deja pasar; con recorte, solo lo suyo", () => {
  assert.equal(eduCampusCovers(null, "norte"), true, "sin sedes, todo pasa");
  assert.equal(eduCampusCovers(undefined, "norte"), true);
  assert.equal(eduCampusCovers(["norte"], "norte"), true);
  assert.equal(eduCampusCovers(["norte"], "sur"), false);
  assert.equal(eduCampusCovers([], "norte"), false, "lista vacía = ninguna sede");
  // Una fila SIN sede con el recorte puesto no pasa: no se puede afirmar
  // que esté en una sede a la que entras.
  assert.equal(eduCampusCovers(["norte"], null), false);
  assert.equal(eduCampusCovers(["norte"], undefined), false);
});

// ── B.5 · El cobro: "todas" no es un lugar ─────────────────────────────

test("🔴 con la vista consolidada y varias sedes NO se puede cobrar", () => {
  const scope = resolver({});
  const out = eduCampusForCharge(scope);
  assert.equal(out.ok, false);
  assert.match(out.reason ?? "", /Elige arriba/);
});

test("con una sede elegida, el cobro se sella con ésa", () => {
  const out = eduCampusForCharge(resolver({ requested: "sur" }));
  assert.equal(out.ok, true);
  assert.equal(out.campusId, "sur");
});

test("con UNA sola sede no se pregunta nada: se sella la única", () => {
  const out = eduCampusForCharge(resolver({ campuses: [NORTE] }));
  assert.equal(out.ok, true);
  assert.equal(out.campusId, "norte");
});

test("sin sedes, el cobro sale igual y sin sede (el dinero no se detiene)", () => {
  const out = eduCampusForCharge(resolver({ campuses: [] }));
  assert.equal(out.ok, true);
  assert.equal(out.campusId, null);
});

test("sin acceso a ninguna sede no se cobra, y el mensaje dice qué hacer", () => {
  const scope = resolver({ access: { kind: "some", campusIds: [] } });
  const out = eduCampusForCharge(scope);
  assert.equal(out.ok, false);
  assert.match(out.reason ?? "", /dirección/);
});

// ── B.6 · Utilería ─────────────────────────────────────────────────────

test("eduWithCampus deja el contexto intacto y le suma la sede", () => {
  const ctx = { institutionId: INST, eduUserId: "u_1", role: "DIRECCION" as EduRole };
  const conSede = eduWithCampus(ctx, resolver({ requested: "norte" }));
  assert.equal(conSede.institutionId, INST, "el tenant no se toca");
  assert.equal(conSede.eduUserId, "u_1");
  assert.equal(conSede.role, "DIRECCION");
  assert.deepEqual(conSede.campusIds, ["norte"]);

  // Sin alcance (una llamada que no filtra por sede) → sin recorte.
  assert.equal(eduWithCampus(ctx, null).campusIds, null);
});

test("la clave de la sede se normaliza: MAYÚSCULAS y sin espacios", () => {
  assert.equal(normalizeEduCampusCode(" norte "), "NORTE");
  assert.equal(normalizeEduCampusCode("campus norte"), "CAMPUSNORTE");
  assert.equal(normalizeEduCampusCode(""), null);
  assert.equal(normalizeEduCampusCode("   "), null);
  assert.equal(normalizeEduCampusCode(null), null);
  assert.equal(normalizeEduCampusCode(123), null);
  assert.equal(normalizeEduCampusCode("x".repeat(21)), null, "no pasa del máximo");
});

test("la clave propuesta sale del nombre, sin acentos ni signos", () => {
  assert.equal(suggestEduCampusCode("Campus Norte"), "CAMPUSNORTE");
  assert.equal(suggestEduCampusCode("Clínica de Posgrado"), "CLINICADEPOSGRADO");
  assert.equal(suggestEduCampusCode("CU-2"), "CU2");
  assert.equal(suggestEduCampusCode(""), "");
});

test("la etiqueta de una sede lleva el nombre delante y la clave detrás", () => {
  assert.equal(eduCampusLabel({ name: "Campus Norte", code: "NORTE" }), "Campus Norte (NORTE)");
  assert.equal(eduCampusLabel({ name: "Campus Norte", code: "" }), "Campus Norte");
  assert.equal(eduCampusLabel(null), "");
});

// ── B.7 · Los permisos de la ola ───────────────────────────────────────

test("🔴 sedes.view y sedes.manage son SOLO de DIRECCION", () => {
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "sedes.view"), true);
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "sedes.manage"), true);

  for (const rol of ["DOCENTE", "ALUMNO", "CAJA"] as EduRole[]) {
    assert.equal(hasEduPermission({ role: rol }, "sedes.view"), false, rol);
    assert.equal(hasEduPermission({ role: rol }, "sedes.manage"), false, rol);
  }
});

test("🔴 CAMBIAR de sede no necesita ninguna key de esta ola", () => {
  // Es la decisión de diseño de la ola, y por eso se prueba: si mañana
  // alguien le exigiera "sedes.view" al selector o al filtro, el día que se
  // aplicara la ola un docente se quedaría sin poder mirar su propia
  // agenda. Lo único que hace falta para moverse entre sedes es ENTRAR al
  // panel — el resto lo decide el ACCESO, que no es un permiso.
  for (const rol of ROLES) {
    assert.equal(hasEduPermission({ role: rol }, "inicio.view"), true, rol);
  }
  assert.equal(EDU_ROLE_DEFAULTS.DOCENTE.includes("sedes.view"), false);
  assert.equal(EDU_ROLE_DEFAULTS.CAJA.includes("sedes.view"), false);
});

test("un permiso NUEVO no le llega solo a quien ya tiene override", () => {
  // Es la razón de que el .sql traiga su bloque comentado de backfill. Se
  // vuelve a fijar aquí con las keys de ESTA ola.
  const conOverride = { role: "DIRECCION" as EduRole, permissionsOverride: ["inicio.view"] };
  assert.deepEqual(getEduEffectivePermissions(conOverride), ["inicio.view"]);
  assert.equal(hasEduPermission(conOverride, "sedes.view"), false);

  // Y con el override vacío sí: cae al default del rol.
  assert.equal(hasEduPermission({ role: "DIRECCION", permissionsOverride: [] }, "sedes.view"), true);
});

// ── B.8 · Un día en la vida de una universidad de dos campus ───────────

test("recorrido completo: docente del norte, alumno del sur, dirección en las dos", () => {
  const campuses = [NORTE, TIJU];

  // El docente está marcado SOLO en el norte.
  const docente = eduResolveCampusScope({
    campuses,
    access: eduCampusAccessFromRows([{ campusId: "norte" }], campuses),
    requested: null,
    institutionTimezone: CDMX,
  });
  assert.deepEqual(docente.campusIds, ["norte"]);
  assert.equal(docente.showPicker, false, "con una sola sede suya, no elige nada");

  // Su agenda: sus alumnos vigentes Y solo el norte.
  const suAgenda = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "supervised", supervisorUserId: "doc_1" },
    now: AHORA,
    campusIds: docente.campusIds,
  });
  assert.ok((suAgenda.student as Record<string, any>).supervisors);
  assert.deepEqual(suAgenda.chair, { institutionId: INST, campusId: { in: ["norte"] } });

  // El alumno no tiene filas: rota, así que entra a las dos.
  const alumno = eduResolveCampusScope({
    campuses,
    access: eduCampusAccessFromRows([], campuses),
    requested: null,
    institutionTimezone: CDMX,
  });
  assert.equal(alumno.campusIds, null);
  assert.equal(alumno.showPicker, true);
  assert.equal(alumno.mixedTimezones, true, "sus dos sedes están en husos distintos");

  // Y lo que ve sigue siendo LO SUYO, en las dos sedes.
  const suDia = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "own", studentUserId: "u_alumno" },
    now: AHORA,
    campusIds: alumno.campusIds,
  });
  assert.deepEqual(suDia.student, { institutionId: INST, userId: "u_alumno" });
  assert.equal("chair" in suDia, false, "sin recorte de sede no se mete un chair vacío");

  // La dirección elige el campus de Tijuana: su caja se recorta a esa sede
  // y la hora pasa a ser la de allá.
  const direccion = eduResolveCampusScope({
    campuses,
    access: { kind: "all" },
    requested: "tiju",
    institutionTimezone: CDMX,
  });
  assert.equal(direccion.timezone, TIJUANA);
  assert.deepEqual(
    eduChargeScopeWhere({
      institutionId: INST,
      scope: eduVisibility({ role: "DIRECCION", eduUserId: "u_dir" }, "charges"),
      campusIds: direccion.campusIds,
    }),
    { institutionId: INST, campusId: { in: ["tiju"] } },
  );
});

test("el ayer del docente sigue siendo suyo aunque le quiten la sede de hoy", () => {
  // Cerrar una sede NO borra nada: sus sillones y sus citas siguen ahí, y
  // quien tiene acceso a esa sede los sigue viendo. Lo único que cambia es
  // que deja de ofrecerse en el selector.
  const cerrada = sede("vieja", { isActive: false });
  const scope = resolver({
    campuses: [NORTE, cerrada],
    access: { kind: "some", campusIds: ["vieja"] },
  });
  assert.deepEqual(scope.campusIds, ["vieja"], "sigue viendo lo de su sede cerrada");
  assert.equal(scope.locked, false);
  assert.deepEqual(scope.options, [], "pero no la puede elegir: está cerrada");
  assert.equal(scope.showPicker, false);

  const donde = eduCampusForCharge(scope);
  assert.equal(donde.ok, true);
  assert.equal(donde.campusId, null, "y no puede sellar un cobro en una sede cerrada");
});
