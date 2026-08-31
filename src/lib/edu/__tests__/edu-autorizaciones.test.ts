/**
 * EL GATE DE AUTORIZACIÓN — Ola 4 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-autorizaciones.test.ts
 *
 * (No hay `npm run test:edu-autorizaciones`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo se comprueba SIN base de datos, y no por comodidad: `visibility.ts`
 * devuelve objetos `where` sin ejecutarlos, el hash es una función de un
 * texto y el juicio del gate es aritmética de estados. Lo único que se
 * quedaría fuera de una prueba con Postgres detrás es lo que Postgres
 * aporta —el índice único parcial— y eso está anotado como NO probado.
 *
 * Lo que fija este archivo:
 *  1. 🔴 APROBAR → EDITAR → LA APROBACIÓN YA NO VALE. Es LA regla de la ola:
 *     sin ella, el alumno manda A, el docente firma A, el alumno edita a B,
 *     y B queda "autorizado por el docente";
 *  2. 🔴 QUE UN DOCENTE SOLO VEA LO DE LOS ALUMNOS QUE SUPERVISA HOY. Una
 *     asignación vencida no da acceso, y por tanto tampoco da firma;
 *  3. que el GATE bloquee el AVANCE y NO el expediente;
 *  4. que la RUTA DE URGENCIA deje pasar y deje constancia;
 *  5. que el LOTE no se trague justo lo que hay que leer;
 *  6. el reparto de las tres keys nuevas por rol, y que pedir y firmar sean
 *     dos permisos distintos;
 *  7. que las uniones de types.ts no se desincronicen de los enums de Prisma
 *     (chequeo de TIPOS, lo verifica `tsc --noEmit`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  EduApprovalStage as PrismaApprovalStage,
  EduApprovalStatus as PrismaApprovalStatus,
} from "@prisma/client";
import {
  EDU_APPROVAL_BATCH_SKIP_LABELS,
  EDU_APPROVAL_DECISIONS,
  EDU_APPROVAL_GATE_BY_CASE_STATUS,
  EDU_APPROVAL_HASH_VERSION,
  EDU_APPROVAL_STAGE_TARGET,
  EDU_APPROVAL_TARGETS,
  EDU_APPROVAL_WAIT_LATE_MINUTES,
  eduApprovalBatchSkipReason,
  eduApprovalCanonicalText,
  eduApprovalContentChanged,
  eduApprovalDecisionNeedsNote,
  eduApprovalEffectiveStatus,
  eduApprovalOpensGate,
  eduApprovalStageForCaseStatus,
  eduApprovalTargetForStage,
  eduApprovalWaitSeverity,
  eduApprovalWaitedLabel,
  eduApprovalWaitedMinutes,
  eduCaseGateVerdict,
  eduGroupApprovalsByStudent,
  parseEduApprovalDecision,
  parseEduApprovalStage,
  parseEduApprovalTarget,
  type EduApprovalRecordSnapshot,
  type EduApprovalRow,
} from "../autorizaciones-core";
import { eduApprovalHash } from "../autorizaciones-hash";
import {
  eduCaseScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
} from "../visibility";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  hasEduPermission,
  type EduPermissionKey,
} from "../permissions";
import {
  EDU_APPROVAL_STAGES,
  EDU_APPROVAL_STAGE_LABELS,
  EDU_APPROVAL_STATUSES,
  EDU_APPROVAL_STATUS_LABELS,
  EDU_NAV_ITEMS,
  EDU_ROLES,
  EDU_UPCOMING_AREAS,
  type EduApprovalStage,
  type EduApprovalStatus,
  type EduRole,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: las uniones de types.ts == los enums de Prisma
//     Si una ola agrega un valor al schema y no lo agrega a types.ts (o al
//     revés), `tsc --noEmit` falla aquí. En runtime esto no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _stage: Exacto<EduApprovalStage, PrismaApprovalStage> = true;
const _status: Exacto<EduApprovalStatus, PrismaApprovalStatus> = true;
void _stage;
void _status;

const INST = "inst_1";
const OTRO_INST = "inst_2";
const AHORA = new Date("2026-08-29T18:00:00.000Z");

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

function nota(over: Partial<EduApprovalRecordSnapshot> = {}): EduApprovalRecordSnapshot {
  return {
    kind: "EduRecord",
    subjetivo: "Dolor espontáneo en el 26 desde hace tres noches.",
    objetivo: "Percusión positiva. Radiolucidez periapical.",
    analisis: "Necrosis pulpar con periodontitis apical.",
    plan: "Endodoncia en dos sesiones. Hoy: apertura e instrumentación.",
    diagnostico: "Necrosis pulpar 26",
    ...over,
  };
}

// ═════════════════════════════════════════════════════════════════════
// 1 · 🔴 LA REGLA DE LA OLA: APROBAR → EDITAR → YA NO VALE
// ═════════════════════════════════════════════════════════════════════

test("el mismo contenido da el MISMO hash (una firma no se vence sola)", () => {
  assert.equal(eduApprovalHash(nota()), eduApprovalHash(nota()));
  // Y el hash es un sha256 en hexadecimal de 64 caracteres, que es lo que
  // cabe en la columna VarChar(64).
  assert.match(eduApprovalHash(nota()), /^[0-9a-f]{64}$/);
});

test("🔴 aprobar → editar → la aprobación YA NO VALE (pasa a EXPIRED sola)", () => {
  const original = nota();
  const firmado = eduApprovalHash(original);

  // El docente firmó ESTO.
  const aprobacion = { status: "APPROVED" as EduApprovalStatus, contentHash: firmado };
  assert.equal(eduApprovalEffectiveStatus(aprobacion, firmado), "APPROVED");
  assert.equal(eduApprovalOpensGate({ status: "APPROVED" }), true);

  // El alumno edita el plan DESPUÉS de la firma.
  const editado = eduApprovalHash(nota({ plan: "Extracción del 26. Ya no se puede salvar." }));
  assert.notEqual(editado, firmado);
  assert.equal(eduApprovalEffectiveStatus(aprobacion, editado), "EXPIRED");
  assert.equal(eduApprovalContentChanged(aprobacion, editado), true);

  // Y por tanto la puerta se cierra: el caso deja de poder avanzar.
  const veredicto = eduCaseGateVerdict("PLAN", [{ status: "EXPIRED" }]);
  assert.equal(veredicto.ok, false);
  assert.match(veredicto.detail, /venc/i);
});

test("cambiar CUALQUIERA de los campos clínicos vence la firma", () => {
  const firmado = eduApprovalHash(nota());
  const campos: (keyof EduApprovalRecordSnapshot)[] = [
    "subjetivo",
    "objetivo",
    "analisis",
    "plan",
    "diagnostico",
  ];
  for (const c of campos) {
    const otro = eduApprovalHash(nota({ [c]: "otra cosa completamente distinta" } as never));
    assert.notEqual(otro, firmado, `editar ${c} no venció la firma`);
  }
});

test("una firma NO se vence por un salto de línea de Windows ni por un acento descompuesto", () => {
  // Los dos casos que harían que una autorización se venciera sola sin que
  // nadie hubiera editado nada: el mismo texto copiado desde otro sistema.
  const base = eduApprovalHash(nota({ plan: "Línea uno\nlínea dos" }));
  assert.equal(eduApprovalHash(nota({ plan: "Línea uno\r\nlínea dos" })), base);
  // La "i" acentuada DESCOMPUESTA (i + U+0301, el acento combinante)
  // frente a la compuesta (U+00ED). Son bytes distintos y el mismo texto en
  // pantalla: macOS produce una forma y Windows la otra, asi que sin NFC un
  // plan copiado de un lado a otro venceria su propia firma.
  const descompuesta = "Línea uno\nlínea dos";
  const compuesta = "Línea uno\nlínea dos";
  assert.notEqual(descompuesta, compuesta, "el caso de prueba no esta descompuesto");
  assert.equal(eduApprovalHash(nota({ plan: descompuesta })), base);
  // Y un espacio al final tampoco es un cambio de plan.
  assert.equal(eduApprovalHash(nota({ plan: "Línea uno\nlínea dos   " })), base);
});

test("una MAYÚSCULA sí es un cambio: 'no extraer' y 'NO EXTRAER' no son lo mismo en pantalla", () => {
  assert.notEqual(
    eduApprovalHash(nota({ plan: "no extraer" })),
    eduApprovalHash(nota({ plan: "NO EXTRAER" })),
  );
});

test("null y cadena vacía son el mismo contenido; borrar un campo con texto NO", () => {
  assert.equal(eduApprovalHash(nota({ analisis: null })), eduApprovalHash(nota({ analisis: "" })));
  assert.notEqual(eduApprovalHash(nota({ analisis: null })), eduApprovalHash(nota()));
});

test("dos campos no se pueden intercambiar sin que cambie el hash (los separadores mandan)", () => {
  // Sin el nombre del campo dentro del texto canónico, mover el mismo párrafo
  // del "objetivo" al "análisis" daría el mismo resumen y la firma seguiría
  // valiendo sobre una nota que dice otra cosa.
  const a = eduApprovalHash(nota({ objetivo: "X", analisis: "Y" }));
  const b = eduApprovalHash(nota({ objetivo: "Y", analisis: "X" }));
  assert.notEqual(a, b);
});

test("el texto canónico lleva su VERSIÓN dentro (cambiarla es una decisión, no un refactor)", () => {
  const texto = eduApprovalCanonicalText(nota());
  assert.ok(texto.startsWith(EDU_APPROVAL_HASH_VERSION));
  // Y el tipo de fila también: una nota y una cita con los mismos textos no
  // pueden producir el mismo resumen.
  assert.ok(texto.includes("EduRecord"));
});

test("una cita vence su firma si se reagenda o cambia de sillón, y NO si avanza de estado", () => {
  const cita = {
    kind: "EduAppointment" as const,
    startsAtISO: "2026-09-01T16:00:00.000Z",
    endsAtISO: "2026-09-01T17:00:00.000Z",
    chairId: "chair_3",
    type: "TRATAMIENTO",
  };
  const firmado = eduApprovalHash(cita);
  assert.notEqual(eduApprovalHash({ ...cita, startsAtISO: "2026-09-03T16:00:00.000Z" }), firmado);
  assert.notEqual(eduApprovalHash({ ...cita, chairId: "chair_9" }), firmado);
  // El estado de la cita NO entra en el resumen: "llegó" y "en el sillón"
  // ocurren MIENTRAS pasa lo que se autorizó.
  assert.equal(eduApprovalHash({ ...cita }), firmado);
});

test("un snapshot roto no se confunde con uno vacío legítimo", () => {
  const roto = eduApprovalCanonicalText(null as never);
  const vacia = eduApprovalCanonicalText(
    nota({ subjetivo: null, objetivo: null, analisis: null, plan: null, diagnostico: null }),
  );
  assert.notEqual(roto, vacia);
});

test("si la fila apuntada desaparece, la firma deja de valer (no se asume que sigue igual)", () => {
  const a = { status: "APPROVED" as EduApprovalStatus, contentHash: eduApprovalHash(nota()) };
  assert.equal(eduApprovalEffectiveStatus(a, null), "EXPIRED");
  assert.equal(eduApprovalContentChanged(a, null), true);
});

test("una PENDING con el contenido cambiado NO se vence sola: se marca", () => {
  // Vencerla haría desaparecer de la bandeja la petición de un alumno que
  // corrigió un dedazo, sin que el alumno pudiera saber por qué. Lo que sí
  // pasa es que sale del lote.
  const p = { status: "PENDING" as EduApprovalStatus, contentHash: "hash-viejo" };
  assert.equal(eduApprovalEffectiveStatus(p, "hash-nuevo"), "PENDING");
  assert.equal(eduApprovalContentChanged(p, "hash-nuevo"), true);
  assert.equal(
    eduApprovalBatchSkipReason({ status: "PENDING", isEmergency: false, contentChanged: true }),
    "cambio",
  );
});

// ═════════════════════════════════════════════════════════════════════
// 2 · 🔴 QUIÉN VE (Y POR TANTO QUIÉN FIRMA)
// ═════════════════════════════════════════════════════════════════════

test("las autorizaciones se leen con el recurso 'cases': CAJA no ve NINGUNA", () => {
  assert.deepEqual(eduVisibility(actor("CAJA"), "cases"), { kind: "none" });
  assert.equal(eduScopeIsEmpty(eduVisibility(actor("CAJA"), "cases")), true);
  // Y el `where` de cinturón no devuelve una sola fila.
  const where = eduCaseScopeWhere({
    institutionId: INST,
    scope: eduVisibility(actor("CAJA"), "cases"),
    now: AHORA,
  });
  assert.deepEqual(where, { institutionId: INST, id: { in: [] } });
});

test("🔴 el DOCENTE solo alcanza lo de los alumnos que supervisa CON ASIGNACIÓN VIGENTE", () => {
  const scope = eduVisibility(actor("DOCENTE", "doc_7"), "cases");
  assert.deepEqual(scope, { kind: "supervised", supervisorUserId: "doc_7" });

  const where = eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA });

  // El recorte cuelga de la asignación alumno↔docente…
  const supervisores = valoresDe(where, "supervisorUserId");
  assert.deepEqual(supervisores, ["doc_7"]);

  // …y esa asignación lleva VIGENCIA: hay un filtro sobre startsAt y otro
  // sobre endsAt. Un docente que ya rotó deja de ver —y de poder firmar— lo
  // de los alumnos que entregó, sin que nadie le apague un permiso.
  const empieza = valoresDe(where, "startsAt");
  const termina = valoresDe(where, "endsAt");
  assert.ok(empieza.length > 0, "el recorte del docente no comprueba desde cuándo");
  assert.ok(termina.length > 0, "el recorte del docente no comprueba hasta cuándo");
  assert.ok(
    JSON.stringify(empieza).includes(AHORA.toISOString()),
    "la vigencia no se evalúa con el `now` que se le pasa",
  );
});

test("el ALUMNO solo alcanza lo suyo, y el institutionId está SIEMPRE", () => {
  const scope = eduVisibility(actor("ALUMNO", "al_3"), "cases");
  assert.deepEqual(scope, { kind: "own", studentUserId: "al_3" });

  const where = eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.equal(where.institutionId, INST);
  // Un institutionId undefined BORRA el filtro de tenant en Prisma: la
  // bandeja de una escuela enseñaría la de otra.
  const tenants = valoresDe(where, "institutionId");
  assert.ok(tenants.length > 0);
  for (const t of tenants) {
    assert.equal(t, INST);
    assert.notEqual(t, OTRO_INST);
    assert.notEqual(t, undefined);
  }
});

test("la DIRECCION ve todas las del instituto y ninguna de otro", () => {
  const where = eduCaseScopeWhere({
    institutionId: INST,
    scope: eduVisibility(actor("DIRECCION"), "cases"),
    now: AHORA,
  });
  assert.deepEqual(where, { institutionId: INST });
});

test("un rol desconocido o sin id de usuario no ve nada (la opción segura)", () => {
  assert.deepEqual(eduVisibility({ role: "RECTOR" as EduRole, eduUserId: "x" }, "cases"), {
    kind: "none",
  });
  assert.deepEqual(eduVisibility(actor("DOCENTE", ""), "cases"), { kind: "none" });
  assert.deepEqual(eduVisibility(actor("ALUMNO", ""), "cases"), { kind: "none" });
});

// ═════════════════════════════════════════════════════════════════════
// 3 · 🔴 LA PUERTA: qué bloquea y qué NO
// ═════════════════════════════════════════════════════════════════════

test("🔴 SOLO se gatean DOS avances: a 'en tratamiento' y a 'terminado'", () => {
  assert.equal(eduApprovalStageForCaseStatus("IN_TREATMENT"), "PLAN");
  assert.equal(eduApprovalStageForCaseStatus("COMPLETED"), "DISCHARGE");

  // Parar NUNCA pide firma: pedir permiso para parar es cómo se consigue que
  // nadie registre que paró.
  for (const st of ["SCREENING", "ASSIGNED", "ON_HOLD", "TRANSFERRED", "ABANDONED"] as const) {
    assert.equal(eduApprovalStageForCaseStatus(st), null, `${st} no debería pedir firma`);
  }
  assert.deepEqual(Object.keys(EDU_APPROVAL_GATE_BY_CASE_STATUS).sort(), [
    "COMPLETED",
    "IN_TREATMENT",
  ]);
});

test("sin autorización, el caso no avanza — y el mensaje dice qué hacer", () => {
  const v = eduCaseGateVerdict("PLAN", []);
  assert.equal(v.ok, false);
  assert.equal(v.viaEmergency, false);
  assert.match(v.detail, /Falta la autorización/i);
  // El mensaje no puede ser "no autorizado": tiene que decir dónde se manda.
  assert.match(v.detail, /ficha del caso/i);
});

test("con la firma vigente, avanza", () => {
  const v = eduCaseGateVerdict("PLAN", [{ status: "APPROVED" }]);
  assert.equal(v.ok, true);
  assert.equal(v.viaEmergency, false);
});

test("cada estado bloqueante explica algo DISTINTO (pendiente ≠ rechazada ≠ con cambios)", () => {
  const textos = new Set(
    (["PENDING", "REJECTED", "CHANGES_REQUESTED", "EXPIRED"] as EduApprovalStatus[]).map(
      (s) => eduCaseGateVerdict("PLAN", [{ status: s }]).detail,
    ),
  );
  assert.equal(textos.size, 4, "dos estados distintos dan el mismo mensaje");
});

test("una firma de OTRA etapa no abre esta puerta", () => {
  // El gate recibe solo las de su etapa; que la lista llegue vacía es
  // exactamente lo que tiene que pasar cuando el PLAN está firmado y lo que
  // se pide es el ALTA.
  assert.equal(eduCaseGateVerdict("DISCHARGE", []).ok, false);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · 🔴 LA RUTA DE URGENCIA: deja constancia en vez de bloquear
// ═════════════════════════════════════════════════════════════════════

test("🔴 una urgencia PENDIENTE deja avanzar: al paciente con dolor no se le impide nada", () => {
  const v = eduCaseGateVerdict("PLAN", [{ status: "PENDING", isEmergency: true }]);
  assert.equal(v.ok, true);
  assert.equal(v.viaEmergency, true);
  // Y el veredicto lo DICE: pasó, pero sigue faltando la firma.
  assert.match(v.detail, /urgencia/i);
});

test("una PENDIENTE normal NO deja avanzar (si no, la urgencia no significaría nada)", () => {
  assert.equal(eduApprovalOpensGate({ status: "PENDING", isEmergency: false }), false);
  assert.equal(eduApprovalOpensGate({ status: "PENDING" }), false);
  assert.equal(eduCaseGateVerdict("PLAN", [{ status: "PENDING", isEmergency: false }]).ok, false);
});

test("una urgencia RECHAZADA o devuelta deja de abrir la puerta", () => {
  for (const s of ["REJECTED", "CHANGES_REQUESTED", "EXPIRED"] as EduApprovalStatus[]) {
    assert.equal(
      eduApprovalOpensGate({ status: s, isEmergency: true }),
      false,
      `una urgencia ${s} no debería seguir abriendo`,
    );
  }
});

test("una urgencia FIRMADA abre por firma, no por urgencia", () => {
  const v = eduCaseGateVerdict("PLAN", [{ status: "APPROVED", isEmergency: true }]);
  assert.equal(v.ok, true);
  assert.equal(v.viaEmergency, false);
});

// ═════════════════════════════════════════════════════════════════════
// 5 · 🔴 EL LOTE: existe para que el gate no sea un sello de goma, y por
//     eso mismo no se traga lo que hay que leer
// ═════════════════════════════════════════════════════════════════════

test("lo normal y pendiente SÍ entra en el lote", () => {
  assert.equal(
    eduApprovalBatchSkipReason({ status: "PENDING", isEmergency: false, contentChanged: false }),
    null,
  );
});

test("🔴 una URGENCIA nunca entra en el lote: ya ocurrió sin firma", () => {
  assert.equal(
    eduApprovalBatchSkipReason({ status: "PENDING", isEmergency: true, contentChanged: false }),
    "urgencia",
  );
});

test("lo que dejó de estar pendiente tampoco entra", () => {
  for (const s of ["APPROVED", "REJECTED", "CHANGES_REQUESTED", "EXPIRED"] as EduApprovalStatus[]) {
    assert.equal(
      eduApprovalBatchSkipReason({ status: s, isEmergency: false, contentChanged: false }),
      "no-pendiente",
    );
  }
});

test("cada motivo de exclusión tiene un texto que se le puede enseñar a una persona", () => {
  for (const [k, v] of Object.entries(EDU_APPROVAL_BATCH_SKIP_LABELS)) {
    assert.ok(v.length > 20, `el motivo "${k}" no explica nada: ${v}`);
    assert.notEqual(v, k);
  }
  // Los cinco motivos existen, incluido el de "la mandaste tú" y el de la
  // RECETA (Ola 14: se expide leyéndola, nunca en lote).
  assert.deepEqual(Object.keys(EDU_APPROVAL_BATCH_SKIP_LABELS).sort(), [
    "cambio",
    "no-pendiente",
    "propia",
    "receta",
    "urgencia",
  ]);
});

test("el lote SOLO autoriza: pedir cambios y rechazar llevan motivo y van una por una", () => {
  assert.deepEqual([...EDU_APPROVAL_DECISIONS].sort(), [
    "APPROVED",
    "CHANGES_REQUESTED",
    "REJECTED",
  ]);
  assert.equal(eduApprovalDecisionNeedsNote("APPROVED"), false);
  assert.equal(eduApprovalDecisionNeedsNote("CHANGES_REQUESTED"), true);
  assert.equal(eduApprovalDecisionNeedsNote("REJECTED"), true);
  assert.equal(parseEduApprovalDecision("EXPIRED"), null, "EXPIRED no lo decide una persona");
  assert.equal(parseEduApprovalDecision("PENDING"), null);
  assert.equal(parseEduApprovalDecision(null), null);
});

// ═════════════════════════════════════════════════════════════════════
// 6 · LA BANDEJA: agrupada por alumno, urgencias primero
// ═════════════════════════════════════════════════════════════════════

function fila(over: Partial<EduApprovalRow>): EduApprovalRow {
  return {
    id: "a1",
    stage: "PLAN",
    stageLabel: "Plan de tratamiento",
    status: "PENDING",
    storedStatus: "PENDING",
    targetType: "EduRecord",
    targetId: "r1",
    caseId: "c1",
    programName: "Endodoncia",
    caseStatusLabel: "Asignado",
    patientId: "p1",
    patientName: "Ana Ramírez",
    patientFolio: "P-0042",
    studentId: "s1",
    studentName: "Sofía Ibarra",
    studentMatricula: "A-014",
    requestedByName: "Sofía Ibarra",
    requestedAt: "2026-08-29T17:00:00.000Z",
    requestedAtLabel: "sáb 29 ago 11:00",
    waitedMinutes: 60,
    waitedLabel: "hace 1 h",
    waitSeverity: "late",
    decidedByName: null,
    decidedAt: null,
    decidedAtLabel: null,
    decisionNote: null,
    isEmergency: false,
    emergencyReason: null,
    contentChanged: false,
    batchSkip: null,
    summary: { title: "Necrosis pulpar 26", lines: [] },
    ...over,
  };
}

test("la bandeja se agrupa POR ALUMNO y el lote es de ese alumno, no de doce", () => {
  const grupos = eduGroupApprovalsByStudent([
    fila({ id: "a1", studentId: "s1", studentMatricula: "A-014" }),
    fila({ id: "a2", studentId: "s2", studentMatricula: "A-020", studentName: "Luis Peña" }),
    fila({ id: "a3", studentId: "s1", studentMatricula: "A-014" }),
  ]);
  assert.equal(grupos.length, 2);
  const s1 = grupos.find((g) => g.studentId === "s1");
  assert.deepEqual(s1?.batchIds.sort(), ["a1", "a3"]);
});

test("🔴 las urgencias van PRIMERO, y fuera del lote", () => {
  const grupos = eduGroupApprovalsByStudent([
    fila({ id: "a1", studentId: "s1", waitedMinutes: 200, requestedAt: "2026-08-29T14:00:00.000Z" }),
    fila({
      id: "a2",
      studentId: "s2",
      studentMatricula: "A-020",
      waitedMinutes: 5,
      requestedAt: "2026-08-29T17:55:00.000Z",
      isEmergency: true,
      batchSkip: "urgencia",
    }),
  ]);
  // El grupo con urgencia manda, aunque el otro lleve tres horas más.
  assert.equal(grupos[0].studentId, "s2");
  assert.equal(grupos[0].emergencies, 1);
  assert.deepEqual(grupos[0].batchIds, [], "una urgencia no puede entrar al lote");
});

test("dentro de un grupo: urgencias primero y después por orden de llegada", () => {
  const [g] = eduGroupApprovalsByStudent([
    fila({ id: "vieja", requestedAt: "2026-08-29T10:00:00.000Z" }),
    fila({ id: "nueva", requestedAt: "2026-08-29T17:00:00.000Z" }),
    fila({ id: "urgente", requestedAt: "2026-08-29T17:30:00.000Z", isEmergency: true }),
  ]);
  assert.deepEqual(
    g.rows.map((r) => r.id),
    ["urgente", "vieja", "nueva"],
  );
});

test("dos grupos con la misma espera no bailan entre recargas", () => {
  const armar = () =>
    eduGroupApprovalsByStudent([
      fila({ id: "a", studentId: "s2", studentMatricula: "A-020", waitedMinutes: 30 }),
      fila({ id: "b", studentId: "s1", studentMatricula: "A-014", waitedMinutes: 30 }),
    ]).map((g) => g.studentId);
  assert.deepEqual(armar(), armar());
  assert.deepEqual(armar(), ["s1", "s2"]);
});

test("cuánto lleva esperando se lee como lo diría una persona", () => {
  assert.equal(eduApprovalWaitedLabel(0), "recién llegada");
  assert.equal(eduApprovalWaitedLabel(12), "hace 12 min");
  assert.equal(eduApprovalWaitedLabel(90), "hace 1 h");
  assert.equal(eduApprovalWaitedLabel(60 * 72), "hace 3 días");
  // Un reloj adelantado no produce "hace -3 min".
  assert.equal(eduApprovalWaitedMinutes(new Date("2026-08-29T19:00:00Z"), AHORA), 0);
  assert.equal(eduApprovalWaitedMinutes(new Date("2026-08-29T17:00:00Z"), AHORA), 60);
  assert.equal(eduApprovalWaitSeverity(0), "ok");
  assert.equal(eduApprovalWaitSeverity(EDU_APPROVAL_WAIT_LATE_MINUTES), "late");
});

// ═════════════════════════════════════════════════════════════════════
// 7 · EL CATÁLOGO: etapas, tipos apuntables y estados
// ═════════════════════════════════════════════════════════════════════

test("cada etapa apunta a un tipo de fila de la lista CERRADA", () => {
  for (const s of EDU_APPROVAL_STAGES) {
    const t = eduApprovalTargetForStage(s);
    assert.ok(
      (EDU_APPROVAL_TARGETS as readonly string[]).includes(t),
      `la etapa ${s} apunta a "${t}", que no está en la lista`,
    );
    assert.equal(EDU_APPROVAL_STAGE_TARGET[s], t);
  }
  // La sesión es la única que apunta a una cita; el resto, a la nota donde
  // el alumno escribió lo que propone.
  assert.equal(eduApprovalTargetForStage("SESSION"), "EduAppointment");
  assert.equal(eduApprovalTargetForStage("PLAN"), "EduRecord");
});

test("un targetType inventado no pasa (la base no tiene FK que lo impida)", () => {
  assert.equal(parseEduApprovalTarget("EduRecord"), "EduRecord");
  assert.equal(parseEduApprovalTarget("EduPatient"), null);
  assert.equal(parseEduApprovalTarget("users; DROP TABLE"), null);
  assert.equal(parseEduApprovalTarget(42), null);
  assert.equal(parseEduApprovalStage("PLAN"), "PLAN");
  assert.equal(parseEduApprovalStage("plan"), null);
  assert.equal(parseEduApprovalStage(undefined), null);
});

test("las cuatro etapas y los cinco estados tienen etiqueta en español (la UI no pinta el enum)", () => {
  for (const s of EDU_APPROVAL_STAGES) {
    assert.ok(EDU_APPROVAL_STAGE_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_APPROVAL_STAGE_LABELS[s], s);
  }
  for (const s of EDU_APPROVAL_STATUSES) {
    assert.ok(EDU_APPROVAL_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_APPROVAL_STATUS_LABELS[s], s);
  }
});

// ═════════════════════════════════════════════════════════════════════
// 8 · LOS PERMISOS: pedir y firmar son DOS cosas
// ═════════════════════════════════════════════════════════════════════

const KEYS_OLA_4: EduPermissionKey[] = [
  "autorizaciones.request",
  "autorizaciones.view",
  "autorizaciones.decide",
];

test("las tres keys están en el catálogo, descritas en español y en UN solo grupo", () => {
  for (const k of KEYS_OLA_4) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k);
    assert.equal(
      EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k)).length,
      1,
      `${k} no está en exactamente un grupo`,
    );
  }
});

test("🔴 EL ALUMNO PIDE Y NO FIRMA; EL DOCENTE FIRMA Y NO PIDE", () => {
  // Es la separación de funciones que sostiene toda la ola. Si fueran una
  // sola key, el alumno se firmaría a sí mismo y el gate sería un
  // formulario.
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "autorizaciones.request"), true);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "autorizaciones.view"), true);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "autorizaciones.decide"), false);

  assert.equal(hasEduPermission({ role: "DOCENTE" }, "autorizaciones.decide"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "autorizaciones.view"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "autorizaciones.request"), false);
});

test("🔴 CAJA no trae NINGUNA de las tres: cobrar no es autorizar un acto clínico", () => {
  for (const k of KEYS_OLA_4) {
    assert.equal(hasEduPermission({ role: "CAJA" }, k), false, `CAJA no debería traer ${k}`);
  }
  // Y el segundo candado: aunque alguien se las encendiera a mano, el
  // alcance del recurso "cases" le sigue devolviendo "none".
  assert.deepEqual(eduVisibility(actor("CAJA"), "cases"), { kind: "none" });
  // Y sigue trabajando: recibe, agenda y cobra.
  assert.equal(hasEduPermission({ role: "CAJA" }, "pacientes.view"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "caja.charge"), true);
});

test("la DIRECCION trae las tres (puede desatorar un caso sin alumno)", () => {
  for (const k of KEYS_OLA_4) {
    assert.equal(hasEduPermission({ role: "DIRECCION" }, k), true, `DIRECCION sin ${k}`);
  }
});

test("un permiso nuevo NO le llega solo a quien ya tiene override", () => {
  // La regla que muerde en producción, y por la que sql/edu-ola-4.sql trae su
  // backfill comentado.
  const viejo = { role: "DOCENTE" as EduRole, permissionsOverride: ["inicio.view", "casos.view"] };
  assert.equal(hasEduPermission(viejo, "casos.view"), true);
  assert.equal(hasEduPermission(viejo, "autorizaciones.decide"), false);
  assert.equal(hasEduPermission(viejo, "autorizaciones.view"), false);
});

test("los CUATRO roles siguen entrando al panel después de esta ola", () => {
  for (const rol of EDU_ROLES) {
    assert.equal(hasEduPermission({ role: rol }, "inicio.view"), true, `${rol} se quedó fuera`);
  }
});

// ═════════════════════════════════════════════════════════════════════
// 9 · EL ÁREA SALIÓ DE "PRÓXIMAMENTE" Y ENTRÓ AL MENÚ
// ═════════════════════════════════════════════════════════════════════

test("'autorizaciones' está en el menú y ya NO en Próximamente", () => {
  const enMenu = EDU_NAV_ITEMS.find((i) => i.key === "autorizaciones");
  assert.ok(enMenu, "la ola se entregó y no hay item de menú");
  assert.equal(enMenu.permission, "autorizaciones.view");
  assert.equal(enMenu.href, "/instituto/autorizaciones");
  assert.equal(
    EDU_UPCOMING_AREAS.some((a) => a.key === "autorizaciones"),
    false,
    "sigue anunciada como Próximamente",
  );
});

test("va ANTES que la agenda: es la pantalla que un docente abre de pie", () => {
  const operacion = EDU_NAV_ITEMS.filter((i) => i.section === "operacion").map((i) => i.key);
  const iAuth = operacion.indexOf("autorizaciones");
  const iAgenda = operacion.indexOf("agenda");
  assert.ok(iAuth >= 0 && iAgenda >= 0);
  assert.ok(iAuth < iAgenda, "autorizaciones quedó enterrada bajo la agenda");
});
