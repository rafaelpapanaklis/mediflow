/**
 * LOS CUATRO HALLAZGOS GRAVES DE LA AUDITORÍA (docs/audits/EDU_AUDIT.md).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-auditoria.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO MIRA EL CÓDIGO FUENTE Y NO SOLO LAS FUNCIONES
 *
 * La auditoría dejó una frase que vale más que los cuatro hallazgos:
 * ninguno de ellos habría puesto roja la suite, y por una razón que se
 * puede nombrar. Las 516 pruebas del vertical comprueban los módulos PUROS
 * (`visibility.ts`, `*-core.ts`) y ahí no había nada roto. Lo que fallaba
 * estaba en la capa que CONSUME esos módulos:
 *
 *   · P0-1 — un `findMany` que se olvidó de llamar al helper;
 *   · P0-2 — un cliente que nunca mandaba un campo opcional;
 *   · P1-3 — un `update` que no revalidaba;
 *   · P1-4 — un `page.tsx` que le mandó al navegador lo que el helper
 *     habría recortado.
 *
 * Un `where` correcto que nadie llama es exactamente igual de inseguro que
 * uno equivocado. Así que la mitad de este archivo comprueba lo puro (que
 * es lo que se puede comprobar sin base de datos) y la otra mitad LEE LOS
 * ARCHIVOS y comprueba que la llamada esté puesta — el mismo truco que ya
 * usa `edu-caja.test.ts` para que ningún endpoint lea el institutionId de
 * un body.
 *
 * Los comentarios se quitan antes de buscar: este arreglo está documentado
 * en el propio código y no vale acusar —ni absolver— a un archivo por lo
 * que dice su prosa.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduStudentScopeWhere,
  eduVisibility,
} from "../visibility";
import { eduCaseFitsAppointment } from "../agenda-core";
import { eduPadronScope } from "../padron-core";
import type { EduRole } from "../types";

const INST = "inst_1";
const AHORA = new Date("2026-08-31T15:00:00.000Z");

const SALIENTE = "u_alumno_sale";
const ENTRANTE = "u_alumno_entra";

function actor(role: EduRole, eduUserId: string) {
  return { role, eduUserId };
}

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** El archivo, sin comentarios: se juzga por lo que hace, no por lo que dice. */
function fuente(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** El cuerpo de UNA función exportada, para no acusar al archivo entero. */
function cuerpoDe(src: string, nombre: string): string {
  const desde = src.indexOf(`export async function ${nombre}`);
  assert.notEqual(desde, -1, `no se encontró ${nombre}: ¿la renombraron?`);
  const siguiente = src.indexOf("\nexport ", desde + 1);
  return src.slice(desde, siguiente === -1 ? undefined : siguiente);
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

// ═════════════════════════════════════════════════════════════════════
// P0-1 · UN ALUMNO NO VE LAS CALIFICACIONES DE SUS COMPAÑEROS
//
// `GET /api/instituto/calificaciones?alumno=<id de un compañero>` leía por
// `studentId` crudo y devolvía la evaluación entera del otro: cada
// criterio con su comentario, quién calificó y —lo que de verdad duele—
// el NOMBRE y el FOLIO de los pacientes que atendió.
// ═════════════════════════════════════════════════════════════════════

test("🔴 P0-1 · un ALUMNO que pide el id de OTRO no puede alcanzar ni una fila", () => {
  const scope = eduVisibility(actor("ALUMNO", SALIENTE), "cases");
  // Es literalmente el `where` que arma listEduStudentGrades: el alcance
  // primero, el id de fuera después.
  const where = { ...eduStudentScopeWhere({ institutionId: INST, scope, now: AHORA }), id: "st_otro" };

  assert.deepEqual(where, { institutionId: INST, userId: SALIENTE, id: "st_otro" });
  // Postgres tiene que buscar una fila que sea a la vez la del compañero Y
  // la del que pregunta. No existe: contesta cero filas, que desde fuera se
  // ve igual que "ese alumno no existe" — que es lo que debe verse.
  assert.equal(
    (where as { userId?: string }).userId,
    SALIENTE,
    "sin el userId del que pregunta, el id de fuera manda solo",
  );
});

test("🔴 P0-1 · listEduStudentGrades resuelve al alumno DENTRO del alcance", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "rubricas.ts"), "listEduStudentGrades");

  assert.match(
    cuerpo,
    /eduStudentScopeWhere\(\{\s*institutionId,\s*scope,\s*now\s*\}\)/,
    "la lectura por alumno tiene que pasar por el helper de visibility.ts",
  );
  assert.match(cuerpo, /eduScopeIsEmpty\(scope\)/, "CAJA (alcance 'none') no evalúa a nadie");
  // Y la consulta de calificaciones cuelga del alumno YA resuelto, no del
  // id que llegó por la query.
  assert.match(cuerpo, /studentId:\s*alumno\.id/);
  assert.equal(
    /where:\s*\{\s*institutionId,\s*studentId:\s*id\s*\}/.test(cuerpo),
    false,
    "volvió el `where` sin recorte: éste es exactamente el P0-1",
  );
});

test("P0-1 · el reparto por rol del alcance con el que se leen las calificaciones", () => {
  // El recurso es "cases" — el mismo con el que se leen las notas de un
  // caso. ALUMNO lo suyo, DOCENTE lo de sus alumnos vigentes, DIRECCION
  // todo, CAJA nada: cobrar no es evaluar.
  assert.deepEqual(eduVisibility(actor("ALUMNO", "u_a"), "cases"), {
    kind: "own",
    studentUserId: "u_a",
  });
  assert.deepEqual(eduVisibility(actor("DOCENTE", "u_d"), "cases"), {
    kind: "supervised",
    supervisorUserId: "u_d",
  });
  assert.deepEqual(eduVisibility(actor("DIRECCION", "u_x"), "cases"), { kind: "all" });
  assert.deepEqual(eduVisibility(actor("CAJA", "u_c"), "cases"), { kind: "none" });

  const docente = eduStudentScopeWhere({
    institutionId: INST,
    scope: eduVisibility(actor("DOCENTE", "u_d"), "cases"),
    now: AHORA,
  });
  // Y la vigencia va puesta: un docente que ya rotó NO lee las
  // calificaciones de los alumnos que entregó.
  assert.deepEqual(valoresDe(docente, "startsAt"), [{ lte: AHORA }]);
  assert.deepEqual(valoresDe(docente, "endsAt"), [null, { gt: AHORA }]);
});

// ═════════════════════════════════════════════════════════════════════
// P0-2 · EL TRASPASO SÍ QUITA LA LLAVE DEL PACIENTE
//
// Las dos direcciones, que es como se comprueba un traspaso: el saliente
// PIERDE el acceso y el entrante lo GANA.
// ═════════════════════════════════════════════════════════════════════

test("🔴 P0-2 · el SALIENTE pierde al paciente aunque su cita esté suelta", () => {
  const scope = eduVisibility(actor("ALUMNO", SALIENTE), "patients");
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA }) as {
    OR?: Record<string, any>[];
  };

  const ramaCitas = where.OR?.[1];
  assert.ok(ramaCitas && "appointments" in ramaCitas, "falta la rama de las citas");

  // La cita de TAMIZAJE (anterior al caso) sigue contando: es la razón de
  // que esta rama exista y quitarla dejaría sin ficha a quien valora.
  assert.deepEqual(ramaCitas.appointments.some.OR, [
    { caseId: null },
    { case: { status: { not: "TRANSFERRED" } } },
  ]);

  // 🔴 Y el candado nuevo: una cita suelta NO abre la ficha de un paciente
  // cuyo caso este alumno entregó. Sin esta línea, `{ caseId: null }` es
  // una puerta abierta — y antes de este arreglo las citas sueltas eran
  // casi todas.
  assert.deepEqual(
    ramaCitas.cases,
    { none: { institutionId: INST, student: { institutionId: INST, userId: SALIENTE }, status: "TRANSFERRED" } },
    "el saliente conserva la llave del paciente que entregó",
  );
});

test("🔴 P0-2 · el ENTRANTE gana al paciente sin ninguna regla nueva", () => {
  const scope = eduVisibility(actor("ALUMNO", ENTRANTE), "patients");
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA }) as {
    OR?: Record<string, any>[];
  };

  // El caso nuevo nace ASSIGNED, así que la primera rama lo encuentra: el
  // único estado que quita el acceso es TRANSFERRED.
  assert.deepEqual(where.OR?.[0].cases.some.status, { not: "TRANSFERRED" });
  assert.deepEqual(where.OR?.[0].cases.some.student, { institutionId: INST, userId: ENTRANTE });

  // Y el candado del saliente no le estorba: el caso que el OTRO entregó no
  // es suyo, así que su `none` no lo encuentra.
  assert.deepEqual(valoresDe(where, "userId"), [ENTRANTE, ENTRANTE, ENTRANTE]);
  assert.equal(
    JSON.stringify(where).includes(SALIENTE),
    false,
    "el alumno que entra no puede heredar nada del que salió",
  );
});

test("P0-2 · DIRECCIÓN y CAJA no pierden nada (su `where` sigue siendo solo el tenant)", () => {
  for (const rol of ["DIRECCION", "CAJA"] as EduRole[]) {
    const scope = eduVisibility(actor(rol, "u_x"), "patients");
    assert.deepEqual(eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA }), {
      institutionId: INST,
    });
  }
});

test("P0-2 · el candado NO se cuela ni en la lista de casos ni en la agenda", () => {
  // Es la asimetría deliberada de la Ola 6, y este arreglo no la toca: el
  // saliente conserva el CASO (su historia académica) y sus CITAS PASADAS
  // (ocurrieron, y son su registro de asistencia). Lo que pierde es el
  // expediente vivo del paciente.
  const casos = eduCaseScopeWhere({
    institutionId: INST,
    scope: eduVisibility(actor("ALUMNO", SALIENTE), "cases"),
    now: AHORA,
  });
  assert.equal(JSON.stringify(casos).includes("TRANSFERRED"), false);

  const citas = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: eduVisibility(actor("ALUMNO", SALIENTE), "appointments"),
    now: AHORA,
  });
  assert.equal(JSON.stringify(citas).includes("TRANSFERRED"), false);
});

test("🔴 P0-2 · agendar ENGANCHA la cita a su caso, y las dos escrituras usan la misma función", () => {
  const src = fuente("src", "lib", "edu", "agenda.ts");

  assert.match(src, /async function resolveAppointmentCaseId\(/, "falta la resolución del caso");
  // Definición + la llamada del alta + la llamada del reagendar.
  const usos = src.split("resolveAppointmentCaseId").length - 1;
  assert.ok(usos >= 3, `el caso se resuelve en ${usos} sitios: tienen que ser la función y sus dos llamadas`);

  assert.match(cuerpoDe(src, "createEduAppointment"), /resolveAppointmentCaseId\(/);
  assert.match(cuerpoDe(src, "updateEduAppointment"), /resolveAppointmentCaseId\(/);

  // La regla de dentro: el TAMIZAJE nace suelto (es anterior al caso) y
  // para el resto se busca el caso VIVO de ese paciente con ese alumno.
  const helper = src.slice(src.indexOf("async function resolveAppointmentCaseId"));
  assert.match(helper, /TAMIZAJE/);
  assert.match(helper, /EDU_CASE_CLOSED_STATUSES/);

  // Y el texto que defiende la invariante vive en UN solo sitio: dos copias
  // son dos sitios donde discrepar.
  assert.equal(
    src.split("Ese caso es de otro alumno.").length - 1,
    1,
    "la comprobación del dueño del caso está duplicada",
  );
});

test("🔴 P0-2 · el traspaso engancha las citas SUELTAS antes de mover las futuras", () => {
  const src = fuente("src", "lib", "edu", "traspasos.ts");

  const engancha = src.indexOf("studentId: caso.studentId");
  const mueve = src.indexOf('status: "SCHEDULED"');
  assert.notEqual(engancha, -1, "el traspaso ya no engancha las citas sueltas del saliente");
  assert.notEqual(mueve, -1, "el traspaso ya no mueve las citas futuras");
  assert.ok(
    engancha < mueve,
    "engancharlas DESPUÉS de mover las futuras dejaría al paciente citado con el alumno que se fue",
  );

  // Se enganchan a un caso que en este mismo instante quedó TRANSFERRED, y
  // solo las del MISMO paciente y el MISMO alumno. Desde la ola de cierre
  // el enganche es una función COMPARTIDA con createEduCase
  // (eduAttachLooseAppointments, casos.ts): la misma regla corre al abrir
  // un caso sobre citas ya agendadas y al traspasar — dos copias del mismo
  // updateMany habrían filtrado distinto tarde o temprano.
  assert.match(
    src,
    /eduAttachLooseAppointments\(tx,\s*\{\s*institutionId,\s*patientId:\s*caso\.patientId,\s*studentId:\s*caso\.studentId,/,
  );
  assert.match(src, /includeTamizaje:\s*true/);
  assert.match(
    fuente("src", "lib", "edu", "casos.ts"),
    /caseId:\s*null,?\s*\.\.\.\(args\.includeTamizaje/,
    "la función compartida solo toca citas SUELTAS (caseId null)",
  );
  assert.match(src, /data:\s*\{\s*status:\s*"TRANSFERRED"/);
});

// ═════════════════════════════════════════════════════════════════════
// P1-3 · REAGENDAR NO DEJA LA CITA COLGADA DEL CASO DE OTRO ALUMNO
// ═════════════════════════════════════════════════════════════════════

test("🔴 P1-3 · un caso solo encaja en una cita del MISMO paciente y el MISMO alumno", () => {
  const cita = { patientId: "p_1", studentId: "st_a" };

  assert.equal(eduCaseFitsAppointment({ patientId: "p_1", studentId: "st_a" }, cita), true);
  assert.equal(
    eduCaseFitsAppointment({ patientId: "p_1", studentId: "st_b" }, cita),
    false,
    "el caso de OTRO alumno: es exactamente el P1-3",
  );
  assert.equal(
    eduCaseFitsAppointment({ patientId: "p_2", studentId: "st_a" }, cita),
    false,
    "la cita de la señora colgada del caso del señor",
  );
  // Un caso ausente no "encaja": quien pregunta está decidiendo si engancha.
  assert.equal(eduCaseFitsAppointment(null, cita), false);
  assert.equal(eduCaseFitsAppointment(undefined, cita), false);
});

test("🔴 P1-3 · el PATCH revalida el caso cuando el alumno RESULTANTE cambia", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "agenda.ts"), "updateEduAppointment");

  // Se compara el alumno resultante contra el que había — y no la mera
  // presencia de `input.studentId`, que la pantalla manda siempre. Volver a
  // derivar en cada movimiento soltaría el caso de una cita cuyo caso ya se
  // cerró: reescribir el pasado por mover una hora.
  assert.match(cuerpo, /studentId\s*!==\s*current\.studentId/);
  assert.match(cuerpo, /resolveAppointmentCaseId\(/);
  assert.match(cuerpo, /data\.caseId\s*=\s*caseId/);
  // Y el `type` de la cita se lee de la fila para poder decidir lo del
  // tamizaje: si no estuviera en el select, el PATCH engancharía tamizajes.
  assert.match(cuerpo, /type:\s*true/);
});

// ═════════════════════════════════════════════════════════════════════
// P1-4 · EL PADRÓN NO VIAJA AL NAVEGADOR DE QUIEN NO LISTA ALUMNOS
// ═════════════════════════════════════════════════════════════════════

test("P1-4 · el alcance del padrón: ALUMNO ninguna fila, DOCENTE las suyas", () => {
  assert.deepEqual(eduPadronScope({ role: "ALUMNO", eduUserId: "u_a" }), { kind: "none" });
  assert.deepEqual(eduPadronScope({ role: "CAJA", eduUserId: "u_c" }), { kind: "none" });
  assert.deepEqual(eduPadronScope({ role: "DOCENTE", eduUserId: "u_d" }), {
    kind: "supervised",
    supervisorUserId: "u_d",
  });
  assert.deepEqual(eduPadronScope({ role: "DIRECCION", eduUserId: "u_x" }), { kind: "all" });
});

test("🔴 P1-4 · /instituto/agenda solo manda el padrón a quien administra la agenda", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "agenda", "page.tsx");
  assert.match(
    src,
    /canManage\s*\?\s*listEduStudentOptions\(/,
    "la lista de alumnos vuelve a viajar entera en el payload RSC",
  );
  // Sus dos vecinas ya lo hacían: la comprobación es que ahora son tres.
  assert.equal(
    src.split(/canManage\s*\?/).length - 1,
    3,
    "supervisores, pacientes y alumnos: los tres detrás del mismo permiso",
  );
});

test("🔴 P1-4 · la lista NOMINAL de asignaciones se recorta con el alcance del padrón", () => {
  for (const ruta of [
    ["src", "app", "instituto", "(panel)", "docentes", "page.tsx"],
    ["src", "app", "api", "instituto", "docentes", "route.ts"],
  ]) {
    const src = fuente(...ruta);
    const donde = ruta.join("/");
    assert.match(src, /eduPadronScope\(/, `${donde}: la lista nominal no pasa por el alcance`);
    assert.match(
      src,
      /listEduCurrentAssignments\([^)]*,\s*now,\s*alcance\.supervisorUserId\)/,
      `${donde}: al docente hay que acotarle la consulta a SUS asignaciones`,
    );
    assert.match(
      src,
      /alcance\.kind\s*===\s*"all"/,
      `${donde}: solo la dirección las lista todas`,
    );
  }
});

test("P1-4 · el CONTEO agregado por docente NO se toca (es para lo que existe la pantalla)", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "docentes", "page.tsx");
  assert.match(src, /listEduTeachers\(ctx,\s*now\)/, "el número de alumnos de hoy sigue siendo de todos");
});
