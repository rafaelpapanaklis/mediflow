/**
 * LA OLA DE CIERRE: lo que quedó suelto tras probar el producto con los
 * tres roles, y los P2/P3 de la auditoría (docs/audits/EDU_AUDIT.md).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-cierre.test.ts
 *
 * Mismo enfoque que edu-auditoria.test.ts, y por la misma razón: casi todo
 * lo que esta ola arregla vivía en la capa que CONSUME los módulos puros
 * (una función a la que nadie llamaba, un enganche que no corría cuando el
 * caso nacía después de la cita, un candado prometido que faltaba en dos
 * lecturas). Así que la mitad comprueba lo puro y la otra mitad LEE LOS
 * ARCHIVOS y comprueba que la llamada esté puesta. Los comentarios se
 * quitan antes de buscar: un archivo se juzga por lo que hace, no por lo
 * que dice su prosa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eduVisibility, eduStudentScopeWhere } from "../visibility";
import {
  EDU_CLINICAL_STATUS_EARLY_MS,
  eduClinicalStatusTooEarly,
} from "../agenda-core";
import {
  eduAtrasoVerdict,
  eduRequirementExpectedRaw,
  eduRequirementProgress,
  type EduRequirementSpec,
} from "../evaluacion-core";
import {
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  hasEduPermission,
} from "../permissions";
import { EDU_NAV_LABELS } from "../types";
import type { EduRole } from "../types";

const INST = "inst_1";
const AHORA = new Date("2026-08-31T15:00:00.000Z");

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

// ═════════════════════════════════════════════════════════════════════
// 1 · EL BUG DE PRODUCCIÓN: la cita agendada ANTES de abrir el caso se
//     quedaba con caseId null PARA SIEMPRE
//
// El orden normal es agendar → el paciente llega → el tamizaje abre el
// caso. El arreglo del P0-2 enganchaba al agendar, al reagendar y al
// traspasar — ninguno de los tres corre cuando el caso nace DESPUÉS.
// ═════════════════════════════════════════════════════════════════════

test("🔴 cierre-1 · createEduCase engancha las citas sueltas del par al abrir", () => {
  const src = fuente("src", "lib", "edu", "casos.ts");
  const cuerpo = cuerpoDe(src, "createEduCase");
  assert.match(
    cuerpo,
    /eduAttachLooseAppointments\(/,
    "abrir un caso tiene que recoger las citas que se agendaron antes que él",
  );
  assert.match(
    cuerpo,
    /includeTamizaje:\s*false/,
    "al abrir, el TAMIZAJE se queda fuera: es la valoración anterior al caso",
  );
  // Solo si el caso recién abierto es el ÚNICO vivo del par: con dos casos
  // vivos, adivinar mueve una sesión al expediente equivocado.
  assert.match(
    cuerpo,
    /notIn:\s*EDU_CASE_CLOSED_STATUSES/,
    "el enganche va condicionado a que no haya OTRO caso vivo del par",
  );
});

test("🔴 cierre-1 · el enganche es UNA función y el traspaso usa LA MISMA", () => {
  const casos = fuente("src", "lib", "edu", "casos.ts");
  assert.match(
    cuerpoDe(casos, "eduAttachLooseAppointments"),
    /caseId:\s*null/,
    "solo engancha citas SUELTAS: un enlace existente vale más que éste",
  );

  const traspasos = fuente("src", "lib", "edu", "traspasos.ts");
  assert.match(
    traspasos,
    /eduAttachLooseAppointments\(/,
    "el traspaso tiene que usar la MISMA función que el alta del caso",
  );
  assert.match(
    traspasos,
    /includeTamizaje:\s*true/,
    "en el traspaso entra todo: una cita suelta es una llave suelta igual",
  );
  assert.match(
    traspasos,
    /from\s+"@\/lib\/edu\/casos"/,
    "el enganche vive con el caso (casos.ts); dos copias filtrarían distinto",
  );
});

// ═════════════════════════════════════════════════════════════════════
// 2 · LA LISTA DE ALUMNOS YA NO VIAJA COMPLETA AL NAVEGADOR
//
// La decisión, tomada: un alumno se ve solo a sí mismo, un docente a sus
// alumnos vigentes, caja y dirección a todos. Y vive DENTRO de
// listEduStudentOptions, no en cada página.
// ═════════════════════════════════════════════════════════════════════

test("🔴 cierre-2 · listEduStudentOptions recorta con el helper de alcance", () => {
  const src = fuente("src", "lib", "edu", "agenda.ts");
  const cuerpo = cuerpoDe(src, "listEduStudentOptions");
  assert.match(
    cuerpo,
    /eduVisibility\(ctx,\s*"patients"\)/,
    "el recorte sale de eduVisibility, no de un if a mano",
  );
  assert.match(
    cuerpo,
    /eduStudentScopeWhere\(/,
    "el where lo arma el helper único de visibility.ts",
  );
});

test("cierre-2 · el reparto del recurso 'patients' es exactamente la decisión", () => {
  // ALUMNO → él mismo (el filtro 'lo trajo' le ofrece su única opción).
  const alumno = eduVisibility(actor("ALUMNO", "u_al"), "patients");
  assert.deepEqual(alumno, { kind: "own", studentUserId: "u_al" });
  assert.deepEqual(
    eduStudentScopeWhere({ institutionId: INST, scope: alumno, now: AHORA }),
    { institutionId: INST, userId: "u_al" },
  );
  // DOCENTE → sus alumnos VIGENTES.
  assert.equal(eduVisibility(actor("DOCENTE", "u_doc"), "patients").kind, "supervised");
  // CAJA y DIRECCION → todos (agendan y filtran).
  assert.equal(eduVisibility(actor("CAJA", "u_caja"), "patients").kind, "all");
  assert.equal(eduVisibility(actor("DIRECCION", "u_dir"), "patients").kind, "all");
});

// ═════════════════════════════════════════════════════════════════════
// 3 · "PADRÓN" SE LEE "ALUMNOS" (las rutas y las keys no se renombran)
// ═════════════════════════════════════════════════════════════════════

test("cierre-3 · el menú dice Alumnos y la ruta sigue siendo /instituto/padron", () => {
  assert.equal(EDU_NAV_LABELS.padron, "Alumnos");
  // El grupo de la pantalla de permisos tampoco dice "Padrón".
  const grupo = EDU_PERMISSION_GROUPS.find((g) => g.keys.includes("padron.view"));
  assert.ok(grupo, "padron.view tiene que seguir en un grupo");
  assert.ok(
    !/padr[oó]n/i.test(grupo.title),
    `el título del grupo se lee en la pantalla de permisos y decía: ${grupo.title}`,
  );
});

// ═════════════════════════════════════════════════════════════════════
// P2-7 · EL SEGUNDO CANDADO DEL DINERO EN EL TARIFARIO
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-7 · las lecturas con PRECIOS llevan el candado del alcance de charges", () => {
  const src = fuente("src", "lib", "edu", "tarifas.ts");
  for (const fn of ["listEduFeeSchedules", "getEduTarifario", "getEduTarifaDePaciente"]) {
    assert.match(
      cuerpoDe(src, fn),
      /eduVisibility\(ctx,\s*"charges"\)/,
      `${fn}: encenderle tarifarios.view a un alumno no puede enseñarle un peso`,
    );
  }
  // La lectura muerta sin candado se retiró: una función sin llamadores es
  // la puerta que la siguiente pantalla usa sin pasar por el candado.
  assert.ok(
    !src.includes("listEduProcedureOptions"),
    "listEduProcedureOptions no tenía llamadores ni candado: se retiró",
  );
});

// ═════════════════════════════════════════════════════════════════════
// P2-10 · DOS PETICIONES IDÉNTICAS SON UN SOLO COBRO
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-10 · createEduCharge es idempotente por clave del cliente", () => {
  const src = fuente("src", "lib", "edu", "caja.ts");
  const cuerpo = cuerpoDe(src, "createEduCharge");
  assert.match(cuerpo, /idempotencyKey/, "el POST acepta la clave");
  assert.match(
    cuerpo,
    /duplicado:\s*true/,
    "la repetida devuelve el cobro que YA existe, no emite otro",
  );
  // El respaldo es el índice único en la base: la carrera de dos POST
  // simultáneos la gana uno y el otro recibe el suyo.
  const schema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  assert.match(
    schema,
    /@@unique\(\[institutionId,\s*idempotencyKey\]/,
    "sin el índice único, la idempotencia es una carrera",
  );
});

test("P2-10 · el tope del pago se reclama DENTRO de la transacción", () => {
  // Pagos a meses movió el claim a eduApplyEduPaymentInTx — UNA función,
  // DOS llamadores (el pago suelto y la mensualidad de un plan) — para
  // que ninguno de los dos pueda recalcular distinto. La intención de
  // esta prueba no cambió: el updateMany condicional con decrement sigue
  // siendo lo que serializa dos pagos simultáneos, y addEduPayment tiene
  // que PASAR por él — el claim que nadie llama no serializa nada.
  const src = fuente("src", "lib", "edu", "caja.ts");
  assert.match(
    cuerpoDe(src, "eduApplyEduPaymentInTx"),
    /decrement/,
    "el updateMany condicional con decrement es lo que serializa dos pagos simultáneos",
  );
  assert.match(cuerpoDe(src, "addEduPayment"), /eduApplyEduPaymentInTx\(/);
});

// ═════════════════════════════════════════════════════════════════════
// P2-11 · EL FUTURO NO SE MARCA COMO OCURRIDO
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-11 · una cita de pasado mañana no se puede dar por COMPLETED hoy", () => {
  const enTresDias = new Date(AHORA.getTime() + 3 * 24 * 60 * 60 * 1000);
  assert.equal(eduClinicalStatusTooEarly("COMPLETED", enTresDias, AHORA), true);
  assert.equal(eduClinicalStatusTooEarly("CHECKED_IN", enTresDias, AHORA), true);
  assert.equal(eduClinicalStatusTooEarly("IN_CHAIR", enTresDias, AHORA), true);
});

test("P2-11 · lo legítimo pasa: llegar temprano, y cancelar el futuro", () => {
  // El paciente que llega dos horas antes se registra igual.
  const enDosHoras = new Date(AHORA.getTime() + 2 * 60 * 60 * 1000);
  assert.equal(eduClinicalStatusTooEarly("CHECKED_IN", enDosHoras, AHORA), false);
  // Justo en el borde de la ventana, todavía pasa.
  const alBorde = new Date(AHORA.getTime() + EDU_CLINICAL_STATUS_EARLY_MS);
  assert.equal(eduClinicalStatusTooEarly("CHECKED_IN", alBorde, AHORA), false);
  // Cancelar y "no llegó" son administrativos: cancelar el futuro es
  // exactamente para lo que existe cancelar.
  const enUnMes = new Date(AHORA.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(eduClinicalStatusTooEarly("CANCELLED", enUnMes, AHORA), false);
  assert.equal(eduClinicalStatusTooEarly("NO_SHOW", enUnMes, AHORA), false);
  // Una fecha basura no frena: mejor dejar pasar que romper el mostrador.
  assert.equal(eduClinicalStatusTooEarly("COMPLETED", "no-es-fecha", AHORA), false);
});

test("P2-11 · setEduAppointmentStatus llama al predicado", () => {
  const src = fuente("src", "lib", "edu", "agenda.ts");
  assert.match(
    cuerpoDe(src, "setEduAppointmentStatus"),
    /eduClinicalStatusTooEarly\(/,
    "el where correcto que nadie llama es igual de inseguro que uno equivocado",
  );
});

// ═════════════════════════════════════════════════════════════════════
// P2-12 · LOS DOS ENDPOINTS QUE CUESTAN DINERO LLEVAN FRENO POR SESIÓN
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-12 · dictado y análisis limitan por eduUserId, no por IP", () => {
  const dictado = fuente("src", "app", "api", "instituto", "ai", "dictado", "route.ts");
  assert.match(dictado, /rateLimitKey\(`edu-ia-dictado:\$\{g\.ctx\.eduUserId\}`/);
  const analisis = fuente(
    "src", "app", "api", "instituto", "estudios", "[id]", "analisis", "route.ts",
  );
  assert.match(analisis, /rateLimitKey\(`edu-ia-analisis:\$\{g\.ctx\.eduUserId\}`/);
});

// ═════════════════════════════════════════════════════════════════════
// P2-13 · EL ALUMNO YA NO FIRMA SU PROPIA NOTA
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-13 · el reparto de expediente.sign es la separación de funciones", () => {
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "expediente.write"), true);
  assert.equal(
    hasEduPermission({ role: "ALUMNO" }, "expediente.sign"),
    false,
    "si el alumno firmara, ENVIADA sería decorativo — que era el hallazgo",
  );
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "expediente.sign"), true);
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "expediente.sign"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "expediente.sign"), false);
  // Y la key vive en exactamente un grupo, como todas.
  const grupos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("expediente.sign"));
  assert.equal(grupos.length, 1);
});

test("P2-13 · updateEduRecord rebota la FIRMADA sin canSign (y el route lo resuelve)", () => {
  const lib = fuente("src", "lib", "edu", "expediente.ts");
  const cuerpo = cuerpoDe(lib, "updateEduRecord");
  assert.match(cuerpo, /canSign/, "la puerta vive en la función, no solo en el endpoint");
  assert.match(cuerpo, /"FIRMADA"\s*&&\s*!options\.canSign/);

  const route = fuente("src", "app", "api", "instituto", "expediente", "[id]", "route.ts");
  assert.match(route, /expediente\.sign/, "el endpoint resuelve canSign con la key nueva");
});

// ═════════════════════════════════════════════════════════════════════
// P2-14 · LA FECHA DE FIRMA LA FORMATEA EL SERVIDOR
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-14 · la vista pública trae signedLabel y el navegador no formatea", () => {
  const lib = fuente("src", "lib", "edu", "consentimientos.ts");
  assert.match(
    cuerpoDe(lib, "getEduConsentPublic"),
    /signedLabel:\s*stampLabel\(/,
    "la etiqueta se hace en el servidor, con la zona del instituto",
  );
  const componente = fuente("src", "components", "edu", "consentimiento-publico.tsx");
  assert.ok(
    !componente.includes("toLocaleString"),
    "era la única fecha del vertical que formateaba el navegador — en un documento legal",
  );
});

// ═════════════════════════════════════════════════════════════════════
// P2-5 · EL RANGO DE SEMESTRES POR FIN HACE ALGO
//
// La decisión: el rango es CUÁNDO SE EXIGE (expectativa del semáforo
// contra el semestre actual), no qué casos cuentan — el semestre en que se
// abrió un caso no se registra, e invalidar trabajo hecho y calificado
// obligaría a repetir procedimientos en pacientes reales.
// ═════════════════════════════════════════════════════════════════════

function req(over: Partial<EduRequirementSpec> = {}): EduRequirementSpec {
  return {
    id: "req_1",
    name: "Endodoncias",
    programId: "prog_endo",
    semesterFrom: null,
    semesterTo: null,
    procedureId: null,
    category: null,
    requiredCount: 4,
    onlyCompleted: false,
    ...over,
  };
}

test("🔴 P2-5 · antes del rango se esperan 0; después, el total; dentro, proporcional", () => {
  const r = { semesterFrom: 3, semesterTo: 5 };
  // Alumno de 1º: el requisito de 3º–5º todavía no se le exige.
  assert.equal(eduRequirementExpectedRaw(r, 6, 0.5, 1), 0);
  // Alumno de 4º: lleva 2 de los 3 semestres del rango → 2/3 de 6 = 4.
  assert.equal(eduRequirementExpectedRaw(r, 6, 0.5, 4), 4);
  // Alumno de 6º: el rango ya pasó entero.
  assert.equal(eduRequirementExpectedRaw(r, 6, 0.1, 6), 6);
});

test("P2-5 · sin rango o sin semestre, la cuenta es la de siempre", () => {
  // Sin rango: required × fracción del ciclo, igual que antes de la ola.
  assert.equal(eduRequirementExpectedRaw({ semesterFrom: null, semesterTo: null }, 4, 0.5, 2), 2);
  // Con rango pero sin saber el semestre: no se adivina.
  assert.equal(eduRequirementExpectedRaw({ semesterFrom: 3, semesterTo: 5 }, 4, 0.5, null), 2);
  // "Hasta 5º" sin inicio: el inicio pintado es 1º y la cuenta lo asume igual.
  assert.equal(eduRequirementExpectedRaw({ semesterFrom: null, semesterTo: 5 }, 5, 0.9, 10), 5);
  // "Desde 3º a fin": exigible, y el ritmo lo sigue marcando el ciclo.
  assert.equal(eduRequirementExpectedRaw({ semesterFrom: 3, semesterTo: null }, 4, 0.5, 4), 2);
});

test("P2-5 · el semáforo suma la expectativa POR requisito (y deja de regañar a 1º)", () => {
  const casos: never[] = [];
  const sinRango = eduRequirementProgress(req({ id: "a", name: "A" }), casos, 0.5, 1);
  const deQuinto = eduRequirementProgress(
    req({ id: "b", name: "B", semesterFrom: 5, semesterTo: 6 }),
    casos,
    0.5,
    1,
  );
  const verdict = eduAtrasoVerdict([sinRango, deQuinto], 0.5);
  // Antes: esperados = (4+4) × 0.5 = 4. Ahora el de 5º–6º aporta 0.
  assert.equal(verdict.esperados, 2);
  // Y el detalle del que aún no toca lo DICE, en vez de "te faltan 4".
  assert.match(deQuinto.detail, /Se exige a partir de 5º/);
  // Un caso hecho ANTES del rango sigue contando: el rango acota cuándo se
  // espera, no cuándo se hizo.
  const conCaso = eduRequirementProgress(
    req({ id: "b2", name: "B2", semesterFrom: 5, semesterTo: 6, requiredCount: 1 }),
    [{ id: "c1", programId: "prog_endo", status: "COMPLETED", procedureId: null, procedureCategory: null }],
    0.5,
    1,
  );
  assert.equal(conCaso.met, true);
});

// ═════════════════════════════════════════════════════════════════════
// P2-8 · LA PANTALLA DE PERMISOS EXISTE (y sanea lo que le llega)
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-8 · el override se escribe desde el panel y pasa por el saneador", () => {
  const lib = fuente("src", "lib", "edu", "equipo.ts");
  assert.match(
    cuerpoDe(lib, "setEduTeamMemberPermissions"),
    /sanitizeEduPermissionKeys\(/,
    "TODO lo que venga del cliente pasa por el saneador antes de guardarse",
  );
  const pantalla = fuente("src", "components", "edu", "equipo", "equipo-screen.tsx");
  assert.match(pantalla, /EDU_PERMISSION_GROUPS/, "el editor pinta el catálogo por grupos");
  const route = fuente("src", "app", "api", "instituto", "equipo", "[id]", "route.ts");
  assert.match(route, /setEduTeamMemberPermissions\(/);
});

// ═════════════════════════════════════════════════════════════════════
// P2-9 · LA CONTRASEÑA TEMPORAL POR FIN CADUCA
// ═════════════════════════════════════════════════════════════════════

test("🔴 P2-9 · el panel no abre con mustChangePassword, y la pantalla existe", () => {
  const layout = fuente("src", "app", "instituto", "(panel)", "layout.tsx");
  assert.match(
    layout,
    /mustChangePassword\)\s*redirect\("\/instituto\/cambiar-contrasena"\)/,
    "la bandera se escribía desde la Ola 1B y nadie la leía — éste es el lector",
  );
  assert.ok(
    existsSync(join(RAIZ, "src", "app", "instituto", "cambiar-contrasena", "page.tsx")),
    "la pantalla vive FUERA del grupo (panel) para que el redirect no sea un bucle",
  );
  const route = fuente(
    "src", "app", "api", "instituto", "auth", "cambiar-contrasena", "route.ts",
  );
  assert.match(route, /updateMany/, "levanta la marca en TODAS las filas edu de la cuenta");
  assert.ok(
    !/body\.(email|supabaseId|userId)/.test(route),
    "la cuenta que se cambia es SIEMPRE la de la sesión, jamás una del body",
  );
});

// ═════════════════════════════════════════════════════════════════════
// P3-17 / P3-18 · LOS TOPES QUE FALTABAN Y EL CÓDIGO MUERTO
// ═════════════════════════════════════════════════════════════════════

test("P3-17 · listEduTransferableCases tiene tope y la captura de precios rebota repetidos", () => {
  const traspasos = fuente("src", "lib", "edu", "traspasos.ts");
  assert.match(cuerpoDe(traspasos, "listEduTransferableCases"), /take:\s*EDU_CLINICA_MAX_ROWS/);
  const tarifas = fuente("src", "lib", "edu", "tarifas.ts");
  const cuerpo = cuerpoDe(tarifas, "setEduProcedurePrices");
  assert.match(cuerpo, /precios\.length\s*>\s*EDU_MAX_FEE_SCHEDULES/);
  assert.match(cuerpo, /vistos\.has\(/, "el mismo renglón dos veces es un bug del cliente y rebota");
});

test("P3-18 · mapEduCurrentGrades (sin llamadores) ya no existe", () => {
  const rubricas = fuente("src", "lib", "edu", "rubricas.ts");
  assert.ok(!rubricas.includes("mapEduCurrentGrades"));
});

// ═════════════════════════════════════════════════════════════════════
// EL DEFAULT DE CADA ROL SIGUE SIENDO COHERENTE TRAS LA OLA
// ═════════════════════════════════════════════════════════════════════

test("cierre · los defaults no perdieron nada por accidente al ganar expediente.sign", () => {
  // El alumno conserva TODO lo que tenía (la ola solo le niega la key nueva).
  for (const key of [
    "expediente.write",
    "recetas.propose",
    "autorizaciones.request",
    "consentimientos.revoke",
  ] as const) {
    assert.ok(EDU_ROLE_DEFAULTS.ALUMNO.includes(key), `ALUMNO perdió ${key}`);
  }
  assert.ok(!EDU_ROLE_DEFAULTS.ALUMNO.includes("expediente.sign"));
  assert.ok(!EDU_ROLE_DEFAULTS.CAJA.includes("expediente.sign"));
});
