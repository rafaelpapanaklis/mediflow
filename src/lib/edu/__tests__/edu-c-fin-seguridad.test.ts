/**
 * OLA C·FIN · WS2-T1 — SEGURIDAD, PERSONAS Y PACIENTES.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-c-fin-seguridad.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO, Y POR QUÉ LEE FUENTE EN LA MITAD DE LAS PRUEBAS
 *
 * Los siete hallazgos que cierra esta casilla son, casi todos, ESCRITURAS y
 * PUERTAS: un `if` que faltaba antes de tocar Supabase Auth, un `where` que
 * no llevaba el alcance, un `updateMany` sin compare-and-swap, un endpoint
 * que se creía lo que le mandaba el navegador. Ninguna de esas cosas se
 * puede ejercitar sin una base de datos y sin GoTrue: son funciones que
 * abren una transacción de Prisma en la primera línea.
 *
 * Así que se prueban por el camino que ya usa el resto del vertical
 * (`edu-ola-c-carreras.test.ts` lo explica entero): LEYENDO LA FUENTE. Una
 * prueba así no demuestra que el código funcione — demuestra que la FORMA
 * que lo hace correcto sigue ahí, que es justo lo que se pierde en el
 * refactor de dentro de tres olas. Y para que no sea "está la palabra en
 * algún sitio del archivo", cada aserción se acota al TRAMO de la función
 * que le toca.
 *
 * Lo que sí es lógica pura se ejecuta de verdad: el compare-and-swap del
 * cuestionario y la redacción de la bitácora se llaman con datos, no se
 * leen.
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  eduCuestionarioMergeCas,
  eduCuestionarioMergeData,
  type EduCuestionarioAnswers,
} from "@/lib/edu/cuestionario-core";
import { eduAuditRedactaClaves } from "@/lib/edu/auditoria-core";
import { EDU_AUDIT_ACTIONS, EDU_AUDIT_ENTITIES } from "@/lib/edu/auditoria-core";
import {
  EDU_ARCO_BITACORA_CLAVES,
  EDU_ARCO_CONSERVADO,
  EDU_ARCO_PII_FIELDS,
  EDU_ARCO_REDACTED,
  EDU_ARCO_TAX_FIELDS,
} from "@/lib/edu/arco-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const crudo = (ruta: string): string => readFileSync(join(RAIZ, ...ruta.split("/")), "utf8");

/**
 * El fuente SIN comentarios. Hace falta de verdad: varias aserciones de
 * abajo buscan una forma PROHIBIDA, y los comentarios de este repo citan
 * textualmente la forma prohibida para explicar por qué lo es. Sin
 * quitarlos, la prueba se dispara con su propia documentación.
 */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** El trozo de fuente entre dos marcas, para acotar la aserción. */
function tramo(src: string, desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  assert.ok(i >= 0, `no se encontró el ancla «${desde}»: la prueba se quedó vieja`);
  const j = src.indexOf(hasta, i + desde.length);
  assert.ok(j > i, `no se encontró el cierre «${hasta}» después de «${desde}»`);
  return src.slice(i, j);
}

const EQUIPO = "src/lib/edu/equipo.ts";
const PLAN = "src/lib/edu/plan-tratamiento.ts";
const CUESTIONARIO = "src/lib/edu/cuestionario.ts";
const IMPORTAR = "src/lib/edu/importar.ts";
const CORE_IMPORTAR = "src/lib/edu/importar-core.ts";
const INSTITUCION = "src/lib/edu/institucion.ts";
const ARCO = "src/lib/edu/arco.ts";
const FUSION = "src/lib/edu/fusion.ts";
const AUDITORIA = "src/lib/edu/auditoria.ts";
const INTENTO = "src/app/api/instituto/auth/intento/route.ts";
const LOGIN_FORM = "src/components/edu/edu-login-form.tsx";
const SESSION = "src/app/api/instituto/auth/session/route.ts";
const LOGOUT = "src/app/api/instituto/auth/logout/route.ts";
const CAMBIAR = "src/app/api/instituto/auth/cambiar-contrasena/route.ts";

// ═══════════════════════════════════════════════════════════════════════
// 1 · S-1 · LA TOMA DE CONTROL CRUZADA, ESLABÓN POR ESLABÓN
//
// La cadena que encontró la auditoría, tal como está escrita en su informe:
//
//   1. Mónica tiene `equipo.manage` en el Instituto A y da de alta a alguien
//      con el correo de la directora del Instituto B. Supabase contesta "ya
//      registrado" → `resolverSupabaseIdExistente` devolvía el supabaseId de
//      la VÍCTIMA y se creaba en A una fila atada a su cuenta de Auth.
//   2. `PATCH /api/instituto/equipo/<esa fila>` con `{ email: "monica@…" }`.
//      `cuentaCompartida` calculaba `enDental` y `enOtroInstituto`, y el `if`
//      solo miraba `enDental` → `updateUserById` le cambiaba el login a la
//      directora de B.
//   3. `POST /api/auth/forgot-password` con ese correo.
//   4. `getEduContext` resuelve por `supabaseId` a la fila MÁS VIEJA: la de
//      DIRECCIÓN del Instituto B.
//
// Cada prueba de abajo corta un eslabón, y dice cuál.
// ═══════════════════════════════════════════════════════════════════════

test("S-1 · eslabón 1: el alta NO enlaza una cuenta que ya es de otro instituto", () => {
  const src = crudo(EQUIPO);
  const fn = tramo(src, "async function resolverSupabaseIdExistente", "function teamWhere");
  const limpio = sinComentarios(fn);

  // La consulta a edu_users ya no devuelve el supabaseId de nadie: sirve
  // para RECHAZAR, y lleva el instituto propio fuera con `NOT`.
  assert.match(
    limpio,
    /prisma\.eduUser\.findFirst\(\{\s*where:\s*\{\s*email,\s*NOT:\s*\{\s*institutionId\s*\}\s*\}/,
    "la búsqueda en edu_users tiene que excluir el instituto propio y no devolver supabaseId",
  );
  assert.match(
    limpio,
    /return\s*\{\s*supabaseId:\s*null,\s*motivo:\s*"otro-instituto"\s*\}/,
    "encontrar la cuenta en otro instituto tiene que RECHAZAR, no enlazar",
  );
  // Y el corte va ANTES de GoTrue: si solo se hubiera quitado la consulta a
  // edu_users, el `filter` de la API de administración devolvería el mismo
  // id y el agujero seguiría abierto por la puerta de atrás.
  assert.ok(
    limpio.indexOf('motivo: "otro-instituto"') < limpio.indexOf("/auth/v1/admin/users"),
    "el rechazo por «otro instituto» tiene que ir ANTES de preguntarle a GoTrue",
  );
});

test("S-1 · eslabón 1: el alta contesta 409 y lo dice con palabras", () => {
  const src = crudo(EQUIPO);
  const fn = tramo(src, "export async function createEduTeamMember", "export async function createEduTeamMembers");
  const limpio = sinComentarios(fn);

  assert.match(limpio, /resuelto\.motivo === "otro-instituto"/, "el alta tiene que mirar el motivo");
  assert.match(
    fn,
    /otro instituto de DaleControl[\s\S]{0,400}?409/,
    "y contestar 409 con un mensaje que diga qué pasa y qué hacer",
  );
  // El alta MASIVA no puede tumbar las otras 24 filas por esto: sigue
  // siendo un `fallo(...)` de renglón y no un throw.
  assert.ok(
    !/throw new EduPadronError[\s\S]{0,120}otro instituto/.test(fn),
    "en el alta masiva esto es un renglón en rojo, no una excepción que tire el trozo",
  );
});

test("S-1 · eslabón 2: el PATCH del correo bloquea las DOS banderas, no una", () => {
  const src = crudo(EQUIPO);
  const fn = tramo(src, "export async function updateEduTeamMember", "export async function resetEduTeamMemberPassword");
  const limpio = sinComentarios(fn);

  assert.match(limpio, /if\s*\(compartida\.enDental\)/, "seguía cortando el caso del dental");
  assert.match(
    limpio,
    /if\s*\(compartida\.enOtroInstituto\)/,
    "🔴 ESTE es el eslabón 2: sin este `if`, con equipo.manage en A se le cambia el login a la dirección de B",
  );
  // Y las dos van ANTES de tocar Supabase Auth: comprobar después sería
  // comprobar cuando el correo ya cambió.
  assert.ok(
    limpio.indexOf("compartida.enOtroInstituto") < limpio.indexOf("admin.auth.admin.updateUserById"),
    "la comprobación va ANTES de updateUserById, no después",
  );
  // El mismo par de banderas que `resetEduTeamMemberPassword` ya miraba: la
  // asimetría era la prueba de que fue un descuido.
  assert.match(
    sinComentarios(crudo(EQUIPO)),
    /compartida\.enDental \|\| compartida\.enOtroInstituto/,
    "la contraseña ya miraba las dos; el correo tenía que mirarlas también",
  );
});

test("S-1 · la propagación del correo entre institutos está APAGADA", () => {
  const limpio = sinComentarios(crudo(EQUIPO));
  // Un correo compartido entre dos escuelas no se cambia desde ninguna, así
  // que no queda ningún escritor que copie el correo a las filas hermanas.
  assert.ok(
    !/eduUser\.findMany\(\{\s*where:\s*\{\s*supabaseId:\s*persona\.supabaseId/.test(limpio),
    "ya no se buscan las filas hermanas de otros institutos para propagarles el correo",
  );
  assert.ok(
    !/for\s*\(const h of hermanas\)/.test(limpio),
    "el bucle de propagación tiene que haber desaparecido, no quedarse inalcanzable",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · #3 · EL PLAN DE TRATAMIENTO, RECORTADO POR CASO
// ═══════════════════════════════════════════════════════════════════════

test("#3 · las tres puertas del plan llevan el recorte por CASO", () => {
  const src = crudo(PLAN);

  // El helper existe y usa el alcance clínico + eduCaseScopeWhere.
  const helper = sinComentarios(
    tramo(src, "function eduPlanScopeWhere", "export interface EduPlanRow"),
  );
  assert.match(helper, /eduClinicalScope\(ctx\)/);
  assert.match(helper, /eduCaseScopeWhere\(\{ institutionId, scope, now \}\)/);
  // Un plan «sin caso» sigue colgando del paciente: la pantalla ofrece esa
  // opción a propósito y filtrarlo escondería los planes que ya existen.
  assert.match(helper, /caseId:\s*null/);
  // Y sin alcance clínico no se devuelve un `where` que no filtra nada.
  assert.match(helper, /id:\s*\{\s*in:\s*\[\]\s*\}/);

  const FIN = "\n/* FIN DEL ARCHIVO */";
  for (const [fn, hasta] of [
    ["export async function listEduPlanes", "export async function createEduPlan"],
    ["export async function marcarEduPlanSesion", "export async function cambiarEstadoEduPlan"],
    ["export async function cambiarEstadoEduPlan", FIN],
  ] as const) {
    const cuerpo = sinComentarios(tramo(src + FIN, fn, hasta));
    assert.match(
      cuerpo,
      /eduPlanScopeWhere\(ctx, institutionId, now\)/,
      `${fn} lee o escribe el plan sin el recorte por caso: es el plan de OTRO alumno`,
    );
  }
});

test("#3 · createEduPlan no cuelga un plan de un caso fuera del alcance, y usa AND", () => {
  const src = crudo(PLAN);
  const cuerpo = tramo(src, "export async function createEduPlan", "export async function marcarEduPlanSesion");
  const limpio = sinComentarios(cuerpo);

  assert.match(limpio, /eduCaseScopeWhere\(/, "el caseId del body tiene que pasar por el alcance");
  // 🔴 En AND y no esparcido: `eduCaseScopeWhere` puede devolver
  // `{ institutionId, id: { in: [] } }` y una clave `id` escrita encima lo
  // BORRARÍA. Es el error contra el que avisa por escrito arco.ts.
  assert.match(
    limpio,
    /AND:\s*\[\s*eduCaseScopeWhere/,
    "el alcance del caso va en AND: esparcirlo dejaría que la clave `id` pisara el «ninguno»",
  );
});

test("#3 · ABANDONADO ya no es un clic de alumno, y sigue pidiendo motivo", () => {
  const src = crudo(PLAN);
  const cuerpo = tramo(src + "\n/* FIN DEL ARCHIVO */", "export async function cambiarEstadoEduPlan", "\n/* FIN DEL ARCHIVO */");
  const limpio = sinComentarios(cuerpo);

  // ABANDONADO no tiene salida en la máquina de estados: cerrar el plan de
  // alguien es irreversible, y `expediente.write` lo lleva ALUMNO por
  // defecto.
  assert.match(
    limpio,
    /destino === "ABANDONADO" && ctx\.role !== "DIRECCION" && ctx\.role !== "DOCENTE"/,
    "abandonar un plan tiene que pedir DOCENTE o DIRECCIÓN",
  );
  assert.match(limpio, /403/, "y contestar 403, no un 400 de dato mal escrito");
  assert.match(
    limpio,
    /destino === "ABANDONADO" && !reason/,
    "el motivo se seguía exigiendo y se sigue exigiendo",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · #4 · EL MERGE DEL CUESTIONARIO NO PISA ALERGIAS
//
// Aquí sí se ejecuta de verdad: el compare-and-swap es una función pura.
// ═══════════════════════════════════════════════════════════════════════

test("#4 · el merge nunca vacía una lista, ni con respuestas vacías", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  const ficha = { allergies: ["Penicilina"], chronicConditions: ["Diabetes"], currentMedications: [] };

  // Un cuestionario que NO pregunta por alergias no toca la columna.
  const sinPregunta = eduCuestionarioMergeData({} as EduCuestionarioAnswers, ficha, "u1", now);
  assert.equal(sinPregunta.allergies, undefined, "campo ausente no se escribe");

  // Y uno que pregunta y no trae nada, tampoco: ausente y vacío son la
  // misma decisión aquí, y borrar una alergia es un acto explícito desde
  // la pestaña de antecedentes.
  const vacio = eduCuestionarioMergeData(
    { alergias: [] } as unknown as EduCuestionarioAnswers,
    ficha,
    "u1",
    now,
  );
  assert.equal(vacio.allergies, undefined, "una respuesta vacía no puede vaciar la ficha");
});

test("#4 · los DOS escritores: guardar el cuestionario ya no borra lo que escribió el otro", () => {
  const now = new Date("2026-09-08T10:00:00Z");

  // ── El escenario exacto del informe ────────────────────────────────
  // 1. Ana abre el cuestionario. La ficha se lee con las alergias vacías.
  const fotoDeAna = { allergies: [] as string[], chronicConditions: [] as string[] };
  const data = eduCuestionarioMergeData(
    { alergias: ["Látex"] } as unknown as EduCuestionarioAnswers,
    fotoDeAna,
    "ana",
    now,
  );
  assert.deepEqual(data.allergies, ["Látex"]);

  // 2. Mientras tanto, la docente guarda antecedentes: `["Penicilina"]`.
  const enLaBase = { allergies: ["Penicilina"], chronicConditions: [] as string[] };

  // 3. Ana guarda. ANTES: se escribía `["Látex"]` con un `where` de `{ id,
  //    institutionId }`, la penicilina desaparecía y nadie se enteraba.
  //    AHORA el `where` lleva las listas TAL COMO SE LEYERON.
  const cas = eduCuestionarioMergeCas(data, fotoDeAna);
  assert.deepEqual(cas.allergies, { equals: [] }, "el where lleva la foto, no el resultado");
  assert.notDeepEqual(
    cas.allergies!.equals,
    enLaBase.allergies,
    "la condición NO se cumple contra la base de ahora: el updateMany escribe 0 filas",
  );

  // 4. El reintento relee la ficha de AHORA y une contra ella: quedan las
  //    dos. Es lo que hace el bucle de `createEduCuestionario`.
  const reintento = eduCuestionarioMergeData(
    { alergias: ["Látex"] } as unknown as EduCuestionarioAnswers,
    enLaBase,
    "ana",
    now,
  );
  assert.deepEqual(reintento.allergies, ["Penicilina", "Látex"], "ninguna de las dos se pierde");
  assert.deepEqual(eduCuestionarioMergeCas(reintento, enLaBase).allergies, {
    equals: ["Penicilina"],
  });
});

test("#4 · el compare-and-swap solo pide las listas que esa escritura VA a tocar", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  const ficha = {
    allergies: ["Penicilina"],
    chronicConditions: ["Diabetes"],
    currentMedications: ["Metformina"],
  };
  const data = eduCuestionarioMergeData(
    { alergias: ["Látex"] } as unknown as EduCuestionarioAnswers,
    ficha,
    "u1",
    now,
  );
  const cas = eduCuestionarioMergeCas(data, ficha);
  assert.deepEqual(cas.allergies, { equals: ["Penicilina"] });
  assert.equal(
    cas.currentMedications,
    undefined,
    "un cuestionario que no pregunta por medicamentos no puede fallar porque alguien los tocara",
  );
  assert.equal(cas.chronicConditions, undefined);
});

test("#4 · y el escritor lo lleva puesto: where con el CAS, count mirado y reintento", () => {
  const src = crudo(CUESTIONARIO);
  const cuerpo = tramo(src, "export async function createEduCuestionario", "\n/**");
  const limpio = sinComentarios(cuerpo);

  assert.match(
    limpio,
    /where:\s*\{\s*id:\s*paciente\.id,\s*institutionId,\s*\.\.\.mergeCas\s*\}/,
    "el merge tiene que escribir con el compare-and-swap en el where",
  );
  assert.match(limpio, /escrito\.count === 0/, "y mirar el count: si no, no se entera de nada");
  assert.match(limpio, /EduCuestionarioMergePisado/, "y reintentar en vez de pisar");
  // 🔴 La ficha se RELEE dentro del bucle: reintentar contra la foto vieja
  // sería un reintento que repite el fallo.
  assert.ok(
    limpio.indexOf("for (let intento") < limpio.indexOf("prisma.eduPatient.findFirst"),
    "la lectura de la ficha va DENTRO del bucle de reintentos",
  );
  // Y el throw va dentro de la transacción, para que la versión creada se
  // deshaga con él.
  assert.ok(
    limpio.indexOf("eduHealthQuestionnaire.create") < limpio.indexOf("EduCuestionarioMergePisado"),
    "el fallo del merge deshace también la versión recién creada",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · S-2 · LA PUERTA: EL ENDPOINT HACE EL INTENTO
// ═══════════════════════════════════════════════════════════════════════

test("S-2 · /auth/intento ya no se cree `phase` ni `email` del body", () => {
  const src = crudo(INTENTO);
  const limpio = sinComentarios(src);

  // Las tres fases declaradas por el cliente ya no existen como entrada.
  assert.ok(!/body\?\.phase/.test(limpio), "`phase` del body era la declaración que nadie probaba");
  assert.ok(
    !/phase === "success"/.test(limpio),
    "🔴 aceptar un `success` del cliente es el desbloqueo gratuito: cinco fallos y un success dejan el contador en cero",
  );
  assert.ok(!/phase === "fail"/.test(limpio), "y un `fail` del cliente bloquea a cualquiera desde internet");

  // El intento lo hace el servidor, y el conteo cuelga de SU resultado.
  assert.match(limpio, /signInWithPassword\(\{ email, password \}\)/, "el endpoint autentica él mismo");
  assert.ok(
    limpio.indexOf("signInWithPassword") < limpio.indexOf("recordAuthFailure(req"),
    "el fallo se suma DESPUÉS de ver que GoTrue lo rechazó, no antes",
  );
  assert.match(limpio, /error \|\| !data\?\.session/, "sin sesión de vuelta no es un éxito");
  assert.ok(
    limpio.indexOf("recordAuthSuccess(req") > limpio.indexOf("signInWithPassword"),
    "y el borrado de contadores cuelga del intento real",
  );

  // El candado se mira ANTES de tocar GoTrue.
  assert.ok(
    limpio.indexOf("failbanGuard(req") < limpio.indexOf("signInWithPassword"),
    "un bloqueo que igualmente consulta al proveedor no es un bloqueo, es un retraso",
  );

  // Y no enumera correos: un solo texto para las tres formas de no entrar.
  assert.equal(
    (limpio.match(/EDU_LOGIN_MENSAJES\.credenciales/g) ?? []).length,
    1,
    "hay UN solo mensaje de «no entraste», escrito una vez",
  );
});

test("S-2 · el formulario dejó de hablar con GoTrue", () => {
  const limpio = sinComentarios(crudo(LOGIN_FORM));
  assert.ok(
    !/signInWithPassword/.test(limpio),
    "🔴 mientras el navegador autentique, el conteo depende de que él lo confiese",
  );
  assert.ok(!/phase:/.test(limpio), "ya no declara fases");
  assert.match(
    limpio,
    /body:\s*JSON\.stringify\(\{ email: correo, password \}\)/,
    "manda las credenciales al endpoint, que es quien ve el resultado",
  );
  // Un 429 sigue siendo el candado; cualquier otro fallo ya NO es fail-open,
  // porque ese endpoint es ahora el que autentica.
  assert.match(limpio, /intento\.status === 429/);
  assert.match(limpio, /if \(!intento\.ok\)/);
});

test("S-2 · el contador sigue siendo fail-open del lado del servidor", () => {
  const cuerpo = tramo(crudo(INTENTO), "export async function POST", "\n}\n");
  // Si Upstash no contesta, se deja pasar al intento: un problema de
  // infraestructura no puede dejar a una escuela entera en la puerta. Lo
  // que NO es fail-open es el intento en sí.
  assert.match(cuerpo, /try \{[\s\S]{0,200}failbanGuard[\s\S]{0,200}\} catch/);
  assert.match(cuerpo, /try \{[\s\S]{0,120}recordAuthFailure[\s\S]{0,200}\} catch/);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · #7 · UN .xlsx DE VERDAD TRAE NÚMEROS
// ═══════════════════════════════════════════════════════════════════════

test("#7 · el número de una celda se convierte a texto en matrícula y teléfono", () => {
  // 🔴 OLA C·fin 3 · ESTA PRUEBA MIRABA EL SITIO EQUIVOCADO. El `String(v)`
  // estaba en la lectura de la celda, que NO sabe qué columna está leyendo
  // —el mapeo se decide después—, así que convertía TODO: una fecha
  // autoformateada y un `#N/A` acababan pasando por nombre y por teléfono.
  // La conversión vive ahora donde ya se sabe el campo, y solo en los dos
  // donde un número es el dato de verdad. Lo que se comprueba de punta a
  // punta, contra un `.xlsx` escrito en la prueba, está en
  // edu-c-fin-3.test.ts.
  const aplica = sinComentarios(
    tramo(crudo(CORE_IMPORTAR), "export function eduImportAplicaMapeo", "function eduImportErrorDeExcel"),
  );
  assert.match(aplica, /EDU_IMPORT_CAMPOS_NUMERICOS\.has\(campo\) \? String\(v\) : v/);
  assert.match(
    sinComentarios(crudo(CORE_IMPORTAR)),
    /EDU_IMPORT_CAMPOS_NUMERICOS = new Set\(\["matricula", "phone"\]\)/,
    "una matrícula 20260001 y un teléfono 5544332211 llegan como number y los normalizadores cortan por tipo",
  );

  // Y la lectura de la celda ya NO aplana nada: la fecha sale como `Date` y
  // el error de Excel como el objeto que es, para poder marcarlos en rojo
  // con su motivo en vez de guardarlos como si fueran texto de alguien.
  const celda = sinComentarios(
    tramo(crudo(IMPORTAR), "function valorDeCelda", "async function hojaDelArchivo"),
  );
  assert.match(celda, /if \(v instanceof Date\) return v;/);
  assert.ok(
    !/cell\.text \|\| v/.test(celda),
    "`cell.text` de una fecha es `Date.toString()`: no aplica el numFmt y no es lo que Excel enseña",
  );
  assert.ok(
    !/String\(v\)/.test(celda),
    "convertir TODA celda a texto es lo que dejó pasar una cuenta con nombre de fecha",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · S-4 · EL RFC Y EL CONTRATO SON DE DIRECCIÓN
// ═══════════════════════════════════════════════════════════════════════

test("S-4 · el DTO del instituto se recorta con `sedes.manage`", () => {
  const src = crudo(INSTITUCION);
  const limpio = sinComentarios(src);

  assert.match(
    limpio,
    /hasEduPermission\([\s\S]{0,180}"sedes\.manage"/,
    "el recorte usa la MISMA llave con la que el propio vertical argumenta que el contrato es de dirección",
  );
  const getter = sinComentarios(
    tramo(src, "export async function getEduInstitucion", "export async function updateEduInstitucion"),
  );
  for (const campo of ["legalName", "rfc", "contractStartsAt", "contractEndsAt"]) {
    assert.match(
      getter,
      new RegExp(`${campo}:\\s*fiscales\\s*\\?`),
      `${campo} viaja a los cuatro roles: un alumno con curl leía el RFC de su escuela`,
    );
  }
  // Y se distingue «no te toca verlo» de «no hay»: si no, la pantalla
  // enseñaría un formulario vacío que borra el dato al guardar.
  assert.match(getter, /verDatosFiscales: fiscales/);
  // Sin rol no se enseña: ante la duda, la opción que no filtra.
  assert.match(limpio, /if \(!ctx\?\.role\) return false/);
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · CUMPLIMIENTO · ARCO, BITÁCORA Y LA CARRERA DE LA FUSIÓN
// ═══════════════════════════════════════════════════════════════════════

test("ARCO · la anonimización SÍ puede sacar el PII de la bitácora", () => {
  // El helper, ejecutado de verdad.
  const renglon = { folio: "P-0042", nombre: "María Rodríguez", phone: "5544332211" };
  const r = eduAuditRedactaClaves(renglon, EDU_ARCO_BITACORA_CLAVES, EDU_ARCO_REDACTED);
  assert.equal(r.cambios, 2, "se sustituyen nombre y teléfono");
  assert.equal(r.valor!.nombre, EDU_ARCO_REDACTED);
  assert.equal(r.valor!.phone, EDU_ARCO_REDACTED);
  // 🔴 El folio NO: la anonimización lo conserva prefijado porque es la
  // llave con la que la escuela encuentra el expediente en papel.
  assert.equal(r.valor!.folio, "P-0042");
  assert.ok(!EDU_ARCO_BITACORA_CLAVES.includes("folio"));

  // Idempotente: correrlo dos veces no cuenta dos veces ni cambia nada.
  const otra = eduAuditRedactaClaves(r.valor, EDU_ARCO_BITACORA_CLAVES, EDU_ARCO_REDACTED);
  assert.equal(otra.cambios, 0);
  assert.equal(otra.valor, null, "sin nada que redactar no hace falta reescribir el renglón");

  // Un renglón sin PII no se toca.
  assert.equal(
    eduAuditRedactaClaves({ version: 3, riskFlags: "anticoagulante" }, EDU_ARCO_BITACORA_CLAVES, EDU_ARCO_REDACTED)
      .cambios,
    0,
  );
});

test("ARCO · y el escritor de la bitácora sigue siendo UNO solo", () => {
  // La limpieza vive en auditoria.ts, no en arco.ts: esa tabla tiene un solo
  // escritor y hay una prueba de la ola que falla si alguien la escribe
  // desde otro archivo. Esta la vuelve a fijar desde el otro lado.
  assert.ok(!sinComentarios(crudo(ARCO)).includes("eduAuditLog"));
  assert.match(sinComentarios(crudo(ARCO)), /eduAuditAnonimizarPaciente\(/);
  assert.equal(
    (sinComentarios(crudo(AUDITORIA)).match(/eduAuditLog\.create/g) ?? []).length,
    1,
  );
});

test("ARCO · el perfil FISCAL se sustituye, y en la misma transacción que la ficha", () => {
  // El RFC identifica a una persona física y esto NO es un CFDI timbrado.
  assert.equal(EDU_ARCO_TAX_FIELDS.rfc, "XAXX010101000", "el RFC genérico del SAT cabe en VarChar(13)");
  assert.equal(String(EDU_ARCO_TAX_FIELDS.rfc).length, 13);
  assert.equal(EDU_ARCO_TAX_FIELDS.legalName, EDU_ARCO_REDACTED);
  assert.equal(EDU_ARCO_TAX_FIELDS.email, null);
  assert.equal(String(EDU_ARCO_TAX_FIELDS.zipCode).length, 5);

  const cuerpo = tramo(crudo(ARCO), "export async function anonymizeEduPatient", "\n// ═");
  const limpio = sinComentarios(cuerpo);
  assert.match(limpio, /prisma\.\$transaction/, "una ficha limpia con su RFC al lado es peor que no empezar");
  assert.match(limpio, /eduPatientTaxProfile\.updateMany/);
  assert.match(limpio, /institutionId/, "el where lleva el instituto, como toda escritura del vertical");
});

test("ARCO · la pantalla de confirmación ya no calla los cuatro campos que conserva", () => {
  for (const campo of [
    "familyHistory",
    "personalNonPathologicalHistory",
    "habitsNotes",
    "deleteReason",
  ]) {
    assert.ok(
      campo in EDU_ARCO_CONSERVADO,
      `${campo} se conserva y no se decía: la pantalla existe para que la confirmación no mienta`,
    );
    assert.ok(!(campo in EDU_ARCO_PII_FIELDS), `${campo} no puede estar en las dos listas`);
    assert.ok(EDU_ARCO_CONSERVADO[campo].length > 20);
  }
  // Y los dos de texto libre avisan de lo que llevan dentro.
  assert.match(EDU_ARCO_CONSERVADO.familyHistory, /madre y al padre/);
});

test("bitácora · entrada, salida y cambio de contraseña dejan renglón", () => {
  assert.ok((EDU_AUDIT_ACTIONS as readonly string[]).includes("login"));
  assert.ok((EDU_AUDIT_ACTIONS as readonly string[]).includes("logout"));
  assert.ok((EDU_AUDIT_ENTITIES as readonly string[]).includes("session"));
  // ⚠️ `campus` NO está: su escritor no puede escribirlo todavía, y una
  // entidad sin escritor es un filtro que siempre sale vacío.
  assert.ok(!(EDU_AUDIT_ENTITIES as readonly string[]).includes("campus"));

  assert.match(sinComentarios(crudo(SESSION)), /action: "login"/);
  assert.match(sinComentarios(crudo(LOGOUT)), /action: "logout"/);

  // En la salida, el renglón se escribe ANTES del signOut: después ya no hay
  // sesión y no sabría a quién atribuirse.
  const salida = sinComentarios(crudo(LOGOUT));
  assert.ok(salida.indexOf("eduAudit") < salida.indexOf("auth.signOut"));

  // Y los sucesos no se descartan por «no cambió nada».
  const escritor = sinComentarios(crudo(AUDITORIA));
  assert.match(escritor, /input\.action === "login" \|\| input\.action === "logout"/);
  assert.match(escritor, /if \(!esSuceso && cambios === 0\) return;/);
});

test("S-3 · cambiar la contraseña deja rastro y cierra las OTRAS sesiones", () => {
  const limpio = sinComentarios(crudo(CAMBIAR));
  assert.match(
    limpio,
    /signOut\(\{ scope: "others" \}\)/,
    "quien pasó por una sesión abierta se quedaba la cuenta y su sesión seguía viva",
  );
  assert.ok(
    !/scope: "global"/.test(limpio),
    "con «global» se echaría también a quien acaba de estrenarla, que es el caso normal",
  );
  assert.match(limpio, /eduAudit\(ctx, \{/, "179 líneas y cero renglones de bitácora");
  assert.match(limpio, /entity: "session"/);
  // 🔴 Y NO se guarda la contraseña, ni su longitud, ni una pista.
  assert.ok(!/password\.length/.test(limpio));
  assert.ok(
    !/after:\s*\{[^}]*password/.test(limpio),
    "en la bitácora va el HECHO, nunca la contraseña",
  );
});

test("fusión · el GANADOR también se comprueba dentro de la transacción", () => {
  const cuerpo = tramo(crudo(FUSION), "4 · Y EL PERDEDOR, marcado", "await eduAudit");
  const limpio = sinComentarios(cuerpo);
  // A→B y B→C simultáneas commiteaban las dos, y el expediente de A acababa
  // colgado de una ficha que en ese instante quedó fusionada.
  assert.match(
    limpio,
    /tx\.eduPatient\.count\(\{[\s\S]{0,220}mergedIntoId:\s*null[\s\S]{0,120}anonymizedAt:\s*null/,
    "el ganador se cuenta con las MISMAS condiciones con las que se le eligió",
  );
  assert.match(limpio, /ganadorSigue === 0/, "y si ya no vale, la transacción entera se deshace");
  assert.match(limpio, /409/);
});
