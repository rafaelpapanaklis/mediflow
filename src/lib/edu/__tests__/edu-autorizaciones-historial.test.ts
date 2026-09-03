/**
 * EL HISTORIAL DE AUTORIZACIONES — lo que ya se decidió.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-autorizaciones-historial.test.ts
 *       (o `npm run test:edu`, que descubre este archivo solo)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO, Y POR QUÉ AQUÍ Y NO EN UNA PANTALLA
 *
 * La pregunta de esta ola no es "¿se pinta bonito?" sino "¿puede alguien
 * leer lo que no le toca tecleando una URL?". Eso NO se comprueba mirando
 * una pantalla: se comprueba mirando el `where` que sale hacia Postgres. Por
 * eso `eduApprovalHistoryWhere` vive en el módulo PURO — para poderlo armar
 * aquí, con un docente y el id de un alumno ajeno, y verificar sobre el
 * objeto que ese id quedó DENTRO del mismo `student` donde vive el recorte.
 * Un AND imposible no puede devolver una fila; una pantalla vacía, en
 * cambio, puede estar vacía por diez razones distintas.
 *
 * Un renglón por cada línea de la lista de seguridad de la ola:
 *
 *   1. DIRECCION ve todo el instituto — y NADA de otro instituto;
 *   2. DOCENTE, solo lo de sus estudiantes VIGENTES;
 *   3. DOCENTE con `?estudiante=<ajeno>` → cero filas, sin 403;
 *   4. ALUMNO, solo lo suyo; con `?estudiante=<otro>` → cero filas;
 *   5. CAJA, ni una fila (y su 403 lo pone el guard del endpoint);
 *   6. encender `autorizaciones.view` por override NO amplía el alcance;
 *   7. las OPCIONES de los filtros salen del MISMO alcance (P1-4).
 *
 * Y las reglas propias del historial: que no se cuele un PENDING, que
 * "las que decidí yo" salga de la SESIÓN, y que el orden no lo encabecen
 * las filas que nadie decidió (en Postgres, un DESC pone los NULL PRIMERO).
 *
 * La prueba de que la CONSULTA REAL devuelve vacío —no solo el `where`—
 * está en edu-autorizaciones-historial.integration.test.ts, contra un
 * Postgres de verdad con dos institutos y dos docentes.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_APPROVAL_HISTORY_EMPTY_FILTERS,
  EDU_APPROVAL_HISTORY_STATUSES,
  EDU_APPROVAL_MAX_ROWS,
  EDU_APPROVAL_STATUS_TAG,
  eduApprovalHistoryQuery,
  eduApprovalHistoryStamp,
  eduApprovalHistoryWhere,
  eduCompareApprovalHistory,
  eduHasApprovalHistoryFilters,
  parseEduApprovalHistoryFilters,
  parseEduApprovalHistoryStatus,
  type EduApprovalHistoryFilters,
} from "../autorizaciones-core";
import { eduScopeIsEmpty, eduVisibility, type EduVisibilityScope } from "../visibility";
import { assertEduPermission, EduForbiddenError, hasEduPermission } from "../permissions";
import { EDU_APPROVAL_STATUSES, EDU_ROLES, type EduRole } from "../types";

const INST = "inst_1";
const OTRO_INST = "inst_2";
const AHORA = new Date("2026-09-03T18:00:00.000Z");
const TZ = "America/Mexico_City";

const DOC_A = "u_doc_a";
const DOC_B = "u_doc_b";
const AL_1 = "u_al_1";
const ALUMNO_AJENO = "std_del_otro_docente";

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

function filtros(over: Partial<EduApprovalHistoryFilters> = {}): EduApprovalHistoryFilters {
  return { ...EDU_APPROVAL_HISTORY_EMPTY_FILTERS, ...over };
}

/** El `where` tal cual sale hacia Prisma, para el rol que se le diga. */
function whereDe(
  role: EduRole,
  eduUserId: string,
  over: Partial<EduApprovalHistoryFilters> = {},
  institutionId = INST,
) {
  const a = actor(role, eduUserId);
  return eduApprovalHistoryWhere({
    institutionId,
    scope: eduVisibility(a, "cases"),
    filters: filtros(over),
    viewerUserId: eduUserId,
    timeZone: TZ,
    now: AHORA,
  });
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

// ═════════════════════════════════════════════════════════════════════
// 1 · 🔴 EL ALCANCE, LÍNEA POR LÍNEA
// ═════════════════════════════════════════════════════════════════════

test("🔴 DIRECCION ve todo el instituto — y el tenant va SIEMPRE puesto", () => {
  const where = whereDe("DIRECCION", "u_dir");

  // Sin recorte por alumno: el `case` lleva el instituto y nada más.
  assert.deepEqual(where.case, { institutionId: INST });

  // Y el institutionId está en TODOS los sitios donde aparece: un undefined
  // aquí BORRA el filtro de tenant en Prisma y devuelve las filas de todos
  // los institutos.
  const tenants = valoresDe(where, "institutionId");
  assert.ok(tenants.length > 0, "el where salió sin institutionId");
  for (const t of tenants) {
    assert.equal(t, INST);
    assert.notEqual(t, OTRO_INST);
  }

  // El historial es lo que YA no espera.
  assert.deepEqual(where.status, { not: "PENDING" });
});

test("🔴 el DOCENTE solo alcanza lo de los alumnos que supervisa CON ASIGNACIÓN VIGENTE", () => {
  const where = whereDe("DOCENTE", DOC_A);

  // El recorte cuelga de la asignación alumno↔docente…
  assert.deepEqual(valoresDe(where, "supervisorUserId"), [DOC_A]);
  // …y de NINGÚN otro docente.
  assert.ok(!JSON.stringify(where).includes(DOC_B));

  // …y esa asignación lleva VIGENCIA: un docente que ya rotó deja de leer
  // lo de los alumnos que entregó, sin que nadie le apague un permiso.
  const empieza = valoresDe(where, "startsAt");
  const termina = valoresDe(where, "endsAt");
  assert.ok(empieza.length > 0, "el recorte del docente no comprueba desde cuándo");
  assert.ok(termina.length > 0, "el recorte del docente no comprueba hasta cuándo");
  assert.ok(
    JSON.stringify(empieza).includes(AHORA.toISOString()),
    "la vigencia no se evalúa con el `now` que se le pasa",
  );
});

test("🔴 DOCENTE + ?estudiante=<ajeno>: el id ajeno NO reemplaza el recorte, se SUMA", () => {
  const where = whereDe("DOCENTE", DOC_A, { studentId: ALUMNO_AJENO });

  const student = (where.case as Record<string, unknown>).student as Record<string, unknown>;
  assert.ok(student, "el filtro por estudiante se fue fuera del recorte del caso");

  // Las DOS condiciones viven en el MISMO objeto `student`, que Prisma
  // resuelve como AND: "es el alumno X" **y** "lo supervisa este docente
  // hoy". Un alumno de otro docente no puede cumplir las dos.
  assert.equal(student.id, ALUMNO_AJENO);
  assert.ok(student.supervisors, "se perdió la condición de supervisión al filtrar por alumno");
  assert.deepEqual(valoresDe(student.supervisors, "supervisorUserId"), [DOC_A]);

  // Y el filtro NO se cuela por un OR hermano: al nivel del alumno no hay
  // ninguna alternativa, solo condiciones que se suman. (El único OR del
  // where vive DENTRO de la vigencia —`endsAt: null` o `endsAt > now`—, que
  // acota la asignación en vez de abrir otra puerta.)
  assert.ok(!("OR" in student), "un OR al nivel del alumno deja pasar por el otro lado");
  assert.ok(!("OR" in (where.case as Record<string, unknown>)));
  assert.ok(!("OR" in where));
  const ors = valoresDe(where, "OR") as unknown[][];
  assert.equal(ors.length, 1, "apareció un OR nuevo fuera de la vigencia de la asignación");
  assert.ok(JSON.stringify(ors[0]).includes("endsAt"));
});

test("🔴 el ALUMNO solo alcanza lo suyo, y ?estudiante=<otro> tampoco lo saca de ahí", () => {
  const scope = eduVisibility(actor("ALUMNO", AL_1), "cases");
  assert.deepEqual(scope, { kind: "own", studentUserId: AL_1 });

  const where = whereDe("ALUMNO", AL_1, { studentId: ALUMNO_AJENO });
  const student = (where.case as Record<string, unknown>).student as Record<string, unknown>;

  // Su propio userId sigue ahí junto al id que tecleó: otro AND imposible.
  assert.equal(student.userId, AL_1);
  assert.equal(student.id, ALUMNO_AJENO);
  assert.equal(student.institutionId, INST);
});

test("🔴 CAJA no alcanza NI UNA fila, aunque le enciendan autorizaciones.view", () => {
  // El alcance del recurso "cases" es "none" para caja, y eso no lo cambia
  // ningún permiso: el alcance no vive en la key.
  assert.deepEqual(eduVisibility(actor("CAJA", "u_caja"), "cases"), { kind: "none" });
  assert.equal(eduScopeIsEmpty(eduVisibility(actor("CAJA", "u_caja"), "cases")), true);

  // Cinturón: si alguna vez se consultara igual, el `where` no devuelve una
  // sola fila (`id: { in: [] }`), no el instituto entero.
  const where = whereDe("CAJA", "u_caja");
  assert.deepEqual(where.case, { institutionId: INST, id: { in: [] } });

  // Y la key sigue sin ser suya por defecto: el 403 del endpoint es real.
  assert.equal(hasEduPermission({ role: "CAJA" }, "autorizaciones.view"), false);
});

test("🔴 encender autorizaciones.view por OVERRIDE abre la pantalla, NO el alcance", () => {
  // La key encendida a mano (el override es la LISTA de keys efectivas, no
  // un merge): el guard del endpoint ya no contesta 403…
  const cajaConKey = {
    role: "CAJA" as EduRole,
    permissionsOverride: ["autorizaciones.view", "caja.charge"],
  };
  assert.equal(hasEduPermission(cajaConKey, "autorizaciones.view"), true);

  // …y aun así el alcance sigue siendo "none", porque `eduVisibility` mira
  // el ROL y el RECURSO, nunca los permisos. Ésta es la línea que hace que
  // un error de configuración no sea una fuga.
  const where = whereDe("CAJA", "u_caja");
  assert.deepEqual(where.case, { institutionId: INST, id: { in: [] } });

  // El mismo razonamiento para un rol que no existe todavía en el enum: la
  // opción segura es la que no filtra datos.
  const scopeRaro = eduVisibility({ role: "RECTOR" as EduRole, eduUserId: "x" }, "cases");
  assert.deepEqual(scopeRaro, { kind: "none" });
});

test("un filtro por DOCENTE no abre nada: acota DENTRO de lo que ya se ve", () => {
  // Un docente que teclea el id de un colega: `decidedById` es un filtro
  // más, y el `case` sigue recortado a SUS alumnos vigentes.
  const where = whereDe("DOCENTE", DOC_A, { decidedByUserId: DOC_B });
  assert.equal(where.decidedById, DOC_B);
  assert.deepEqual(valoresDe(where.case, "supervisorUserId"), [DOC_A]);
});

test("🔴 «las que decidí yo» sale de la SESIÓN y GANA al ?docente= de la URL", () => {
  const where = eduApprovalHistoryWhere({
    institutionId: INST,
    scope: eduVisibility(actor("DOCENTE", DOC_A), "cases"),
    // Los dos puestos a la vez: la URL pide las de otro Y las mías.
    filters: filtros({ soloMias: true, decidedByUserId: DOC_B }),
    viewerUserId: DOC_A,
    timeZone: TZ,
    now: AHORA,
  });
  // Gana el id de la sesión. Si ganara el de la URL, «mías» sería un filtro
  // por cualquiera disfrazado de mío.
  assert.equal(where.decidedById, DOC_A);
});

// ═════════════════════════════════════════════════════════════════════
// 2 · LO QUE EL HISTORIAL ES (y lo que no)
// ═════════════════════════════════════════════════════════════════════

test("🔴 el historial NUNCA devuelve lo que sigue esperando firma", () => {
  // Sin filtro: todo lo que no está pendiente.
  assert.deepEqual(whereDe("DIRECCION", "u_dir").status, { not: "PENDING" });

  // Con `?estado=PENDING` tecleado a mano: el parseo lo tira y vuelve al
  // `not`. La bandeja no se puede leer por esta puerta.
  assert.equal(parseEduApprovalHistoryStatus("PENDING"), null);
  const conPending = parseEduApprovalHistoryFilters({ estado: "PENDING" });
  assert.equal(conPending.status, null);
  assert.deepEqual(whereDe("DIRECCION", "u_dir", conPending).status, { not: "PENDING" });

  // Y el desplegable no ofrece PENDING, pero sí TODOS los demás estados del
  // enum: si mañana se agrega uno decidido, entra solo.
  assert.ok(!EDU_APPROVAL_HISTORY_STATUSES.includes("PENDING"));
  assert.deepEqual(
    EDU_APPROVAL_HISTORY_STATUSES,
    EDU_APPROVAL_STATUSES.filter((s) => s !== "PENDING"),
  );
  // EXPIRED entra a propósito: una firma que dejó de valer es justo lo que
  // busca quien audita.
  assert.ok(EDU_APPROVAL_HISTORY_STATUSES.includes("EXPIRED"));
});

test("un estado concreto se respeta tal cual", () => {
  assert.equal(whereDe("DIRECCION", "u_dir", { status: "REJECTED" }).status, "REJECTED");
});

test("la etapa y la especialidad acotan sin tocar el recorte", () => {
  const where = whereDe("DOCENTE", DOC_A, { stage: "DISCHARGE", programId: "prog_endo" });
  assert.equal(where.stage, "DISCHARGE");
  assert.equal((where.case as Record<string, unknown>).programId, "prog_endo");
  // El recorte del docente sigue intacto debajo del filtro de especialidad.
  assert.deepEqual(valoresDe(where.case, "supervisorUserId"), [DOC_A]);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · EL ORDEN — la trampa de los NULL
// ═════════════════════════════════════════════════════════════════════

test("🔴 lo que nadie decidió NO encabeza el historial", () => {
  // En Postgres un `ORDER BY decidedAt DESC` pone los NULL PRIMERO, así que
  // las filas que un reenvío cerró (sin decidedById, sin decidedAt) saldrían
  // arriba del todo. El orden se decide en JS, con el sello que se PINTA.
  const firmadaHoy = {
    id: "a",
    decidedAt: "2026-09-03T10:00:00.000Z",
    requestedAt: "2026-09-03T09:00:00.000Z",
  };
  const sinDecidirVieja = {
    id: "b",
    decidedAt: null,
    requestedAt: "2026-01-05T09:00:00.000Z",
  };
  const ordenadas = [sinDecidirVieja, firmadaHoy].sort(eduCompareApprovalHistory);
  assert.deepEqual(
    ordenadas.map((r) => r.id),
    ["a", "b"],
    "una fila sin decidir de enero se puso encima de una firmada hoy",
  );

  // El sello es `decidedAt ?? requestedAt`, y se usa igual en los dos casos.
  assert.equal(eduApprovalHistoryStamp(firmadaHoy), firmadaHoy.decidedAt);
  assert.equal(eduApprovalHistoryStamp(sinDecidirVieja), sinDecidirVieja.requestedAt);
});

test("dos filas del mismo instante no cambian de sitio entre dos recargas", () => {
  const mismo = "2026-09-03T10:00:00.000Z";
  const a = { id: "aaa", decidedAt: mismo, requestedAt: mismo };
  const b = { id: "bbb", decidedAt: mismo, requestedAt: mismo };
  assert.deepEqual([a, b].sort(eduCompareApprovalHistory).map((r) => r.id), ["bbb", "aaa"]);
  assert.deepEqual([b, a].sort(eduCompareApprovalHistory).map((r) => r.id), ["bbb", "aaa"]);
});

test("el techo del historial es el mismo de la bandeja (y avisa cuando corta)", () => {
  // 300. La consulta pide MAX + 1 por tanda justo para poder DECIR que
  // cortó: el `truncated` de casos y pacientes, sin inventar otro número.
  assert.equal(EDU_APPROVAL_MAX_ROWS, 300);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · LA URL — que un enlace se pueda pegar en un correo
// ═════════════════════════════════════════════════════════════════════

test("los filtros van y vuelven de la query string sin perderse", () => {
  const f = filtros({
    status: "APPROVED",
    stage: "PLAN",
    studentId: "std_7",
    decidedByUserId: "u_doc_9",
    programId: "prog_3",
    desdeISO: "2026-03-01",
    hastaISO: "2026-03-31",
    q: "rodriguez",
    soloMias: true,
  });
  const qs = eduApprovalHistoryQuery(f);
  // `forEach` y no `Object.fromEntries(…entries())`: el target de
  // TypeScript del repo no deja recorrer el iterador.
  const params: Record<string, string> = {};
  new URLSearchParams(qs).forEach((v, k) => {
    params[k] = v;
  });
  assert.deepEqual(parseEduApprovalHistoryFilters(params), f);
  assert.equal(eduHasApprovalHistoryFilters(f), true);
  assert.equal(eduHasApprovalHistoryFilters(EDU_APPROVAL_HISTORY_EMPTY_FILTERS), false);
});

test("una URL sin filtros no arrastra basura en la query string", () => {
  assert.equal(eduApprovalHistoryQuery(EDU_APPROVAL_HISTORY_EMPTY_FILTERS), "");
});

test("lo que no se reconoce en la URL se tira, no revienta", () => {
  const f = parseEduApprovalHistoryFilters({
    estado: "DEL_MONTON",
    etapa: "CUALQUIERA",
    // Un id con comillas o con % es un intento, no un id.
    estudiante: "std_7'; DROP TABLE--",
    docente: "%",
    especialidad: "x".repeat(80),
    desde: "03/03/2026",
    hasta: "2026-13-45",
    mias: "sí",
  });
  assert.deepEqual(f, EDU_APPROVAL_HISTORY_EMPTY_FILTERS);
});

test("🔴 aquí NO se lee ningún institutionId de la URL", () => {
  // Si el parseo aceptara un tenant, bastaría con teclearlo para leer el
  // historial de otra escuela. El institutionId sale de la sesión, siempre.
  const f = parseEduApprovalHistoryFilters({ institutionId: OTRO_INST, instituto: OTRO_INST });
  assert.deepEqual(f, EDU_APPROVAL_HISTORY_EMPTY_FILTERS);
  const where = whereDe("DIRECCION", "u_dir", f);
  assert.ok(!JSON.stringify(where).includes(OTRO_INST));
});

test("un rango de fechas al revés se ignora ENTERO", () => {
  const f = parseEduApprovalHistoryFilters({ desde: "2026-03-31", hasta: "2026-03-01" });
  assert.equal(f.desdeISO, null);
  assert.equal(f.hastaISO, null);
  // Quedarse con un lado inventaría un filtro que nadie pidió, y en una
  // pantalla de auditoría eso se lee como "no hay nada" cuando sí lo hay.
});

test("el rango va sobre la DECISIÓN y en días del INSTITUTO, no en UTC", () => {
  const where = whereDe("DIRECCION", "u_dir", { desdeISO: "2026-03-02", hastaISO: "2026-03-02" });
  const and = (where.AND ?? []) as Record<string, { decidedAt?: { gte?: Date; lt?: Date } }>[];
  const gte = and.map((c) => c.decidedAt?.gte).find(Boolean) as Date | undefined;
  const lt = and.map((c) => c.decidedAt?.lt).find(Boolean) as Date | undefined;
  assert.ok(gte && lt, "el rango de fechas no llegó al where");

  // México (UTC−6): el día 2 empieza a las 06:00 UTC y el extremo derecho
  // es EXCLUSIVO (medianoche del 3). Pintado en UTC, una firma de las 20:00
  // caería al día siguiente y quien filtra "el 2" no la encontraría.
  assert.equal(gte.toISOString(), "2026-03-02T06:00:00.000Z");
  assert.equal(lt.toISOString(), "2026-03-03T06:00:00.000Z");
});

test("el buscador de paciente va contra el índice SIN ACENTOS y saneado para LIKE", () => {
  const where = whereDe("DIRECCION", "u_dir", { q: "Rodríguez 100%" });
  const contains = valoresDe(where, "contains") as string[];
  assert.ok(contains.length > 0, "el buscador no llegó al where");
  // Sin acentos (la columna searchIndex de la Ola 1B se guarda así)…
  assert.ok(contains.includes("rodriguez"));
  // …y sin los comodines que Prisma NO escapa: un "%" suelto traería la
  // tabla entera.
  for (const c of contains) {
    assert.ok(!c.includes("%"), `el término "${c}" lleva un comodín de LIKE`);
    assert.ok(!c.includes("_"));
    assert.ok(!c.includes("\\"));
  }
  // Y busca por PACIENTE, dentro del caso: nunca por una columna suelta.
  assert.ok(JSON.stringify(where.AND).includes("searchIndex"));
  assert.ok(JSON.stringify(where.AND).includes("patient"));
});

// ═════════════════════════════════════════════════════════════════════
// 5 · LAS OPCIONES DE LOS FILTROS TAMBIÉN SON DATOS (P1-4)
// ═════════════════════════════════════════════════════════════════════

test("🔴 el desplegable de estudiantes se decide por ALCANCE, no por rol escrito a mano", () => {
  // `listEduApprovalHistoryStudents` corta con estas dos preguntas, y son
  // las mismas del recorte de las filas: si un día cambia el alcance,
  // cambian las opciones con él.
  const casos: [EduRole, string, boolean][] = [
    // rol, id, ¿le viaja lista de alumnos?
    ["DIRECCION", "u_dir", true],
    ["DOCENTE", DOC_A, true],
    ["ALUMNO", AL_1, false],
    ["CAJA", "u_caja", false],
  ];
  for (const [role, id, esperado] of casos) {
    const scope: EduVisibilityScope = eduVisibility(actor(role, id), "cases");
    const viaja = !eduScopeIsEmpty(scope) && scope.kind !== "own";
    assert.equal(viaja, esperado, `${role} recibió la lista de alumnos al revés`);
  }
});

// ═════════════════════════════════════════════════════════════════════
// 6 · EL RENGLÓN — que las dos pantallas digan lo mismo
// ═════════════════════════════════════════════════════════════════════

test("el mapa de tonos cubre TODOS los estados del enum", () => {
  // Es el mapa que pintan la ficha del caso y el historial. Si el enum gana
  // un estado y este mapa no, la fila saldría sin tag y nadie se enteraría.
  for (const s of EDU_APPROVAL_STATUSES) {
    assert.ok(EDU_APPROVAL_STATUS_TAG[s], `falta el tono de ${s}`);
    assert.match(EDU_APPROVAL_STATUS_TAG[s], /^edu-tag--/);
  }
});

test("los tres roles que ven el historial son los mismos que ven la bandeja", () => {
  // Una pantalla nueva no reparte permisos nuevos: se cuelga de
  // "autorizaciones.view", que ya tiene dueño.
  const ven = EDU_ROLES.filter((r) => hasEduPermission({ role: r }, "autorizaciones.view"));
  assert.deepEqual([...ven].sort(), ["ALUMNO", "DIRECCION", "DOCENTE"]);
});

// ═════════════════════════════════════════════════════════════════════
// 7 · LO QUE NO SE PUEDE COMPROBAR SIN LEER EL CÓDIGO
//
// La lección del P1-4: un `where` correcto que nadie llama es igual de
// inseguro que uno equivocado. Estas tres leen los archivos —sin sus
// comentarios: se juzga por lo que hacen, no por lo que dicen— y
// comprueban que la llamada está PUESTA.
// ═════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, "..", "..", "..", "..");

function fuente(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

test("🔴 CAJA: el 403 de la API es real — el endpoint exige la key antes de leer", () => {
  // El guard traduce esto a 403 (api-guard.ts). Es la primera cerradura;
  // la segunda es el alcance, y ya está probada arriba.
  assert.throws(
    () => assertEduPermission({ role: "CAJA" }, "autorizaciones.view"),
    (err: unknown) => err instanceof EduForbiddenError && err.permission === "autorizaciones.view",
  );

  const ruta = fuente("src", "app", "api", "instituto", "autorizaciones", "route.ts");
  // El guard va ANTES de cualquier lectura, y la rama del historial vive
  // dentro del mismo GET (no hay un segundo endpoint sin puerta).
  const guard = ruta.indexOf('eduApiGuard("autorizaciones.view")');
  const historial = ruta.indexOf('historial');
  assert.ok(guard !== -1, "el GET perdió su guard");
  assert.ok(historial !== -1, "la rama del historial no está en el endpoint");
  assert.ok(guard < historial, "la rama del historial se leyó antes de comprobar el permiso");
  // Y el institutionId NO sale de la query: sale de la sesión.
  assert.ok(!/searchParams\.get\(\s*["'](instituto|institutionId)["']/.test(ruta));
});

test("🔴 la pantalla del historial cierra las DOS cerraduras antes de pintar", () => {
  const page = fuente(
    "src",
    "app",
    "instituto",
    "(panel)",
    "autorizaciones",
    "historial",
    "page.tsx",
  );
  // 1 · el permiso, en la página y no solo en el menú (esconder un item no
  //     cierra nada: basta con teclear la URL);
  assert.ok(page.includes('hasEduPermission(permUser, "autorizaciones.view")'));
  // 2 · el alcance, con el helper ÚNICO y no con un `if` de rol escrito a
  //     mano. Para CAJA es "none" y la pantalla lo dice con palabras en vez
  //     de enseñar una lista vacía que miente.
  assert.ok(page.includes('eduVisibility(ctx, "cases")'));
  assert.ok(page.includes('scope.kind === "none"'));
  // Y el institutionId no se lee de la URL en ningún sitio.
  assert.ok(!/searchParams\??\.\w*institution/i.test(page));
});

test("🔴 el botón «Historial» vive DONDE ya se comprobó el permiso", () => {
  // Está dentro de la bandeja, que la página solo pinta después de las dos
  // cerraduras. A CAJA no le sale porque no llega a esa rama — y aunque
  // llegara, el endpoint y el alcance siguen cerrados: esconder es
  // cortesía, cerrar es el guard.
  const bandeja = fuente("src", "components", "edu", "autorizaciones", "bandeja-screen.tsx");
  assert.ok(bandeja.includes('href="/instituto/autorizaciones/historial"'));

  const page = fuente("src", "app", "instituto", "(panel)", "autorizaciones", "page.tsx");
  const permiso = page.indexOf('hasEduPermission(permUser, "autorizaciones.view")');
  const alcance = page.indexOf('scope.kind === "none"');
  const pinta = page.indexOf("<EduBandejaScreen");
  assert.ok(permiso !== -1 && alcance !== -1 && pinta !== -1);
  assert.ok(permiso < pinta, "la bandeja se pinta antes de comprobar el permiso");
  assert.ok(alcance < pinta, "la bandeja se pinta antes de comprobar el alcance");
});
