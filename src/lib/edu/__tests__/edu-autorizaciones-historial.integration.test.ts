/**
 * EL HISTORIAL DE AUTORIZACIONES contra POSTGRES DE VERDAD.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE ADEMÁS DE edu-autorizaciones-historial.test.ts
 *
 * Aquel archivo comprueba el `where` que sale hacia la base: que el id de
 * un alumno ajeno queda DENTRO del recorte y no al lado. Eso es la mitad
 * del argumento. La otra mitad —que Postgres, con ese `where` y con datos
 * de verdad, no devuelve NI UNA FILA— no se puede fingir con mocks: es una
 * propiedad del motor resolviendo un AND sobre una relación anidada.
 *
 * Aquí se siembran DOS INSTITUTOS y DOS DOCENTES a propósito. Con un solo
 * instituto, un `where` al que se le hubiera caído el `institutionId`
 * pasaría igual (no hay filas de nadie más que encontrar) y la prueba diría
 * verde con la fuga puesta. Y con un solo docente, "no ve lo del otro" no
 * se puede ni escribir.
 *
 * ── CÓMO CORRERLO ──────────────────────────────────────────────────────
 *   docker run -d --name eduhist-pg -e POSTGRES_PASSWORD=x -e POSTGRES_DB=x \
 *     -p 54331:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:x@localhost:54331/x \
 *     DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
 *   DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx --test src/lib/edu/__tests__/edu-autorizaciones-historial.integration.test.ts
 *
 * SIN `DATABASE_URL` las pruebas SE SALTAN (no fallan): `npm run test:edu`
 * sigue verde en una máquina sin Docker, y esto no puede apuntar nunca a
 * producción — crea y borra institutos enteros.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  listEduApprovalHistory,
  listEduApprovalHistoryStudents,
} from "@/lib/edu/autorizaciones";
import { EDU_APPROVAL_HISTORY_EMPTY_FILTERS } from "@/lib/edu/autorizaciones-core";
import { eduApprovalHash } from "@/lib/edu/autorizaciones-hash";
import { eduPatientSearchIndex } from "@/lib/edu/search";
import type { EduClinicaContext } from "@/lib/edu/visibility";
import type { EduRole } from "@/lib/edu/types";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const RUN = `h${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
const AHORA = new Date();

function filtros(over: Partial<typeof EDU_APPROVAL_HISTORY_EMPTY_FILTERS> = {}) {
  return { ...EDU_APPROVAL_HISTORY_EMPTY_FILTERS, ...over };
}

/** Un contexto de sesión armado a mano: no hace falta Supabase. */
function ctx(institutionId: string, role: EduRole, eduUserId: string): EduClinicaContext {
  return { institutionId, role, eduUserId, campusIds: null };
}

interface Escuela {
  id: string;
  programId: string;
  cohortId: string;
  direccionId: string;
  docenteA: string;
  docenteB: string;
  /** Alumno de A, vigente. */
  s1: { id: string; userId: string };
  /** Alumno de B, vigente. */
  s2: { id: string; userId: string };
  /** Alumno que A entregó: la asignación TERMINÓ. */
  s3: { id: string; userId: string };
  caso1: string;
  caso2: string;
  caso3: string;
  paciente1: string;
  paciente2: string;
}

const escuelas: Record<string, Escuela> = {};

async function usuario(institutionId: string, tag: string, role: EduRole, nombre: string) {
  return prisma.eduUser.create({
    data: {
      institutionId,
      supabaseId: `${RUN}-${tag}`,
      email: `${RUN}-${tag}@test.local`,
      firstName: nombre,
      lastName: tag.toUpperCase(),
      role,
    },
    select: { id: true },
  });
}

/**
 * Siembra una escuela COMPLETA: dirección, dos docentes, tres alumnos (uno
 * de cada docente y uno que el docente A ya entregó), dos pacientes, tres
 * casos y sus autorizaciones ya decididas.
 */
async function sembrar(tag: string): Promise<Escuela> {
  const inst = await prisma.eduInstitution.create({
    data: { name: `TEST ${tag}`, slug: `${RUN}-${tag}`, timezone: TZ },
    select: { id: true },
  });
  const prog = await prisma.eduProgram.create({
    data: { institutionId: inst.id, name: `Endodoncia ${tag}`, code: `E${tag}` },
    select: { id: true },
  });
  const coh = await prisma.eduCohort.create({
    data: {
      institutionId: inst.id,
      programId: prog.id,
      name: `Gen ${tag}`,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
    },
    select: { id: true },
  });

  const dir = await usuario(inst.id, `${tag}-dir`, "DIRECCION", "Directora");
  const docA = await usuario(inst.id, `${tag}-doca`, "DOCENTE", "Alberto");
  const docB = await usuario(inst.id, `${tag}-docb`, "DOCENTE", "Beatriz");

  async function alumno(n: number, supervisor: string, vigente: boolean) {
    const u = await usuario(inst.id, `${tag}-al${n}`, "ALUMNO", `Alumno${n}`);
    const s = await prisma.eduStudent.create({
      data: {
        institutionId: inst.id,
        userId: u.id,
        programId: prog.id,
        cohortId: coh.id,
        matricula: `${tag.toUpperCase()}-${n}`,
      },
      select: { id: true },
    });
    await prisma.eduSupervisorAssignment.create({
      data: {
        institutionId: inst.id,
        studentId: s.id,
        supervisorUserId: supervisor,
        startsAt: new Date("2026-01-02T00:00:00.000Z"),
        // La entregada terminó AYER: el docente que rotó deja de verla.
        endsAt: vigente ? null : new Date(AHORA.getTime() - 24 * 3600 * 1000),
      },
    });
    return { id: s.id, userId: u.id };
  }

  const s1 = await alumno(1, docA.id, true);
  const s2 = await alumno(2, docB.id, true);
  const s3 = await alumno(3, docA.id, false);

  async function paciente(n: number, first: string, last: string) {
    return prisma.eduPatient.create({
      data: {
        institutionId: inst.id,
        folio: `${tag.toUpperCase()}-P${n}`,
        firstName: first,
        lastName: last,
        searchIndex: eduPatientSearchIndex({
          folio: `${tag.toUpperCase()}-P${n}`,
          firstName: first,
          lastName: last,
        }),
      },
      select: { id: true },
    });
  }

  const p1 = await paciente(1, "María Elena", "Rodríguez");
  const p2 = await paciente(2, "Joaquín", "Peña");

  async function caso(patientId: string, studentId: string, supervisorUserId: string) {
    return prisma.eduCase.create({
      data: {
        institutionId: inst.id,
        patientId,
        studentId,
        programId: prog.id,
        supervisorUserId,
        status: "IN_TREATMENT",
      },
      select: { id: true },
    });
  }

  const c1 = await caso(p1.id, s1.id, docA.id);
  const c2 = await caso(p2.id, s2.id, docB.id);
  const c3 = await caso(p1.id, s3.id, docA.id);

  /**
   * Una nota + su autorización YA DECIDIDA. El hash se calcula sobre el
   * MISMO contenido que se guarda, así que la fila sale APPROVED de verdad
   * (y no EXPIRED por un hash que no cuadra).
   */
  async function decidida(args: {
    caseId: string;
    patientId: string;
    studentId: string;
    authorUserId: string;
    decidedById: string | null;
    status: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
    diagnostico: string;
    decidedAt: Date | null;
    requestedAt: Date;
  }) {
    const rec = await prisma.eduRecord.create({
      data: {
        institutionId: inst.id,
        caseId: args.caseId,
        patientId: args.patientId,
        studentId: args.studentId,
        authorUserId: args.authorUserId,
        subjetivo: "Dolor espontáneo desde hace tres noches.",
        plan: "Endodoncia en dos sesiones.",
        diagnostico: args.diagnostico,
      },
      select: { id: true },
    });
    const hash = eduApprovalHash({
      kind: "EduRecord",
      subjetivo: "Dolor espontáneo desde hace tres noches.",
      objetivo: null,
      analisis: null,
      plan: "Endodoncia en dos sesiones.",
      diagnostico: args.diagnostico,
    });
    return prisma.eduCaseApproval.create({
      data: {
        institutionId: inst.id,
        caseId: args.caseId,
        stage: "PLAN",
        targetType: "EduRecord",
        targetId: rec.id,
        contentHash: hash,
        status: args.status,
        requestedById: args.authorUserId,
        requestedAt: args.requestedAt,
        decidedById: args.decidedById,
        decidedAt: args.decidedAt,
        decisionNote: args.decidedById ? "Queda claro." : "La sustituyó un reenvío.",
      },
      select: { id: true },
    });
  }

  // c1 (alumno de A) — firmada por el docente A, hoy.
  await decidida({
    caseId: c1.id,
    patientId: p1.id,
    studentId: s1.id,
    authorUserId: s1.userId,
    decidedById: docA.id,
    status: "APPROVED",
    diagnostico: "Necrosis pulpar 26",
    requestedAt: new Date(AHORA.getTime() - 3 * 3600 * 1000),
    decidedAt: new Date(AHORA.getTime() - 2 * 3600 * 1000),
  });

  // c1 — una que NADIE decidió (la cerró un reenvío). Es VIEJA: si el orden
  // pusiera los NULL primero, encabezaría el historial.
  await decidida({
    caseId: c1.id,
    patientId: p1.id,
    studentId: s1.id,
    authorUserId: s1.userId,
    decidedById: null,
    status: "CHANGES_REQUESTED",
    diagnostico: "Borrador viejo",
    requestedAt: new Date("2026-01-10T15:00:00.000Z"),
    decidedAt: null,
  });

  // c1 — una PENDIENTE. NO puede salir en el historial.
  {
    const rec = await prisma.eduRecord.create({
      data: {
        institutionId: inst.id,
        caseId: c1.id,
        patientId: p1.id,
        studentId: s1.id,
        authorUserId: s1.userId,
        diagnostico: "Esperando firma",
      },
      select: { id: true },
    });
    await prisma.eduCaseApproval.create({
      data: {
        institutionId: inst.id,
        caseId: c1.id,
        stage: "DISCHARGE",
        targetType: "EduRecord",
        targetId: rec.id,
        contentHash: "0".repeat(64),
        status: "PENDING",
        requestedById: s1.userId,
      },
    });
  }

  // c2 (alumno de B) — rechazada por el docente B.
  await decidida({
    caseId: c2.id,
    patientId: p2.id,
    studentId: s2.id,
    authorUserId: s2.userId,
    decidedById: docB.id,
    status: "REJECTED",
    diagnostico: "Plan sin radiografía",
    requestedAt: new Date(AHORA.getTime() - 5 * 3600 * 1000),
    decidedAt: new Date(AHORA.getTime() - 4 * 3600 * 1000),
  });

  // c3 (alumno que A ENTREGÓ) — firmada en su día.
  await decidida({
    caseId: c3.id,
    patientId: p1.id,
    studentId: s3.id,
    authorUserId: s3.userId,
    decidedById: docA.id,
    status: "APPROVED",
    diagnostico: "Caso entregado",
    requestedAt: new Date("2026-02-01T15:00:00.000Z"),
    decidedAt: new Date("2026-02-01T16:00:00.000Z"),
  });

  // La AUTOFIRMA de la dirección: la pidió y la firmó ella misma. Es la que
  // tiene que salir MARCADA como petición propia.
  await decidida({
    caseId: c1.id,
    patientId: p1.id,
    studentId: s1.id,
    authorUserId: dir.id,
    decidedById: dir.id,
    status: "APPROVED",
    diagnostico: "Autofirma de dirección",
    requestedAt: new Date(AHORA.getTime() - 90 * 60 * 1000),
    decidedAt: new Date(AHORA.getTime() - 60 * 60 * 1000),
  });

  return {
    id: inst.id,
    programId: prog.id,
    cohortId: coh.id,
    direccionId: dir.id,
    docenteA: docA.id,
    docenteB: docB.id,
    s1,
    s2,
    s3,
    caso1: c1.id,
    caso2: c2.id,
    caso3: c3.id,
    paciente1: p1.id,
    paciente2: p2.id,
  };
}

before(async () => {
  if (!HAS_DB) return;
  escuelas.a = await sembrar("aa");
  escuelas.b = await sembrar("bb");
});

after(async () => {
  if (!HAS_DB) return;
  // Cascada desde el instituto: se lleva usuarios, alumnos, casos y firmas.
  await prisma.eduInstitution.deleteMany({ where: { slug: { startsWith: `${RUN}-` } } });
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════════════
// 1 · DIRECCIÓN — todo el instituto, y NADA del de al lado
// ═════════════════════════════════════════════════════════════════════

test("🔴 DIRECCION ve todo lo decidido de SU instituto y ni una fila del otro", { skip }, async () => {
  const a = escuelas.a;
  const b = escuelas.b;
  const page = await listEduApprovalHistory(
    ctx(a.id, "DIRECCION", a.direccionId),
    filtros(),
    TZ,
  );

  // Las cinco decididas de la escuela A (dos de c1 + autofirma + c2 + c3).
  assert.equal(page.rows.length, 5);
  assert.equal(page.truncated, false);

  // Ni un id del otro instituto, por ningún camino: ni caso, ni paciente,
  // ni estudiante.
  const idsB = new Set([b.caso1, b.caso2, b.caso3, b.paciente1, b.paciente2, b.s1.id, b.s2.id]);
  for (const r of page.rows) {
    assert.ok(!idsB.has(r.caseId), "se coló un caso del otro instituto");
    assert.ok(!idsB.has(r.patientId), "se coló un paciente del otro instituto");
    assert.ok(!idsB.has(r.studentId), "se coló un estudiante del otro instituto");
  }
});

test("🔴 NINGUNA fila del historial está PENDIENTE", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(ctx(a.id, "DIRECCION", a.direccionId), filtros(), TZ);
  for (const r of page.rows) {
    assert.notEqual(r.status, "PENDING");
    assert.notEqual(r.storedStatus, "PENDING");
  }
  // Y la pendiente que sembramos SÍ existe: la prueba no pasa por vacío.
  const pendientes = await prisma.eduCaseApproval.count({
    where: { institutionId: a.id, status: "PENDING" },
  });
  assert.equal(pendientes, 1);
});

test("🔴 lo que NADIE decidió no encabeza la lista", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(ctx(a.id, "DIRECCION", a.direccionId), filtros(), TZ);
  // La primera es de HOY, no la de enero que quedó sin decidir. En Postgres
  // un `ORDER BY decidedAt DESC` habría puesto esa arriba del todo.
  assert.ok(page.rows[0].decidedAt, "el historial empieza por una que nadie decidió");
  const sinDecidir = page.rows.findIndex((r) => r.decidedAt === null);
  assert.ok(sinDecidir > 0, "no se sembró la fila sin decidir, o se perdió");

  // Y el orden es descendente por el sello que se PINTA.
  const sellos = page.rows.map((r) => r.decidedAt ?? r.requestedAt);
  const ordenado = [...sellos].sort().reverse();
  assert.deepEqual(sellos, ordenado);
});

test("la AUTOFIRMA de dirección sale MARCADA como petición propia", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(ctx(a.id, "DIRECCION", a.direccionId), filtros(), TZ);
  const propias = page.rows.filter((r) => r.selfDecided);
  assert.equal(propias.length, 1);
  assert.equal(propias[0].summary.title, "Autofirma de dirección");
  // Y la marca viaja para TODOS los que la miran, no solo para quien firmó:
  // el docente A también la ve (el caso es de su alumno vigente).
  const delDocente = await listEduApprovalHistory(ctx(a.id, "DOCENTE", a.docenteA), filtros(), TZ);
  assert.equal(delDocente.rows.filter((r) => r.selfDecided).length, 1);
});

// ═════════════════════════════════════════════════════════════════════
// 2 · 🔴 DOCENTE — sus alumnos VIGENTES, y nada más
// ═════════════════════════════════════════════════════════════════════

test("🔴 el DOCENTE A no ve nada de los alumnos del DOCENTE B", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(ctx(a.id, "DOCENTE", a.docenteA), filtros(), TZ);

  assert.ok(page.rows.length > 0, "el docente A se quedó sin ver lo suyo");
  for (const r of page.rows) {
    assert.notEqual(r.studentId, a.s2.id, "el docente A vio lo del alumno del docente B");
    assert.notEqual(r.caseId, a.caso2);
  }
  // Y el paciente del alumno de B tampoco viaja.
  assert.ok(!page.rows.some((r) => r.patientId === a.paciente2));

  // Simétrico: B no ve lo de A. Si el recorte se hubiera caído, los dos
  // verían las cinco.
  const deB = await listEduApprovalHistory(ctx(a.id, "DOCENTE", a.docenteB), filtros(), TZ);
  assert.ok(deB.rows.length > 0);
  for (const r of deB.rows) assert.notEqual(r.studentId, a.s1.id);
});

test("🔴 una asignación TERMINADA deja de dar acceso (el alumno entregado)", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(ctx(a.id, "DOCENTE", a.docenteA), filtros(), TZ);
  // s3 fue de A y A firmó su plan en febrero; su asignación terminó ayer.
  assert.ok(
    !page.rows.some((r) => r.studentId === a.s3.id),
    "un docente que ya rotó sigue leyendo lo del alumno que entregó",
  );
  // Y la fila existe: la dirección sí la ve.
  const dir = await listEduApprovalHistory(ctx(a.id, "DIRECCION", a.direccionId), filtros(), TZ);
  assert.ok(dir.rows.some((r) => r.studentId === a.s3.id));
});

test("🔴 ?estudiante=<de otro docente> devuelve VACÍO, no un error con pista", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(
    ctx(a.id, "DOCENTE", a.docenteA),
    // El id de un alumno REAL, del docente B, tecleado en la URL.
    filtros({ studentId: a.s2.id }),
    TZ,
  );
  assert.deepEqual(page.rows, []);
  assert.equal(page.truncated, false);

  // Y con el suyo sí devuelve: el filtro FUNCIONA, no está roto de fábrica.
  const propio = await listEduApprovalHistory(
    ctx(a.id, "DOCENTE", a.docenteA),
    filtros({ studentId: a.s1.id }),
    TZ,
  );
  assert.ok(propio.rows.length > 0);
  for (const r of propio.rows) assert.equal(r.studentId, a.s1.id);
});

test("🔴 ?estudiante= de OTRO INSTITUTO también devuelve vacío", { skip }, async () => {
  const a = escuelas.a;
  const b = escuelas.b;
  for (const rol of [
    ctx(a.id, "DIRECCION", a.direccionId),
    ctx(a.id, "DOCENTE", a.docenteA),
  ]) {
    const page = await listEduApprovalHistory(rol, filtros({ studentId: b.s1.id }), TZ);
    assert.deepEqual(page.rows, [], "un id de otra escuela devolvió filas");
  }
});

// ═════════════════════════════════════════════════════════════════════
// 3 · 🔴 ALUMNO — lo suyo, y nada más
// ═════════════════════════════════════════════════════════════════════

test("🔴 el ALUMNO solo ve lo de SUS casos", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(ctx(a.id, "ALUMNO", a.s1.userId), filtros(), TZ);

  assert.ok(page.rows.length > 0, "el alumno se quedó sin ver lo suyo");
  for (const r of page.rows) {
    assert.equal(r.studentId, a.s1.id);
    assert.equal(r.caseId, a.caso1);
  }
  // Incluida la autofirma de dirección sobre SU caso: es su expediente.
  assert.ok(page.rows.some((r) => r.selfDecided));
});

test("🔴 el ALUMNO con ?estudiante=<otro> sigue viendo solo lo suyo (vacío)", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(
    ctx(a.id, "ALUMNO", a.s1.userId),
    filtros({ studentId: a.s2.id }),
    TZ,
  );
  assert.deepEqual(page.rows, []);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · 🔴 CAJA — ni una fila, con la key encendida o apagada
// ═════════════════════════════════════════════════════════════════════

test("🔴 CAJA no obtiene NI UNA fila (el alcance no vive en la key)", { skip }, async () => {
  const a = escuelas.a;
  const cajaUser = await usuario(a.id, `aa-caja-${Date.now().toString(36)}`, "CAJA", "Caja");
  const page = await listEduApprovalHistory(ctx(a.id, "CAJA", cajaUser.id), filtros(), TZ);
  assert.deepEqual(page.rows, []);
  assert.equal(page.truncated, false);

  // Y su desplegable de estudiantes también sale vacío.
  assert.deepEqual(await listEduApprovalHistoryStudents(ctx(a.id, "CAJA", cajaUser.id)), []);
});

// ═════════════════════════════════════════════════════════════════════
// 5 · 🔴 LAS OPCIONES DE LOS FILTROS TAMBIÉN SON DATOS (P1-4)
// ═════════════════════════════════════════════════════════════════════

test("🔴 el desplegable de estudiantes está recortado por el MISMO alcance", { skip }, async () => {
  const a = escuelas.a;

  const dir = await listEduApprovalHistoryStudents(ctx(a.id, "DIRECCION", a.direccionId));
  const idsDir = dir.map((x) => x.id).sort();
  assert.deepEqual(idsDir, [a.s1.id, a.s2.id, a.s3.id].sort());

  // El docente A: SOLO su alumno vigente. Ni el de B, ni el que entregó.
  const docA = await listEduApprovalHistoryStudents(ctx(a.id, "DOCENTE", a.docenteA));
  assert.deepEqual(docA.map((x) => x.id), [a.s1.id]);

  // El alumno: NINGUNA lista. No le viaja ni un nombre de su generación.
  assert.deepEqual(await listEduApprovalHistoryStudents(ctx(a.id, "ALUMNO", a.s1.userId)), []);

  // Y nada de la otra escuela, en ninguno de los tres.
  const b = escuelas.b;
  const ajenos = new Set([b.s1.id, b.s2.id, b.s3.id]);
  for (const lista of [dir, docA]) {
    for (const x of lista) assert.ok(!ajenos.has(x.id));
  }
});

// ═════════════════════════════════════════════════════════════════════
// 6 · LOS FILTROS, contra datos de verdad
// ═════════════════════════════════════════════════════════════════════

test("filtrar por ESTADO, por ETAPA y por ESPECIALIDAD", { skip }, async () => {
  const a = escuelas.a;
  const dir = ctx(a.id, "DIRECCION", a.direccionId);

  const rechazadas = await listEduApprovalHistory(dir, filtros({ status: "REJECTED" }), TZ);
  assert.equal(rechazadas.rows.length, 1);
  assert.equal(rechazadas.rows[0].caseId, a.caso2);

  const altas = await listEduApprovalHistory(dir, filtros({ stage: "DISCHARGE" }), TZ);
  // La única DISCHARGE sembrada está PENDIENTE: el historial no la trae.
  assert.deepEqual(altas.rows, []);

  const deLaEspecialidad = await listEduApprovalHistory(
    dir,
    filtros({ programId: a.programId }),
    TZ,
  );
  assert.equal(deLaEspecialidad.rows.length, 5);

  // Y con la especialidad de la OTRA escuela: vacío.
  const otra = await listEduApprovalHistory(
    dir,
    filtros({ programId: escuelas.b.programId }),
    TZ,
  );
  assert.deepEqual(otra.rows, []);
});

test("filtrar por QUIÉN DECIDIÓ, y «las que decidí yo»", { skip }, async () => {
  const a = escuelas.a;

  const porDocenteA = await listEduApprovalHistory(
    ctx(a.id, "DIRECCION", a.direccionId),
    filtros({ decidedByUserId: a.docenteA }),
    TZ,
  );
  assert.equal(porDocenteA.rows.length, 2); // la de s1 y la de s3
  for (const r of porDocenteA.rows) assert.ok(r.decidedByName?.startsWith("Alberto"));

  // «Las mías» del docente A: las mismas dos, pero sin teclear su id — sale
  // de la sesión.
  const mias = await listEduApprovalHistory(
    ctx(a.id, "DOCENTE", a.docenteA),
    filtros({ soloMias: true }),
    TZ,
  );
  // Solo UNA: la del alumno que entregó ya no la alcanza (el alcance manda
  // sobre el filtro, no al revés).
  assert.equal(mias.rows.length, 1);
  assert.equal(mias.rows[0].studentId, a.s1.id);

  // Y «mías» de un ALUMNO, que no decide nada: vacío, sin error.
  const deAlumno = await listEduApprovalHistory(
    ctx(a.id, "ALUMNO", a.s1.userId),
    filtros({ soloMias: true }),
    TZ,
  );
  assert.deepEqual(deAlumno.rows, []);
});

test("buscar por PACIENTE encuentra sin acentos, y por FOLIO", { skip }, async () => {
  const a = escuelas.a;
  const dir = ctx(a.id, "DIRECCION", a.direccionId);

  // Sin acento y en minúsculas: tiene que encontrar a "María Elena Rodríguez".
  const sinAcento = await listEduApprovalHistory(dir, filtros({ q: "rodriguez" }), TZ);
  assert.ok(sinAcento.rows.length > 0);
  for (const r of sinAcento.rows) assert.equal(r.patientId, a.paciente1);

  // Por folio.
  const porFolio = await listEduApprovalHistory(dir, filtros({ q: "AA-P2" }), TZ);
  assert.equal(porFolio.rows.length, 1);
  assert.equal(porFolio.rows[0].patientId, a.paciente2);

  // 🔴 Un comodín de LIKE no es un comodín: Prisma NO escapa el `contains`,
  // así que el término se limpia antes de tocar la base. Tecleando SOLO
  // comodines no queda ni un término y se comporta como "sin buscador" —
  // lo que NUNCA hace es ampliar el alcance.
  const docente = ctx(a.id, "DOCENTE", a.docenteA);
  const comodin = await listEduApprovalHistory(docente, filtros({ q: "%%%" }), TZ);
  const sinBuscar = await listEduApprovalHistory(docente, filtros(), TZ);
  assert.deepEqual(
    comodin.rows.map((r) => r.id),
    sinBuscar.rows.map((r) => r.id),
  );
  assert.ok(!comodin.rows.some((r) => r.studentId === a.s2.id));

  // Y el texto que acompaña al comodín SÍ busca: se cae el `%`, no la
  // palabra.
  const conBasura = await listEduApprovalHistory(dir, filtros({ q: "rodri%" }), TZ);
  assert.ok(conBasura.rows.length > 0);
  for (const r of conBasura.rows) assert.equal(r.patientId, a.paciente1);
});

test("el rango de fechas acota por la DECISIÓN", { skip }, async () => {
  const a = escuelas.a;
  const dir = ctx(a.id, "DIRECCION", a.direccionId);

  // El 1 de febrero de 2026 se decidió exactamente una (la del alumno que
  // luego se entregó).
  const feb = await listEduApprovalHistory(
    dir,
    filtros({ desdeISO: "2026-02-01", hastaISO: "2026-02-01" }),
    TZ,
  );
  assert.equal(feb.rows.length, 1);
  assert.equal(feb.rows[0].studentId, a.s3.id);

  // Un día sin decisiones: vacío. Y las que nadie decidió tampoco se cuelan
  // en un rango de fechas de decisión.
  const vacio = await listEduApprovalHistory(
    dir,
    filtros({ desdeISO: "2026-02-02", hastaISO: "2026-02-02" }),
    TZ,
  );
  assert.deepEqual(vacio.rows, []);
});

// ═════════════════════════════════════════════════════════════════════
// 7 · EL CONTENIDO DE LA FILA
// ═════════════════════════════════════════════════════════════════════

test("la fila trae lo que la pantalla pinta, y el enlace al caso", { skip }, async () => {
  const a = escuelas.a;
  const page = await listEduApprovalHistory(ctx(a.id, "DIRECCION", a.direccionId), filtros(), TZ);
  const r = page.rows.find((x) => x.summary.title === "Necrosis pulpar 26");
  assert.ok(r, "no salió la fila firmada por el docente A");

  assert.equal(r.stage, "PLAN");
  assert.equal(r.status, "APPROVED");
  assert.equal(r.patientFolio, "AA-P1");
  assert.equal(r.patientName, "María Elena Rodríguez");
  assert.equal(r.studentMatricula, "AA-1");
  assert.ok(r.programName.startsWith("Endodoncia"));
  assert.ok(r.requestedByName.startsWith("Alumno1"));
  assert.ok(r.decidedByName?.startsWith("Alberto"));
  assert.ok(r.requestedAtLabel.length > 0);
  assert.ok(r.decidedAtLabel && r.decidedAtLabel.length > 0);
  assert.equal(r.decisionNote, "Queda claro.");
  assert.equal(r.isEmergency, false);
  assert.equal(r.selfDecided, false);
  // El enlace al caso y al paciente.
  assert.equal(r.caseId, a.caso1);
  assert.equal(r.patientId, a.paciente1);

  // El historial NO manda el texto completo de la nota: solo el título. Los
  // cinco campos de 300 filas serían megabytes de JSON para algo que esta
  // pantalla no enseña.
  assert.deepEqual(r.summary.lines, []);
});

test("una firma cuyo texto se EDITÓ después sale como vencida", { skip }, async () => {
  const a = escuelas.a;
  const antes = await listEduApprovalHistory(ctx(a.id, "DIRECCION", a.direccionId), filtros(), TZ);
  const fila = antes.rows.find((x) => x.summary.title === "Necrosis pulpar 26");
  assert.ok(fila);
  assert.equal(fila.status, "APPROVED");

  // El alumno edita la nota DESPUÉS de que se firmó.
  await prisma.eduRecord.update({
    where: { id: fila.targetId },
    data: { plan: "Ahora dice otra cosa." },
  });

  const despues = await listEduApprovalHistory(
    ctx(a.id, "DIRECCION", a.direccionId),
    filtros(),
    TZ,
  );
  const igual = despues.rows.find((x) => x.id === fila.id);
  assert.ok(igual);
  assert.equal(igual.status, "EXPIRED");
  // Y quedó ESCRITO en la columna: no vive solo en la pantalla que lo
  // calculó. La ficha del caso dirá lo mismo.
  const enBase = await prisma.eduCaseApproval.findUnique({
    where: { id: fila.id },
    select: { status: true },
  });
  assert.equal(enBase?.status, "EXPIRED");

  // Se deja como estaba para no ensuciar las demás pruebas del archivo.
  await prisma.eduRecord.update({
    where: { id: fila.targetId },
    data: { plan: "Endodoncia en dos sesiones." },
  });
  await prisma.eduCaseApproval.update({
    where: { id: fila.id },
    data: { status: "APPROVED" },
  });
});
