/**
 * OLA C · WS2-T3 — LAS CARRERAS DE ESTADO Y LOS GRAVES DE ACADÉMICO/AGENDA.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ola-c-carreras.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ LEE FUENTE
 *
 * Lo que arregla esta ola son ESCRITURAS: cinco `update({ where: { id } })`
 * que leían el estado por fuera y lo pisaban, más un puñado de textos que
 * afirmaban cosas que el producto no cumplía. Ninguna de las cinco se puede
 * ejercitar sin una base: son funciones que abren una transacción de Prisma
 * a la primera línea.
 *
 * Así que se prueban por el mismo camino que ya usan `edu-theme.test.ts` y
 * `edu-ola-b-acaballo.test.ts`: LEYENDO LA FUENTE. Lo que hay que fijar es
 * que una escritura lleve el estado DENTRO del `where` y su 409 al lado, y
 * eso no es un valor de retorno — es una forma. Una prueba de lectura de
 * fuente no demuestra que el código funcione; demuestra que la forma que lo
 * hace correcto sigue ahí, y esa es exactamente la que se pierde en el
 * refactor de dentro de tres olas.
 *
 * Lo que SÍ es lógica pura se prueba ejecutándolo: la regla de la
 * calificación vigente (H-05) y la invariante cita↔caso (H-15) viven en
 * funciones puras y aquí se llaman de verdad.
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eduCurrentGrade } from "@/lib/edu/evaluacion-core";
import { eduCaseFitsAppointment } from "@/lib/edu/agenda-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(ruta: string): string {
  return readFileSync(join(RAIZ, ...ruta.split("/")), "utf8");
}

/** El trozo de fuente que hay entre dos marcas. Se usa para acotar la
 *  aserción a la función que toca y no a "en algún sitio del archivo". */
function tramo(src: string, desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  assert.ok(i >= 0, `no se encontró el ancla «${desde}»: la prueba se quedó vieja`);
  const j = src.indexOf(hasta, i + desde.length);
  assert.ok(j > i, `no se encontró el cierre «${hasta}» después de «${desde}»`);
  return src.slice(i, j);
}

const AGENDA = "src/lib/edu/agenda.ts";
const CASOS = "src/lib/edu/casos.ts";
const AUTORIZACIONES = "src/lib/edu/autorizaciones.ts";
const RUBRICAS = "src/lib/edu/rubricas.ts";
const WHATSAPP = "src/lib/edu/whatsapp.ts";
const RECORDATORIOS = "src/lib/edu/recordatorios.ts";

// ═══════════════════════════════════════════════════════════════════════
// 1 · LAS CINCO CARRERAS (punto 5 del informe, las que son de esta casilla)
//
// El patrón de la casa desde la Ola A: `updateMany` con el estado LEÍDO
// dentro del `where`, y 409 si `count === 0`. `update` no admite más
// condiciones que el id — por eso la forma correcta es literalmente otra
// función, y por eso se puede comprobar leyendo.
// ═══════════════════════════════════════════════════════════════════════

test("carrera 1 · el ESTADO DE UNA CITA no se pisa (setEduAppointmentStatus)", () => {
  const src = crudo(AGENDA);
  const fn = tramo(src, "export async function setEduAppointmentStatus", "listEduPendingScreenings");
  assert.ok(
    !fn.includes("prisma.eduAppointment.update({"),
    "volvió el `update({ where: { id } })`: caja cancela en el mismo segundo en que el " +
      "alumno pulsa «Terminó» y queda una CANCELLED con completedAt puesto",
  );
  assert.ok(
    fn.includes("status: current.status"),
    "el estado leído dejó de entrar en el `where` del updateMany",
  );
  assert.ok(fn.includes("movida.count === 0"), "falta el 409 cuando no movió nada");
});

test("carrera 1b · REAGENDAR tampoco pisa un estado nuevo (updateEduAppointment)", () => {
  const src = crudo(AGENDA);
  const fn = tramo(src, "export async function updateEduAppointment", "export async function setEduAppointmentStatus");
  assert.ok(
    !fn.includes("prisma.eduAppointment.update({ where: { id: current.id }, data });"),
    "reagendar volvió a escribir con `where: { id }` a secas",
  );
  assert.ok(
    fn.includes("status: current.status"),
    "reagendar dejó de acotar por el estado que leyó",
  );
});

test("carrera 2 · la DECISIÓN DE UNA AUTORIZACIÓN no resucita un rechazo (H-07)", () => {
  const src = crudo(AUTORIZACIONES);
  const fn = tramo(src, "export async function decideEduApproval", "export async function");
  assert.ok(
    !fn.includes("tx.eduCaseApproval.update({"),
    "volvió el `update` sin estado: el «Autorizar» del docente de guardia pisa el " +
      "«Rechazar» del titular y BORRA el motivo, que es el único historial que hay",
  );
  assert.ok(
    fn.includes('status: "PENDING"') && fn.includes("updateMany"),
    "la decisión dejó de acotarse a PENDING dentro de la transacción",
  );
  assert.ok(fn.includes("decidida.count === 0"), "falta el 409 de la decisión");
});

test("carrera 2b · el LOTE de autorizaciones tampoco (H-31)", () => {
  const src = crudo(AUTORIZACIONES);
  const fn = tramo(src, "const vistas = new Set(filas.map", "// LO QUE SE PUEDE MANDAR A AUTORIZAR");
  assert.ok(
    !fn.includes("prisma.eduCaseApproval.update({"),
    "el lote volvió a firmar con `update({ where: { id } })` sobre filas leídas antes",
  );
  assert.ok(
    fn.includes("eduCaseApproval.updateMany") && fn.includes('status: "PENDING"'),
    "el lote dejó de acotar por PENDING",
  );
  assert.ok(
    fn.includes('reason: "no-pendiente"'),
    "la que no se movió tiene que reportarse como excluida, no contarse como firmada",
  );
});

test("carrera 3 · el ESTADO DE UN CASO no pisa un traspaso en curso (H-08)", () => {
  const src = crudo(CASOS);
  const fn = tramo(src, "export async function updateEduCase", "// EL TAMIZAJE");
  assert.ok(
    !fn.includes("tx.eduCase.update({ where: { id: current.id }, data })"),
    "volvió el update a secas: el traspaso en lote y el «Dar de alta» se pisan y el " +
      "paciente queda con dos casos vivos en la misma especialidad",
  );
  assert.ok(
    fn.includes("tx.eduCase.updateMany") && fn.includes("status: current.status"),
    "el PATCH del caso dejó de llevar el estado leído en el `where`",
  );
  assert.ok(fn.includes("movido.count === 0"), "falta el 409 del PATCH del caso");
});

test("carrera 4 · CALIFICAR comprueba la vigencia DENTRO de la transacción (H-05/H-95)", () => {
  const src = crudo(RUBRICAS);
  const fn = tramo(src, "export async function createEduGrade", "// ⚠️ Aquí vivía `mapEduCurrentGrades`");
  const tx = fn.slice(fn.indexOf("prisma.$transaction"));
  assert.ok(
    tx.includes("tx.eduCaseGrade.findMany"),
    "la comprobación de vigencia salió de la transacción: dos correcciones de la misma " +
      "raíz vuelven a caber las dos (el índice (institutionId, correctsId) NO es único)",
  );
  assert.ok(
    tx.includes("eduCurrentGrade(hermanas)"),
    "createEduGrade dejó de rebotar la SEGUNDA raíz: el caso vuelve a contar dos veces " +
      "en el promedio del alumno",
  );
  assert.ok(tx.includes("409"), "el rebote de la segunda calificación dejó de ser un 409");
});

test("carrera 5 · el REUSO de un envío de WhatsApp tiene llave de idempotencia (H-115)", () => {
  const src = crudo(WHATSAPP);
  assert.ok(
    !src.includes("prisma.eduWhatsappMessage.update({\n      where: { id: args.reuseId },"),
    "el camino de reuso volvió a reclamar la fila con `update({ where: { id } })`: dos " +
      "barridos simultáneos vuelven a llamar a Meta dos veces por el mismo recordatorio",
  );
  const claim = tramo(src, "if (args.reuseId) {", "} else {");
  assert.ok(claim.includes("updateMany"), "la reclamación dejó de ser un updateMany");
  assert.ok(
    claim.includes("args.reuseStatus") && claim.includes("args.reuseAttempts"),
    "el par (status, attempts) leído dejó de entrar en el `where`: sin él la reclamación " +
      "no es atómica y los dos barridos ganan",
  );
  assert.ok(
    claim.includes("reclamada.count === 0"),
    "sin comprobar `count` la reclamación no reclama nada",
  );

  const barrido = crudo(RECORDATORIOS);
  assert.ok(
    barrido.includes("reuseStatus: previa?.status ?? null"),
    "el barrido dejó de pasar el estado con el que leyó la fila: el `where` de arriba se " +
      "queda sin condición y vuelve el envío doble",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · H-05 — LA REGLA QUE SOSTIENE EL PROMEDIO, ejecutada de verdad
// ═══════════════════════════════════════════════════════════════════════

test("H-05 · con una calificación sin corregir, `eduCurrentGrade` la encuentra (y el 409 salta)", () => {
  // Es la condición EXACTA que createEduGrade evalúa dentro de la
  // transacción antes de crear una raíz nueva.
  const hermanas = [{ id: "g1", correctsId: null }];
  assert.ok(
    eduCurrentGrade(hermanas) !== null,
    "un caso ya calificado tiene vigente: crear otra raíz lo haría contar DOS veces",
  );
});

test("H-05 · con la única calificación ya corregida, NO hay vigente que bloquee", () => {
  // g2 corrige a g1: la cadena está cerrada por g2, que es la vigente. Un
  // tercer intento sin `correctsId` sigue teniendo que rebotar…
  const conCorreccion = [
    { id: "g2", correctsId: "g1" },
    { id: "g1", correctsId: null },
  ];
  assert.equal(
    eduCurrentGrade(conCorreccion)?.id,
    "g2",
    "la vigente es la que nadie corrige: si esto cambia, el 409 de H-05 bloquea lo que no debe",
  );
  // …y un caso SIN ninguna calificación no bloquea nada.
  assert.equal(eduCurrentGrade([]), null, "un caso sin calificar tiene que dejar calificar");
});

test("H-05 · el botón «Calificar otra vez» manda el correctsId de la vigente", () => {
  const src = crudo("src/components/edu/evaluacion/bitacora-screen.tsx");
  assert.ok(
    src.includes("corrigeId: c.gradeId"),
    "el botón volvió a mandar `corrige: null` desde la tabla de casos: nace una segunda " +
      "raíz y la bitácora dice «2 casos calificados» con un solo caso",
  );
  assert.ok(
    src.includes("correctsId: corrige?.id ?? corrigeId ?? undefined"),
    "el POST dejó de mandar el correctsId cuando se califica desde la tabla",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · H-15 — LA CITA Y SU CASO SON DEL MISMO ALUMNO
// ═══════════════════════════════════════════════════════════════════════

test("H-15 · la invariante que defiende el POST de la agenda, ejecutada", () => {
  const cita = { patientId: "p1", studentId: "A" };
  assert.equal(
    eduCaseFitsAppointment({ patientId: "p1", studentId: "A" }, cita),
    true,
    "mismo paciente y mismo alumno tiene que encajar",
  );
  assert.equal(
    eduCaseFitsAppointment({ patientId: "p1", studentId: "B" }, cita),
    false,
    "el caso de OTRO alumno no encaja: es justo el enlace que dejaba las horas clínicas " +
      "contadas por un lado y el caso por otro",
  );
});

test("H-15 · la Valoración solo engancha la cita si encaja", () => {
  const src = crudo(CASOS);
  const fn = tramo(src, "export async function createEduCase", "export async function updateEduCase");
  assert.ok(
    fn.includes("citaEncaja = eduCaseFitsAppointment("),
    "la Valoración volvió a comprobar la cita SOLO contra el paciente: queda una fila con " +
      "studentId de A y caseId del caso de B",
  );
  assert.ok(
    fn.includes("if (screeningAppointmentId && citaEncaja)"),
    "el enlace de vuelta (caseId sobre la cita) dejó de mirar si la cita es del mismo alumno",
  );
  assert.ok(
    fn.includes("eduCaseFitsAppointment") && crudo("src/lib/edu/agenda-core.ts").includes("export function eduCaseFitsAppointment"),
    "la regla se comprueba con la MISMA función que el POST de la agenda, no con una copia",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LO DEMÁS DE LOS CUATRO BLOQUES QUE SE PUEDE FIJAR
// ═══════════════════════════════════════════════════════════════════════

test("H-37 · un caso TRANSFERIDO no vuelve a tratamiento", () => {
  const src = crudo(CASOS);
  const fn = tramo(src, "export async function updateEduCase", "// EL TAMIZAJE");
  assert.ok(
    fn.includes('current.status === "TRANSFERRED"'),
    "por API un caso traspasado volvía a IN_TREATMENT y el alumno que lo entregó RECUPERABA " +
      "la ficha, el expediente y las radiografías del paciente",
  );
});

test("H-42 · un caso cerrado no manda nada a autorización", () => {
  const src = crudo(AUTORIZACIONES);
  const fn = tramo(src, "async function resolveCase", "export interface EduApprovalRequestInput");
  assert.ok(
    fn.includes("EDU_CASE_CLOSED_STATUSES"),
    "resolveCase volvió a mirar solo el tenant y el alcance: una pestaña vieja mete en la " +
      "bandeja la petición de un caso terminado, que se queda ahí para siempre",
  );
});

test("H-32 · la bandeja no arrastra autorizaciones de casos cerrados", () => {
  const src = crudo(AUTORIZACIONES);
  const fn = tramo(src, "export async function listEduApprovalInbox", "export async function");
  assert.ok(
    fn.includes("status: { notIn: EDU_CASE_CLOSED_STATUSES }"),
    "la bandeja volvió a filtrar solo por PENDING y alcance: la petición del alumno que " +
      "egresó sigue arriba, cada día más roja, sin nada que firmar",
  );
});

test("H-23 · la cola de valoraciones y el cambio de estado se recortan por SEDE", () => {
  const src = crudo(AGENDA);
  const pendientes = tramo(src, "export async function listEduPendingScreenings", "\n}\n");
  assert.ok(
    pendientes.includes("campusIds: ctx.campusIds"),
    "las valoraciones pendientes volvieron a leerse sin alcance de sede: una dirección del " +
      "Norte ve con nombre y folio las del Sur",
  );
  const estado = tramo(src, "export async function setEduAppointmentStatus", "listEduPendingScreenings");
  assert.ok(
    estado.includes("campusIds: ctx.campusIds"),
    "el cambio de estado de una cita volvió a no recortar por sede",
  );
  const pagina = crudo("src/app/instituto/(panel)/agenda/tamizaje/page.tsx");
  assert.ok(
    pagina.includes("getEduCampusScope(ctx)") && pagina.includes("eduWithCampus(ctx, sede)"),
    "la página del tamizaje volvió a llamar con el ctx crudo, que no trae campusIds",
  );
});

test("H-18 · la baja de un alumno no congela sus citas ya agendadas", () => {
  const src = crudo(AGENDA);
  assert.ok(
    src.includes("opciones: { studentUnchanged?: boolean }"),
    "resolveParties volvió a revalidar SIEMPRE al alumno: mover cualquier cita de alguien " +
      "dado de baja muere con «Ese estudiante no está activo en el padrón»",
  );
  assert.ok(
    src.includes('student.status !== "ACTIVE" && !opciones.studentUnchanged'),
    "la excepción del alumno que no cambia desapareció",
  );
  const alta = tramo(src, "export async function createEduAppointment", "export async function updateEduAppointment");
  assert.ok(
    !alta.includes("studentUnchanged"),
    "el ALTA no puede llevar la excepción: a un alumno de baja no se le agendan pacientes nuevos",
  );
});

test("H-91 · la rúbrica se valida contra la especialidad del CASO", () => {
  const src = crudo(RUBRICAS);
  const fn = tramo(src, "export async function createEduGrade", "// ⚠️ Aquí vivía `mapEduCurrentGrades`");
  assert.ok(
    fn.includes("rubrica.programId !== caso.programId"),
    "una endodoncia se vuelve a poder calificar por API con la rúbrica de Ortodoncia, y la " +
      "escala se CONGELA en la fila: después no hay arreglo",
  );
});

test("H-92 · la escala de una rúbrica no se coacciona en silencio al crear", () => {
  const src = crudo(RUBRICAS);
  const fn = tramo(src, "export async function createEduRubric", "export async function");
  assert.ok(
    !fn.includes("eduEvalInt(input.scaleMax, 0, 1000) ?? 100"),
    "volvió el `?? 100`: dejar «hasta» vacío da 0–100 cuando se creía 0–10, y la escala " +
      "queda congelada en cada calificación que se ponga con esa rúbrica",
  );
});

test("H-96 · «fuera de escala» no se reporta como «falta la puntuación»", () => {
  const src = crudo(RUBRICAS);
  assert.ok(
    src.includes("fueraDeEscala"),
    "los dos casos volvieron al mismo `continue`: el docente lee «Falta la puntuación de: " +
      "Conformación» con el campo lleno, de pie en el piso clínico",
  );
});

test("H-117 · el barrido vuelve a mirar la cita justo antes de mandar", () => {
  const src = crudo(RECORDATORIOS);
  assert.ok(
    src.includes("const sigueViva = await prisma.eduAppointment.findFirst"),
    "recepción cancela a las 09:00:12 y el barrido le manda «le recordamos su cita» a las " +
      "09:00:35: applyEduReminderCancel solo cancela filas que YA existen",
  );
});

test("H-01 · el barrido manual FIRMA, y por eso «sin firma» vuelve a significar «el cron»", () => {
  const ruta = crudo("src/app/api/instituto/whatsapp/recordatorios/route.ts");
  assert.ok(
    ruta.includes("sentByUserId: g.ctx.eduUserId"),
    "el botón «Correr el barrido ahora» dejó de firmar: sus filas vuelven a ser " +
      "indistinguibles de las del cron y la tarjeta no puede decir si el automático corrió",
  );
  const rec = crudo(RECORDATORIOS);
  assert.ok(
    rec.includes("export async function getEduReminderAutomationStatus"),
    "desapareció la lectura del último envío automático, que es lo que hace honesta la tarjeta",
  );
  const pantalla = crudo("src/components/edu/whatsapp/whatsapp-screen.tsx");
  assert.ok(
    pantalla.includes("automatizacion.lastAutomaticAt"),
    "la tarjeta volvió a prometer «Sale 24 h antes» sin mirar si ha salido alguno",
  );
  assert.ok(
    pantalla.includes("/api/instituto/cron/recordatorios"),
    "la tarjeta dejó de decir QUÉ falta (dar de alta el cron en vercel.json)",
  );
});

test("H-133 · el CSV de dirección declara su maxDuration", () => {
  const src = crudo("src/app/api/instituto/direccion/export/route.ts");
  assert.ok(
    src.includes("export const maxDuration"),
    "el endpoint más caro del vertical volvió a quedarse sin maxDuration: un rango de 366 " +
      "días —el de la acreditación— devuelve un 504 sin mensaje",
  );
});

test("H-120 · sin lista de alumno, el control de tarifa no lista TODOS los cobros", () => {
  const src = crudo("src/lib/edu/direccion.ts");
  assert.ok(
    !src.includes('...(key === "control-tarifa" && listasDeAlumno.size > 0'),
    "volvió el filtro condicional: sin ninguna lista con regla de alumno el detalle " +
      "devuelve TODOS los cobros del periodo pintados en rojo «ACTUAR»",
  );
});
