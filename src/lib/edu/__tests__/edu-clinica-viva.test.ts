/**
 * LA CLÍNICA EN VIVO (/instituto/clinica) — el tablero de sillones.
 *
 * Run:  npm run test:edu
 *       npx tsx --test src/lib/edu/__tests__/edu-clinica-viva.test.ts
 *
 * Lo que fija este archivo, en orden:
 *   1. LA TRADUCCIÓN DE ESTADOS. El motor que se importa es el del dental y
 *      no conoce IN_CHAIR; si esa traducción se pierde, un paciente sentado
 *      esperando a su docente deja el sillón pintado de LIBRE.
 *   2. LA TRAMPA DEL MOTOR IMPORTADO: `getChairStatus` y
 *      `getChairAppointment` NO contestan lo mismo, y preguntarlas por
 *      separado daría una tarjeta "Libre" con un paciente dentro.
 *   3. LA SEDE. Dos sedes tienen cada una su "Sillón 1" —el número es único
 *      dentro de la sede, no del instituto— así que el número no puede
 *      usarse para emparejar nada.
 *   4. QUIÉN ENTRA. ALUMNO y CAJA no, y no por una sola cerradura: ni el
 *      permiso ni el alcance les dejan, y la API contesta 403 por las dos.
 *
 * ⚠️ POR QUÉ CASI TODAS LAS HORAS SE CONSTRUYEN COMO `Date.now() + offset`
 * Y NO CON UN INSTANTE FIJO: el motor del dental cambia de criterio cuando
 * el `viewTime` se aleja más de 90 s del reloj (ahí sirve a un timeline que
 * "viaja en el tiempo"). Esta pantalla siempre es AHORA, así que las
 * pruebas tienen que caer del lado en vivo o estarían comprobando otra
 * función. Las dos que sí usan un instante fijo lo dicen y explican por qué
 * ahí da lo mismo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_VIVA_MAX_CITAS,
  EDU_VIVA_PROXIMA_MIN,
  EDU_VIVA_REFRESCO_MS,
  EDU_VIVA_STATUS,
  EDU_VIVA_TIC_MS,
  EDU_VIVA_VENTANA_HORAS,
  buildEduVivaBoard,
  eduVivaCard,
  eduVivaLiveAppt,
  eduVivaOcupa,
  type EduVivaApptInput,
  type EduVivaChairInput,
} from "../clinica-viva-core";
import { getChairStatus } from "@/lib/floor-plan/live-mode";
import {
  EDU_LIVE_FLOOR_NONE_DETAIL,
  eduCampusCovers,
  eduChairScopeWhere,
  eduLiveFloorVisibility,
  eduScopeCoversStudent,
} from "../visibility";
import { eduResolveCampusScope } from "../campus-core";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  hasEduPermission,
} from "../permissions";
import { EDU_APPOINTMENT_STATUSES, EDU_NAV_ITEMS, EDU_NAV_LABELS } from "../types";
import type { EduAppointmentStatus, EduRole } from "../types";

const TZ = "America/Mexico_City";
const INST = "inst_1";

/** Horas relativas al reloj de verdad — ver la nota de cabecera. */
const AHORA = new Date();
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);

function sillon(over: Partial<EduVivaChairInput> = {}): EduVivaChairInput {
  return {
    id: "chair_1",
    name: "Sillón 1",
    number: 1,
    campusId: "sede_norte",
    campusName: "Campus Norte",
    campusTimezone: TZ,
    ...over,
  };
}

function cita(over: Partial<EduVivaApptInput> = {}): EduVivaApptInput {
  return {
    id: "appt_1",
    chairId: "chair_1",
    startsAt: min(-20),
    endsAt: min(40),
    status: "IN_PROGRESS",
    patientName: "María González Ruiz",
    patientFolio: "P-0007",
    studentName: "Ana Pérez",
    studentMatricula: "A-01",
    specialty: "Endodoncia",
    detail: true,
    ...over,
  };
}

// ═════════════════════════════════════════════════════════════════════
// 1 · LA TRADUCCIÓN DE ESTADOS
// ═════════════════════════════════════════════════════════════════════

test("🔴 IN_CHAIR e IN_PROGRESS ocupan el sillón; los demás no", () => {
  // IN_CHAIR es LA traducción de esta ola: el dental no tiene ese estado y
  // su motor solo pinta rojo con IN_PROGRESS. Sin el mapeo, el paciente que
  // ya está sentado esperando a su docente deja la unidad en verde.
  assert.equal(eduVivaOcupa("IN_CHAIR"), true, "un paciente SENTADO ocupa el sillón");
  assert.equal(eduVivaOcupa("IN_PROGRESS"), true);

  assert.equal(eduVivaOcupa("SCHEDULED"), false);
  assert.equal(eduVivaOcupa("CHECKED_IN"), false, "llegó a recepción no es estar en el sillón");
  assert.equal(eduVivaOcupa("COMPLETED"), false);
  assert.equal(eduVivaOcupa("CANCELLED"), false);
  assert.equal(eduVivaOcupa("NO_SHOW"), false);
});

test("🔴 los DOS estados que ocupan pintan la tarjeta OCUPADA de verdad", () => {
  for (const status of ["IN_CHAIR", "IN_PROGRESS"] as EduAppointmentStatus[]) {
    const card = eduVivaCard(sillon(), [cita({ status })], AHORA);
    assert.equal(card.state, "ocupado", `${status} debería ocupar`);
    assert.equal(card.patient, "María González Ruiz");
    assert.equal(card.specialty, "Endodoncia");
    assert.equal(card.student, "Ana Pérez");
    // "Cuánto lleva" sale del inicio de la cita, no de cuándo se marcó.
    assert.equal(card.elapsedMin, 20);
    assert.ok(card.progress !== null && card.progress > 0 && card.progress < 1);
    assert.ok(card.startLabel && card.startLabel.length === 5, "hora HH:MM de su sede");
  }
});

test("el catálogo de estados está COMPLETO (una ola que añada uno se entera aquí)", () => {
  // Si un estado nuevo entra al enum y nadie decide si ocupa el sillón,
  // esto se pone rojo en vez de dejarlo caer en un `default` silencioso.
  for (const s of EDU_APPOINTMENT_STATUSES) {
    assert.ok(s in EDU_VIVA_STATUS, `EDU_VIVA_STATUS no decide qué hacer con ${s}`);
  }
  assert.equal(
    Object.keys(EDU_VIVA_STATUS).length,
    EDU_APPOINTMENT_STATUSES.length,
    "EDU_VIVA_STATUS tiene claves que ya no están en el enum",
  );
});

test("lo MUERTO no viaja al motor: ni ocupa ni se anuncia como próxima", () => {
  // `getNextChairAppointment` del dental devuelve la próxima cita SIN mirar
  // su estado. Si una cancelada llegara al motor, un sillón que va a estar
  // libre anunciaría "próxima 16:00".
  for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW"] as EduAppointmentStatus[]) {
    assert.equal(eduVivaLiveAppt(cita({ status })), null, `${status} no debería viajar`);

    const enCurso = eduVivaCard(sillon(), [cita({ status })], AHORA);
    assert.equal(enCurso.state, "libre", `${status} dejó el sillón ocupado`);
    assert.equal(enCurso.patient, null);

    const futura = eduVivaCard(
      sillon(),
      [cita({ status, startsAt: min(10), endsAt: min(70) })],
      AHORA,
    );
    assert.equal(futura.state, "libre", `${status} se anunció como próxima`);
    assert.equal(futura.nextLabel, null, `${status} salió como "siguiente"`);
  }
});

test("CHECKED_IN es PRÓXIMA, no ocupada: el paciente está en recepción", () => {
  const card = eduVivaCard(
    sillon(),
    [cita({ status: "CHECKED_IN", startsAt: min(12), endsAt: min(72) })],
    AHORA,
  );
  assert.equal(card.state, "proximo");
  assert.equal(card.startsInMin, 12);
  assert.equal(card.patient, "María González Ruiz");
  assert.equal(card.elapsedMin, null, "una cita que no empezó no lleva minutos");
});

test(`la ventana de "próxima" son ${EDU_VIVA_PROXIMA_MIN} min, y es la del motor del dental`, () => {
  // El valor vive DENTRO de live-mode.ts (PROXIMO_WINDOW_MIN, privado). Se
  // copia aquí para poder decirlo en pantalla, y esto lo ata al motor de
  // verdad: si el dental lo cambia a 45, esta prueba se pone roja en vez de
  // dejar la pantalla mintiendo.
  const dentro = eduVivaCard(
    sillon(),
    [cita({ status: "SCHEDULED", startsAt: min(EDU_VIVA_PROXIMA_MIN - 1), endsAt: min(90) })],
    AHORA,
  );
  assert.equal(dentro.state, "proximo");

  const fuera = eduVivaCard(
    sillon(),
    [cita({ status: "SCHEDULED", startsAt: min(EDU_VIVA_PROXIMA_MIN + 5), endsAt: min(120) })],
    AHORA,
  );
  assert.equal(fuera.state, "libre");

  // Y contra el motor directamente, sin pasar por esta capa.
  const live = eduVivaLiveAppt(
    cita({ status: "SCHEDULED", startsAt: min(EDU_VIVA_PROXIMA_MIN + 5), endsAt: min(120) }),
  );
  assert.ok(live);
  assert.equal(getChairStatus("chair_1", AHORA, [live]), "libre");
});

// ═════════════════════════════════════════════════════════════════════
// 2 · LA TRAMPA DEL MOTOR IMPORTADO
// ═════════════════════════════════════════════════════════════════════

test("🔴 una cita SCHEDULED que ya debería haber empezado NO ocupa el sillón", () => {
  // Es el caso que separa a `getChairStatus` de `getChairAppointment`: el
  // paciente que no llegó y que nadie marcó. El estado dice libre; la
  // segunda función, si se preguntara sola, devolvería esa cita porque su
  // rango contiene "ahora". La tarjeta tiene que salir LIBRE y VACÍA.
  const card = eduVivaCard(
    sillon(),
    [cita({ status: "SCHEDULED", startsAt: min(-30), endsAt: min(30) })],
    AHORA,
  );
  assert.equal(card.state, "libre");
  assert.equal(card.patient, null, "una tarjeta libre con un paciente dentro");
  assert.equal(card.student, null);
  assert.equal(card.progress, null);
});

test("con dos citas vivas en el mismo sillón manda la que está EN CURSO", () => {
  const card = eduVivaCard(
    sillon(),
    [
      cita({ id: "vieja", status: "SCHEDULED", startsAt: min(-90), endsAt: min(-30) }),
      cita({ id: "ahora", status: "IN_CHAIR", startsAt: min(-10), endsAt: min(50) }),
      cita({ id: "luego", status: "SCHEDULED", startsAt: min(60), endsAt: min(120) }),
    ],
    AHORA,
  );
  assert.equal(card.state, "ocupado");
  assert.equal(card.elapsedMin, 10);
});

test("un sillón LIBRE enseña la HORA de la siguiente, nunca el nombre", () => {
  // Un sillón libre no tiene por qué publicar a quién le toca dentro de tres
  // horas: lo útil desde el fondo del piso es "libre hasta las 14:30".
  const card = eduVivaCard(
    sillon(),
    [cita({ status: "SCHEDULED", startsAt: min(180), endsAt: min(240) })],
    AHORA,
  );
  assert.equal(card.state, "libre");
  assert.equal(card.patient, null);
  assert.equal(card.student, null);
  // La hora solo aparece si la cita cae HOY en la sede; a las 23:00 no.
  assert.ok(card.nextLabel === null || /^\d{2}:\d{2}$/.test(card.nextLabel));
});

test('"siguiente" se recorta al día de calendario de SU sede', () => {
  // 🔴 Instante FIJO a propósito, y aquí da lo mismo el criterio del motor:
  // una cita a cuatro horas vista sale LIBRE tanto por estado (no es
  // IN_PROGRESS) como por rango (no contiene "ahora"). Lo que se comprueba
  // es el recorte de calendario, que sí necesita una hora concreta.
  //   04:00Z = 22:00 del día anterior en America/Mexico_City.
  const nocheAnterior = new Date("2026-09-01T04:00:00.000Z");
  const cruzando = eduVivaCard(
    sillon(),
    [
      cita({
        status: "SCHEDULED",
        // 08:00Z = 02:00 del 1 de septiembre en la sede: OTRO día.
        startsAt: new Date("2026-09-01T08:00:00.000Z"),
        endsAt: new Date("2026-09-01T09:00:00.000Z"),
      }),
    ],
    nocheAnterior,
  );
  assert.equal(cruzando.state, "libre");
  assert.equal(
    cruzando.nextLabel,
    null,
    "un sillón libre a las 22:00 anunció la primera cita de mañana como si fuera de hoy",
  );

  // La misma noche, una cita a las 23:30 de la sede: ésa SÍ es de hoy.
  const mismaNoche = eduVivaCard(
    sillon(),
    [
      cita({
        status: "SCHEDULED",
        startsAt: new Date("2026-09-01T05:30:00.000Z"),
        endsAt: new Date("2026-09-01T06:30:00.000Z"),
      }),
    ],
    nocheAnterior,
  );
  assert.equal(mismaNoche.nextLabel, "23:30");
});

// ═════════════════════════════════════════════════════════════════════
// 3 · LA SEDE
// ═════════════════════════════════════════════════════════════════════

const NORTE = sillon({ id: "chair_n1", number: 1, campusId: "sede_norte", campusName: "Campus Norte" });
const NORTE_2 = sillon({ id: "chair_n2", number: 2, campusId: "sede_norte", campusName: "Campus Norte" });
const SUR = sillon({ id: "chair_s1", number: 1, campusId: "sede_sur", campusName: "Campus Sur" });

test("🔴 el sillón 1 del SUR no se cuela en el sillón 1 del NORTE", () => {
  // El número es único DENTRO de la sede: las dos sedes tienen su "Sillón 1"
  // pintado en su pared. Emparejar por número —que es la forma natural de
  // equivocarse— pondría al paciente del sur en la tarjeta del norte.
  const enElSur = cita({ chairId: "chair_s1", status: "IN_PROGRESS" });
  const board = buildEduVivaBoard({
    chairs: [NORTE, NORTE_2],
    appointments: [enElSur],
    now: AHORA,
  });

  const n1 = board.cards.find((c) => c.chairId === "chair_n1");
  assert.ok(n1);
  assert.equal(n1.state, "libre", "la cita del Sur ocupó el Sillón 1 del Norte");
  assert.equal(n1.patient, null);
  assert.equal(board.counts.ocupado, 0);
  assert.equal(board.counts.libre, 2);
  assert.equal(board.cards.length, 2, "se coló una tarjeta de una sede que no se pidió");
});

test("el filtro por sede reparte los conteos sin sumar los dos campus", () => {
  const board = buildEduVivaBoard({
    chairs: [NORTE, NORTE_2, SUR],
    appointments: [
      cita({ id: "a", chairId: "chair_n1", status: "IN_CHAIR" }),
      cita({ id: "b", chairId: "chair_s1", status: "IN_PROGRESS" }),
    ],
    now: AHORA,
  });

  assert.equal(board.counts.total, 3);
  assert.equal(board.counts.ocupado, 2);

  const norte = board.byCampus.find((s) => s.campusId === "sede_norte");
  const sur = board.byCampus.find((s) => s.campusId === "sede_sur");
  assert.ok(norte && sur);
  assert.deepEqual(norte.counts, { libre: 1, proximo: 0, ocupado: 1, total: 2 });
  assert.deepEqual(sur.counts, { libre: 0, proximo: 0, ocupado: 1, total: 1 });
  assert.equal(norte.campusName, "Campus Norte");
});

test("el `where` de sillones recorta por SEDE y nunca suelta el tenant", () => {
  // Es el filtro de verdad: lo que la consulta le pasa a Prisma. `null` no
  // recorta (el instituto entero) y `[]` no devuelve nada — las dos cosas
  // se escriben casi igual y confundirlas en el sentido malo es una fuga.
  assert.deepEqual(eduChairScopeWhere({ institutionId: INST, campusIds: null }), {
    institutionId: INST,
  });
  assert.deepEqual(eduChairScopeWhere({ institutionId: INST, campusIds: ["sede_norte"] }), {
    institutionId: INST,
    campusId: { in: ["sede_norte"] },
  });
  assert.deepEqual(eduChairScopeWhere({ institutionId: INST, campusIds: [] }), {
    institutionId: INST,
    campusId: { in: [] },
  });
  assert.throws(
    () => eduChairScopeWhere({ institutionId: "", campusIds: null }),
    /institutionId/,
    "un institutionId vacío BORRA el filtro de tenant en Prisma",
  );
});

test("un `?sede=` de una sede ajena NO amplía nada: se degrada a lo suyo", () => {
  // El filtro de la pantalla pasa por el mismo resolvedor que la cookie de
  // la barra superior, así que hereda su regla: pedir no concede.
  const campuses = [
    { id: "sede_norte", name: "Campus Norte", code: "N", timezone: TZ, isActive: true },
    { id: "sede_sur", name: "Campus Sur", code: "S", timezone: TZ, isActive: true },
  ];

  const propia = eduResolveCampusScope({
    campuses,
    access: { kind: "some", campusIds: ["sede_norte"] },
    requested: "sede_norte",
    institutionTimezone: TZ,
  });
  assert.deepEqual(propia.campusIds, ["sede_norte"]);

  const ajena = eduResolveCampusScope({
    campuses,
    access: { kind: "some", campusIds: ["sede_norte"] },
    requested: "sede_sur",
    institutionTimezone: TZ,
  });
  assert.deepEqual(ajena.campusIds, ["sede_norte"], "pedir una sede ajena la concedió");
  assert.equal(ajena.activeId, null);

  const inventada = eduResolveCampusScope({
    campuses,
    access: { kind: "all" },
    requested: "sede_de_otra_escuela",
    institutionTimezone: TZ,
  });
  assert.equal(inventada.activeId, null);

  assert.equal(eduCampusCovers(["sede_norte"], "sede_sur"), false);
  assert.equal(eduCampusCovers(null, "sede_sur"), true, "sin restricción, entra a todas");
});

// ═════════════════════════════════════════════════════════════════════
// 4 · QUIÉN ENTRA (y qué detalle ve)
// ═════════════════════════════════════════════════════════════════════

test("🔴 ALUMNO y CAJA no tienen alcance sobre el piso en vivo", () => {
  for (const role of ["ALUMNO", "CAJA"] as EduRole[]) {
    assert.deepEqual(
      eduLiveFloorVisibility({ role, eduUserId: "u_1" }),
      { kind: "none" },
      `${role} alcanzó el tablero del piso`,
    );
  }
});

test("DIRECCION ve el piso entero; el DOCENTE, el piso con el detalle recortado", () => {
  assert.deepEqual(eduLiveFloorVisibility({ role: "DIRECCION", eduUserId: "u_dir" }), {
    kind: "all",
  });
  assert.deepEqual(eduLiveFloorVisibility({ role: "DOCENTE", eduUserId: "u_doc" }), {
    kind: "supervised",
    supervisorUserId: "u_doc",
  });
});

test("un rol desconocido o un actor basura caen en 'none', nunca en 'all'", () => {
  // Lista BLANCA: un rol que se agregue mañana al enum se queda fuera hasta
  // que alguien lo decida a propósito.
  assert.deepEqual(
    eduLiveFloorVisibility({ role: "COORDINADOR" as EduRole, eduUserId: "u" }),
    { kind: "none" },
  );
  assert.deepEqual(
    eduLiveFloorVisibility(null as unknown as { role: EduRole; eduUserId: string }),
    { kind: "none" },
  );
  assert.deepEqual(eduLiveFloorVisibility({ role: "DOCENTE", eduUserId: "" }), { kind: "none" });
});

test("🔴 el DOCENTE ve OCUPADO el sillón de otro docente, y no ve de quién", () => {
  // El estado del piso no es secreto —si no, el tablero mentiría sobre
  // cuántas unidades quedan libres— pero el paciente sí. Es la misma línea
  // que el vertical defiende desde la Ola 1A: nada de otros docentes.
  const board = buildEduVivaBoard({
    chairs: [NORTE, NORTE_2],
    appointments: [
      cita({ id: "mio", chairId: "chair_n1", status: "IN_PROGRESS", detail: true }),
      cita({
        id: "ajeno",
        chairId: "chair_n2",
        status: "IN_PROGRESS",
        detail: false,
        patientName: "Jorge Luis Sánchez",
        studentName: "Otro Estudiante",
        specialty: "Ortodoncia",
      }),
    ],
    now: AHORA,
  });

  const mio = board.cards.find((c) => c.chairId === "chair_n1");
  const ajeno = board.cards.find((c) => c.chairId === "chair_n2");
  assert.ok(mio && ajeno);

  assert.equal(mio.masked, false);
  assert.equal(mio.patient, "María González Ruiz");

  // El sillón ajeno CUENTA como ocupado…
  assert.equal(ajeno.state, "ocupado");
  assert.equal(board.counts.ocupado, 2);
  // …y no dice ni el paciente, ni el estudiante, ni el padecimiento.
  assert.equal(ajeno.masked, true);
  assert.equal(ajeno.patient, "J.L.", "salió el nombre completo de un paciente ajeno");
  assert.equal(ajeno.patientFolio, null);
  assert.equal(ajeno.student, null);
  assert.equal(ajeno.studentMatricula, null);
  assert.equal(ajeno.specialty, null);
  // La hora sí: es operación del piso, no identidad de nadie.
  assert.ok(ajeno.startLabel);
  assert.equal(ajeno.elapsedMin, 20);
});

test("una asignación VENCIDA no da detalle (mismo predicado que el resto del vertical)", () => {
  const scope = eduLiveFloorVisibility({ role: "DOCENTE", eduUserId: "u_doc" });
  const ayer = new Date(AHORA.getTime() - 24 * 60 * 60 * 1000);
  const anteayer = new Date(AHORA.getTime() - 48 * 60 * 60 * 1000);

  const vigente = eduScopeCoversStudent(
    scope,
    { userId: "u_al", supervisors: [{ supervisorUserId: "u_doc", startsAt: ayer, endsAt: null }] },
    AHORA,
  );
  assert.equal(vigente, true);

  const cerrada = eduScopeCoversStudent(
    scope,
    {
      userId: "u_al",
      supervisors: [{ supervisorUserId: "u_doc", startsAt: anteayer, endsAt: ayer }],
    },
    AHORA,
  );
  assert.equal(cerrada, false, "un docente que ya entregó su grupo siguió viendo a sus pacientes");

  const deOtro = eduScopeCoversStudent(
    scope,
    { userId: "u_al", supervisors: [{ supervisorUserId: "u_otro", startsAt: ayer, endsAt: null }] },
    AHORA,
  );
  assert.equal(deOtro, false);
});

// ═════════════════════════════════════════════════════════════════════
// 5 · LAS DOS CERRADURAS DE LA API
// ═════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, "..", "..", "..", "..");
const RUTA_API = "src/app/api/instituto/clinica/route.ts";
const RUTA_PAGINA = "src/app/instituto/(panel)/clinica/page.tsx";

function fuente(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

test("🔴 ni ALUMNO ni CAJA llevan clinica.view: la API les contesta 403", () => {
  // Cerradura 1 — el permiso. `eduApiGuard("clinica.view")` devuelve 403
  // antes de tocar la base para quien no lo tenga.
  for (const role of ["ALUMNO", "CAJA"] as EduRole[]) {
    assert.equal(
      hasEduPermission({ role, permissionsOverride: [] }, "clinica.view"),
      false,
      `${role} entraría al endpoint del tablero`,
    );
  }
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "clinica.view"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "clinica.view"), true);
});

test("🔴 y si alguien le enciende la casilla a un alumno, el ALCANCE sigue diciendo 403", () => {
  // Cerradura 2 — el override REEMPLAZA al default, así que esto es un
  // alumno con el permiso puesto a mano. El alcance no se lo concede.
  const conPermiso = { role: "ALUMNO" as EduRole, permissionsOverride: ["clinica.view"] };
  assert.equal(hasEduPermission(conPermiso, "clinica.view"), true, "el permiso sí se puede dar");
  assert.deepEqual(
    eduLiveFloorVisibility({ role: "ALUMNO", eduUserId: "u_al" }),
    { kind: "none" },
    "…y aun así el alcance tiene que negarlo",
  );
  assert.ok(EDU_LIVE_FLOOR_NONE_DETAIL.length > 40, "el 403 tiene que explicarse en español");
});

test("el endpoint EXIGE las dos cerraduras (no basta con esconder el item del menú)", () => {
  const api = fuente(RUTA_API);
  assert.match(api, /eduApiGuard\("clinica\.view"\)/, "el endpoint no exige el permiso");
  assert.match(api, /if \("response" in g\) return g\.response/, "el guard no corta la ejecución");
  assert.match(api, /getEduClinicaViva/, "el endpoint no pasa por la capa que aplica el alcance");
  assert.match(api, /getEduCampusScope/, "el endpoint no recorta por sede");

  const servidor = fuente("src/lib/edu/clinica-viva.ts");
  assert.match(servidor, /eduLiveFloorVisibility/, "la capa de datos no consulta el punto único");
  assert.match(servidor, /eduScopeIsEmpty\(scope\)/);
  assert.match(servidor, /403/, "el alcance vacío tiene que ser un 403");
  assert.match(servidor, /eduChairScopeWhere/, "los sillones no se recortan por sede");
  assert.match(servidor, /isActive: true/, "se estarían pintando sillones dados de baja");

  const pagina = fuente(RUTA_PAGINA);
  assert.match(pagina, /hasEduPermission\(permUser, "clinica\.view"\)/, "la página no exige el permiso");
  assert.match(pagina, /eduLiveFloorVisibility/);
});

test("la visibilidad del piso vive en visibility.ts y en NINGÚN otro archivo", () => {
  // El punto único es el punto único: si una ola futura escribe su propia
  // lista de roles en la pantalla o en la capa de datos, esto se pone rojo.
  for (const rel of [RUTA_API, RUTA_PAGINA, "src/lib/edu/clinica-viva.ts", "src/lib/edu/clinica-viva-core.ts"]) {
    const texto = fuente(rel);
    assert.equal(
      /["']DIRECCION["']/.test(texto) || /["']DOCENTE["']/.test(texto),
      false,
      `${rel} decide por su cuenta qué rol ve el piso: eso vive en visibility.ts`,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════
// 6 · EL CATÁLOGO Y EL MENÚ
// ═════════════════════════════════════════════════════════════════════

test("clinica.view está en el catálogo, descrita en español y en UN solo grupo", () => {
  assert.ok("clinica.view" in EDU_ALL_PERMISSIONS);
  const desc = EDU_ALL_PERMISSIONS["clinica.view"];
  assert.ok(desc && desc.length > 8);
  assert.notEqual(desc, "clinica.view");

  const grupos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("clinica.view"));
  assert.equal(grupos.length, 1, "la casilla aparece en dos grupos (o en ninguno)");
  // Grupo PROPIO: quien le da a caja el bloque de la agenda no puede darle
  // de pasada el tablero que enseña el padecimiento de cada paciente.
  assert.equal(grupos[0].keys.length, 1, "la casilla se puede tildar de pasada con otro bloque");
});

test("la lleva DIRECCION y DOCENTE, y nadie más", () => {
  const conLaKey = (Object.keys(EDU_ROLE_DEFAULTS) as EduRole[]).filter((r) =>
    EDU_ROLE_DEFAULTS[r].includes("clinica.view"),
  );
  assert.deepEqual(conLaKey.sort(), ["DIRECCION", "DOCENTE"]);
});

test("el item «Clínica en vivo» está en el menú, con etiqueta y con su icono", () => {
  const item = EDU_NAV_ITEMS.find((i) => i.key === "clinica");
  assert.ok(item, "falta el item de menú");
  assert.equal(item?.href, "/instituto/clinica");
  assert.equal(item?.permission, "clinica.view");
  assert.equal(item?.section, "operacion");
  assert.equal(EDU_NAV_LABELS.clinica, "Clínica en vivo");

  // ⚠️ Un icono que no esté en el mapa de edu-shell.tsx cae al genérico EN
  // SILENCIO: el menú "funciona" y sale una casita.
  const shell = fuente("src/components/edu/edu-shell.tsx");
  assert.match(shell, /"layout-grid": LayoutGrid/, `el icono ${item?.icon} no está en ICONS`);
  assert.match(shell, /^ {2}LayoutGrid,\s*$/m, "LayoutGrid no se importa de lucide");
});

test("los dos items de arriba siguen siendo Inicio y Dirección", () => {
  // El tablero va TERCERO: pegado a Dirección y antes de "Mi agenda".
  assert.equal(EDU_NAV_ITEMS[0]?.key, "inicio");
  assert.equal(EDU_NAV_ITEMS[1]?.key, "direccion");
  assert.equal(EDU_NAV_ITEMS[2]?.key, "clinica");
});

// ═════════════════════════════════════════════════════════════════════
// 7 · EL REFRESCO
// ═════════════════════════════════════════════════════════════════════

test("los dos relojes son razonables y el de red NO es el del minutero", () => {
  // Un intervalo de dos segundos serían 1 800 consultas por hora y por
  // pantalla contra las tablas de la agenda, para enseñar lo mismo.
  assert.ok(EDU_VIVA_REFRESCO_MS >= 10_000, "el latido es demasiado agresivo");
  assert.ok(EDU_VIVA_REFRESCO_MS <= 60_000, "el tablero se quedaría pegado");
  assert.notEqual(EDU_VIVA_TIC_MS, EDU_VIVA_REFRESCO_MS);
  assert.ok(EDU_VIVA_VENTANA_HORAS >= 8 && EDU_VIVA_VENTANA_HORAS <= 24);
  assert.ok(EDU_VIVA_MAX_CITAS >= 200);
});

test("🔴 el cliente NO consulta con la pestaña oculta, y vuelve a pedir al volver", () => {
  // El navegador FRENA los temporizadores en segundo plano: un intervalo que
  // sigue corriendo ahí deja de ser el que dice su nombre y, al volver,
  // dispara una ráfaga de consultas atrasadas.
  const pantalla = fuente("src/components/edu/clinica/viva-screen.tsx");
  assert.match(pantalla, /document\.hidden/, "el latido consulta con la pestaña oculta");
  assert.match(pantalla, /addEventListener\("visibilitychange"/);
  assert.match(pantalla, /removeEventListener\("visibilitychange"/, "el listener no se limpia");
  assert.match(pantalla, /clearInterval/, "el intervalo no se limpia al desmontar");
  assert.match(pantalla, /EDU_VIVA_REFRESCO_MS/, "el intervalo está a mano en vez de la constante");
});

test("el tablero dice CUÁNDO se armó (un tablero pegado que parece vivo miente)", () => {
  const board = buildEduVivaBoard({ chairs: [NORTE], appointments: [], now: AHORA });
  assert.equal(board.generatedAt, AHORA.toISOString());
  assert.equal(board.truncated, false);
  assert.deepEqual(board.counts, { libre: 1, proximo: 0, ocupado: 0, total: 1 });
});

test("sin sillones, el tablero es vacío y no revienta", () => {
  const board = buildEduVivaBoard({ chairs: [], appointments: [cita()], now: AHORA });
  assert.deepEqual(board.cards, []);
  assert.deepEqual(board.counts, { libre: 0, proximo: 0, ocupado: 0, total: 0 });
  assert.deepEqual(board.byCampus, []);
});
