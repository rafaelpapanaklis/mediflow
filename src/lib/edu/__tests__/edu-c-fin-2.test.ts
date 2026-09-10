/**
 * OLA C·FIN 2 · WS2-T1 — LAS CINCO LÍNEAS DEL VEREDICTO.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-c-fin-2.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO
 *
 *   · #3 — el plan de tratamiento SIN caso tiene dueño, y cerrarlo (los dos
 *     estados terminales) pide ser ese dueño, su docente o la dirección.
 *   · #5 — la vigencia de un presupuesto es una FECHA CIVIL en la zona del
 *     instituto: vence al final de ESE día ahí, no a medianoche UTC.
 *   · y las tres líneas sueltas del mismo veredicto: la clave de
 *     idempotencia derivada que un cliente podía teclear, el mínimo de tres
 *     letras de «quién acepta» que solo exigía la pantalla, y la celda-fecha
 *     de un `.xlsx` que volvía a mentir con «Falta la matrícula».
 *
 * Lo que es LÓGICA PURA se ejecuta de verdad (la vigencia en dos zonas, con
 * su frontera de medianoche; la propiedad del plan con dos alumnos). Lo que
 * son `where` y puertas contra la base se comprueba LEYENDO LA FUENTE,
 * acotada al tramo de la función que le toca — el mismo camino que
 * edu-c-fin-seguridad.test.ts explica entero, y por el mismo motivo: son
 * funciones que abren una transacción de Prisma en la primera línea.
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  eduQuoteFinDelDia,
  eduQuoteLigaVigente,
  eduQuoteParseVigencia,
  eduQuoteVencido,
  eduQuoteVigenciaDiaISO,
  eduQuoteVigenciaPorDefecto,
  EDU_QUOTE_VIGENCIA_DIAS,
} from "@/lib/edu/presupuestos-core";
import { eduPlanEsMio, eduPlanPuedeCerrar } from "@/lib/edu/plan-tratamiento-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const crudo = (ruta: string): string => readFileSync(join(RAIZ, ...ruta.split("/")), "utf8");

/** El fuente SIN comentarios: este repo cita la forma PROHIBIDA para
 *  explicar por qué lo es, y sin quitarlos la prueba se dispara sola. */
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

const PLAN = "src/lib/edu/plan-tratamiento.ts";
const PRESU = "src/lib/edu/presupuestos.ts";
const CAJA = "src/lib/edu/caja.ts";
const IMPORTAR = "src/lib/edu/importar.ts";
const PANTALLA_PRESU = "src/components/edu/dinero/presupuestos-screen.tsx";
const PANTALLA_PUBLICA = "src/components/edu/dinero/presupuesto-publico.tsx";
const PANTALLA_PLAN = "src/components/edu/expediente/plan-screen.tsx";

const MX = "America/Mexico_City"; // UTC-6 todo el año desde 2022
const TJ = "America/Tijuana"; // UTC-7 en septiembre (sí cambia de horario)
const FIN = "\n/* FIN DEL ARCHIVO */";

// ═══════════════════════════════════════════════════════════════════════
// 1 · #5 · LA VIGENCIA ES UNA FECHA CIVIL — se ejecuta de verdad
// ═══════════════════════════════════════════════════════════════════════

test("#5 · «vence el 8» termina al final del día 8 EN LA ZONA DEL INSTITUTO", () => {
  const finMX = eduQuoteFinDelDia("2026-09-08", MX);
  const finTJ = eduQuoteFinDelDia("2026-09-08", TJ);
  const finUTC = eduQuoteFinDelDia("2026-09-08", "UTC");
  assert.ok(finMX && finTJ && finUTC);

  // Ciudad de México va seis horas por detrás de UTC: el día 8 termina a las
  // 05:59:59.999 del 9 en UTC. Tijuana, siete: una hora más tarde.
  assert.equal(finMX.toISOString(), "2026-09-09T05:59:59.999Z");
  assert.equal(finTJ.toISOString(), "2026-09-09T06:59:59.999Z");
  assert.equal(finUTC.toISOString(), "2026-09-08T23:59:59.999Z");

  // El mismo día civil, tres instantes distintos: eso es exactamente lo que
  // el bug no sabía. Y la zona que MÁS atrasa es la que más tarde vence.
  assert.ok(finTJ.getTime() > finMX.getTime());
  assert.ok(finMX.getTime() > finUTC.getTime());
});

test("#5 · la frontera de medianoche, en las dos zonas", () => {
  const presentado = (validUntil: Date | null) => ({ status: "PRESENTADO" as const, validUntil });

  const mx = presentado(eduQuoteFinDelDia("2026-09-08", MX));
  const tj = presentado(eduQuoteFinDelDia("2026-09-08", TJ));

  // ── El caso del veredicto, tal cual ────────────────────────────────
  // Las 18:00 del día 7 en México (medianoche UTC del 8) es justo cuando el
  // presupuesto se declaraba vencido con la regla vieja. Ahora no.
  assert.equal(eduQuoteVencido(mx, new Date("2026-09-08T00:00:00.000Z")), false);
  // Y el día 8 ENTERO tampoco: aquí son las cinco de la tarde en la escuela.
  assert.equal(eduQuoteVencido(mx, new Date("2026-09-08T23:00:00.000Z")), false);
  // El último segundo del día 8 en México: todavía vale.
  assert.equal(eduQuoteVencido(mx, new Date("2026-09-09T05:59:59.000Z")), false);
  // Y el primer instante del día 9 en México: se acabó.
  assert.equal(eduQuoteVencido(mx, new Date("2026-09-09T06:00:00.000Z")), true);

  // ── Las dos zonas discrepan, y eso es lo correcto ──────────────────
  // A las 06:30Z del 9 son las 00:30 del día 9 en México (vencido) y las
  // 23:30 del día 8 en Tijuana (vigente). El mismo texto, «vence el 8»,
  // significa dos instantes porque son dos calendarios.
  const entreLasDos = new Date("2026-09-09T06:30:00.000Z");
  assert.equal(eduQuoteVencido(mx, entreLasDos), true);
  assert.equal(eduQuoteVencido(tj, entreLasDos), false);

  // 🔴 Y LA REGLA ES LA MISMA EN LA LIGA PÚBLICA (el 404) que en el
  // mostrador (el 409): `eduQuoteLigaVigente` no tiene su propia copia.
  for (const ahora of [
    new Date("2026-09-08T00:00:00.000Z"),
    new Date("2026-09-09T05:59:59.000Z"),
    new Date("2026-09-09T06:00:00.000Z"),
    entreLasDos,
  ]) {
    assert.equal(
      eduQuoteLigaVigente({ ...mx, chargeId: null }, ahora),
      !eduQuoteVencido(mx, ahora),
      "la liga pública y el 409 del mostrador tienen que decir lo mismo",
    );
  }
});

test("#5 · «2026-09-08» y su ISO completo significan LO MISMO", () => {
  const soloDia = eduQuoteParseVigencia("2026-09-08", MX);
  const isoLargo = eduQuoteParseVigencia("2026-09-08T00:00:00.000Z", MX);
  const conHora = eduQuoteParseVigencia("2026-09-08T18:45:00-06:00", MX);
  assert.ok(soloDia);
  assert.equal(isoLargo?.toISOString(), soloDia.toISOString());
  assert.equal(conHora?.toISOString(), soloDia.toISOString());

  // Lo que no se entiende se rebota, y el llamador contesta 400. Un
  // `new Date("mañana")` daba Invalid Date y se guardaba igual en una rama.
  assert.equal(eduQuoteParseVigencia("mañana", MX), null);
  assert.equal(eduQuoteParseVigencia("2026-02-31", MX), null);
  assert.equal(eduQuoteParseVigencia("", MX), null);
  assert.equal(eduQuoteParseVigencia(null, MX), null);
});

test("#5 · el rótulo «vence el…» sale del día del INSTITUTO, no del de UTC", () => {
  const fin = eduQuoteFinDelDia("2026-09-08", MX)!;
  assert.equal(eduQuoteVigenciaDiaISO(fin, MX), "2026-09-08");
  // 🔴 Y ÉSTE ES EL MOTIVO DE QUE EXISTA: recortar el ISO a diez caracteres
  // —lo que hacían las dos pantallas— pinta el día SIGUIENTE.
  assert.equal(fin.toISOString().slice(0, 10), "2026-09-09");
  assert.equal(eduQuoteVigenciaDiaISO(null, MX), null);
});

test("#5 · la vigencia por defecto también es un día civil, no un instante", () => {
  // Dos presentaciones el MISMO día del instituto, una por la mañana y otra
  // por la noche. Con `now + 30 días` vencían en días distintos y el rótulo
  // decía lo mismo en las dos.
  const manana = eduQuoteVigenciaPorDefecto(new Date("2026-09-08T15:00:00.000Z"), MX);
  const noche = eduQuoteVigenciaPorDefecto(new Date("2026-09-09T02:00:00.000Z"), MX);
  assert.equal(manana.toISOString(), noche.toISOString());
  assert.equal(eduQuoteVigenciaDiaISO(manana, MX), "2026-10-08");
  assert.equal(EDU_QUOTE_VIGENCIA_DIAS, 30);
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · #5 · Y LA REGLA ESTÁ ENCHUFADA EN LAS TRES PUERTAS — fuente
// ═══════════════════════════════════════════════════════════════════════

test("#5 · los tres sitios que GUARDAN la vigencia la normalizan a la zona", () => {
  const src = crudo(PRESU);
  for (const [fn, hasta] of [
    ["export async function updateEduQuote", "export async function createEduQuote"],
    ["export async function createEduQuote", "export async function presentarEduQuote"],
    ["export async function presentarEduQuote", "export async function cambiarEstadoEduQuote"],
  ] as const) {
    const cuerpo = sinComentarios(tramo(src, fn, hasta));
    assert.match(
      cuerpo,
      /eduQuoteParseVigencia\(/,
      `${fn} guarda la vigencia sin pasarla por la zona del instituto`,
    );
    assert.ok(
      !/new Date\(String\(body\.validUntil\)\)/.test(cuerpo),
      `${fn} sigue haciendo new Date() sobre la fecha del cliente: eso es medianoche UTC`,
    );
  }
  // La vigencia por defecto también lleva zona.
  const presentar = sinComentarios(
    tramo(src, "export async function presentarEduQuote", "export async function cambiarEstadoEduQuote"),
  );
  assert.match(presentar, /eduQuoteVigenciaPorDefecto\(now, tz\)/);
});

test("#5 · la liga pública rotula con la zona del instituto, y solo pide la zona", () => {
  const cuerpo = tramo(
    crudo(PRESU),
    "export async function getEduQuotePorToken",
    "export async function aceptarEduQuotePorToken",
  );
  const limpio = sinComentarios(cuerpo);
  assert.match(
    limpio,
    /institution:\s*\{\s*select:\s*\{\s*timezone:\s*true\s*\}\s*\}/,
    "sin la zona no se puede rotular el día, y del instituto NO sale nada más por esta puerta",
  );
  assert.match(limpio, /validUntilDia:\s*eduQuoteVigenciaDiaISO\(/);
});

test("#5 · ninguna pantalla vuelve a recortar el ISO de la vigencia", () => {
  for (const ruta of [PANTALLA_PRESU, PANTALLA_PUBLICA]) {
    const limpio = sinComentarios(crudo(ruta));
    assert.ok(
      !/validUntil\??\.slice\(0,\s*10\)/.test(limpio),
      `${ruta} recorta el instante a diez caracteres: eso pinta el día en UTC`,
    );
    assert.match(limpio, /validUntilDia/, `${ruta} tiene que pintar el día que manda el servidor`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · #3 · EL PLAN «SIN CASO» — dos alumnos, ejecutado de verdad
// ═══════════════════════════════════════════════════════════════════════

test("#3 · dos alumnos y un plan SIN caso: es de quien lo armó", () => {
  const ANA = "u-ana";
  const BETO = "u-beto";

  // El plan que Beto abrió sin colgarlo de ningún caso — que es lo que el
  // formulario elegía solo cuando el paciente tiene DOS casos.
  const sinCaso = { caseId: null, createdById: BETO, case: null };
  assert.equal(eduPlanEsMio(sinCaso, BETO), true);
  assert.equal(eduPlanEsMio(sinCaso, ANA), false, "el plan sin caso NO es de todo el que comparta paciente");

  // Y el que sí cuelga de un caso sigue siendo del alumno del caso, aunque
  // lo haya tecleado otra persona (el docente que lo armó con él delante).
  const conCaso = { caseId: "c-1", createdById: "u-docente", case: { student: { userId: ANA } } };
  assert.equal(eduPlanEsMio(conCaso, ANA), true);
  assert.equal(eduPlanEsMio(conCaso, BETO), false);
  assert.equal(eduPlanEsMio(conCaso, "u-docente"), false, "quien lo teclea no se queda con el plan");

  // Un plan cuyo autor se dio de baja (`createdById` null por el SetNull) no
  // es de nadie: lo cierra la dirección. Falla del lado cerrado.
  assert.equal(eduPlanEsMio({ caseId: null, createdById: null, case: null }, BETO), false);
  assert.equal(eduPlanEsMio(sinCaso, ""), false);
});

test("#3 · COMPLETADO y ABANDONADO dejan de ser terminales de cualquiera", () => {
  // ── El daño del hallazgo: Ana cerrando el plan de Beto ─────────────
  assert.equal(eduPlanPuedeCerrar("ALUMNO", false, "COMPLETADO"), false);
  assert.equal(eduPlanPuedeCerrar("ALUMNO", false, "ABANDONADO"), false);

  // ── Lo que SÍ tiene que seguir pudiendo hacer un alumno ────────────
  // Terminar SU plan es la conclusión normal de su trabajo.
  assert.equal(eduPlanPuedeCerrar("ALUMNO", true, "COMPLETADO"), true);
  // Abandonarlo no, ni el suyo: no se reabre nunca. Esto ya era así y sigue.
  assert.equal(eduPlanPuedeCerrar("ALUMNO", true, "ABANDONADO"), false);
  // Pausar y reanudar no cierran nada y no piden nada.
  assert.equal(eduPlanPuedeCerrar("ALUMNO", false, "PAUSADO"), true);
  assert.equal(eduPlanPuedeCerrar("ALUMNO", false, "ACTIVO"), true);

  // ── Docente y dirección cierran los dos ────────────────────────────
  for (const rol of ["DOCENTE", "DIRECCION"]) {
    assert.equal(eduPlanPuedeCerrar(rol, false, "COMPLETADO"), true);
    assert.equal(eduPlanPuedeCerrar(rol, false, "ABANDONADO"), true);
  }

  // ⚠️ Un rol que no existe todavía cae del lado cerrado, como el resto del
  // vertical: la respuesta por defecto no puede ser «puede».
  assert.equal(eduPlanPuedeCerrar("RECTOR", false, "COMPLETADO"), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · #3 · Y EL `where` LO LLEVA — fuente
// ═══════════════════════════════════════════════════════════════════════

test("#3 · la rama «sin caso» del alcance pide paciente Y dueño", () => {
  const helper = sinComentarios(
    tramo(crudo(PLAN), "function eduPlanScopeWhere", "export interface EduPlanRow"),
  );
  // Lo que ya estaba y no se toca.
  assert.match(helper, /eduClinicalScope\(ctx\)/);
  assert.match(helper, /eduCaseScopeWhere\(\{ institutionId, scope, now \}\)/);
  assert.match(helper, /id:\s*\{\s*in:\s*\[\]\s*\}/);

  // 🔴 Lo nuevo: `caseId: null` ya no viaja SOLO. El paciente en el alcance
  // de quien mira, y el dueño del plan.
  assert.ok(
    !/OR:\s*\[\{\s*caseId:\s*null\s*\}/.test(helper),
    "la rama `{ caseId: null }` a secas es el hallazgo: abre el plan a cualquiera del paciente",
  );
  assert.match(helper, /caseId:\s*null,\s*patient:\s*eduPatientScopeWhere\(/);
  assert.match(helper, /createdById:\s*scope\.studentUserId/);
  // Y el docente ve los de sus alumnos VIGENTES, con el helper del vertical
  // y no con una copia local del predicado de vigencia.
  assert.match(helper, /createdBy:\s*\{\s*studentProfile:\s*eduStudentScopeWhere\(/);
});

test("#3 · las cuatro puertas del plan siguen llevando el recorte", () => {
  const src = crudo(PLAN) + FIN;
  for (const [fn, hasta] of [
    ["export async function listEduPlanes", "export async function createEduPlan"],
    ["export async function marcarEduPlanSesion", "export async function cambiarEstadoEduPlan"],
    ["export async function cambiarEstadoEduPlan", FIN],
  ] as const) {
    const cuerpo = sinComentarios(tramo(src, fn, hasta));
    assert.match(
      cuerpo,
      /eduPlanScopeWhere\(ctx, institutionId, now\)/,
      `${fn} lee o escribe el plan sin el recorte: es el plan de OTRO alumno`,
    );
  }
  // El `updateMany` del cierre lo lleva TAMBIÉN, no solo la lectura de antes.
  const cerrar = sinComentarios(tramo(src, "export async function cambiarEstadoEduPlan", FIN));
  assert.equal(
    (cerrar.match(/eduPlanScopeWhere\(ctx, institutionId, now\)/g) ?? []).length,
    2,
    "el alcance viaja a la lectura Y a la escritura del cierre",
  );
});

test("#3 · el candado del cierre está sobre el dato leído, no solo en el where", () => {
  const cerrar = sinComentarios(
    tramo(crudo(PLAN) + FIN, "export async function cambiarEstadoEduPlan", FIN),
  );
  // El plan se lee con lo que hace falta para saber de quién es.
  assert.match(cerrar, /caseId:\s*true/);
  assert.match(cerrar, /createdById:\s*true/);
  assert.match(cerrar, /case:\s*\{\s*select:\s*\{\s*student:\s*\{\s*select:\s*\{\s*userId:\s*true/);
  // Y los dos candados, en el orden que deja salir el mensaje útil primero.
  const iAband = cerrar.indexOf('destino === "ABANDONADO" && ctx.role !== "DIRECCION"');
  const iCierra = cerrar.indexOf("eduPlanPuedeCerrar(ctx.role");
  assert.ok(iAband >= 0, "abandonar un plan sigue pidiendo DOCENTE o DIRECCIÓN");
  assert.ok(iCierra > iAband, "el candado general va después: si no, tapa el mensaje de ABANDONADO");
  assert.match(cerrar, /403/);
});

test("#3 · la pantalla no ofrece un botón que el servidor va a rebotar", () => {
  const limpio = sinComentarios(crudo(PANTALLA_PLAN));
  // La MISMA función del core que usa el servidor: dos copias de la regla
  // son dos sitios donde discrepar.
  assert.match(limpio, /eduPlanPuedeCerrar\(props\.role, plan\.esMio, d\)/);
  // Y el formulario ya no elige «sin caso» por su cuenta cuando hay dos.
  assert.ok(
    !/useState\(casos\.length === 1 \? casos\[0\]\.id : ""\)/.test(limpio),
    "con dos casos el valor por defecto era «Sin caso»: la pantalla elegía sola la opción desprotegida",
  );
  assert.match(limpio, /casos\.length === 0 \? SIN_CASO : SIN_ELEGIR/);
  assert.match(limpio, /caseId === SIN_ELEGIR/, "no se puede guardar sin decidir");
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · LAS TRES LÍNEAS SUELTAS DEL MISMO VEREDICTO
// ═══════════════════════════════════════════════════════════════════════

test("la clave de idempotencia de una conversión no la puede teclear un cliente", () => {
  const caja = sinComentarios(crudo(CAJA));
  // Se deriva del presupuesto DENTRO de caja, y con un separador que el
  // parser del cliente rechaza: así nadie puede crear antes un cobro manual
  // con esa clave para que la conversión se lo devuelva como «duplicado».
  assert.match(caja, /options\.quoteId\s*\n?\s*\?\s*`presupuesto:\$\{options\.quoteId\}`/);
  assert.match(
    caja,
    /\/\^\[A-Za-z0-9_-\]\+\$\//,
    "el parser del cliente sigue sin aceptar «:», que es lo que hace la clave inalcanzable",
  );
  // Y presupuestos.ts ya no la manda por el body.
  assert.ok(
    !/idempotencyKey:\s*`presupuesto-\$\{q\.id\}`/.test(sinComentarios(crudo(PRESU))),
    "la clave adivinable tiene que haber desaparecido, no quedarse comentada",
  );
});

test("«quién acepta» pide tres letras también en el servidor", () => {
  const cuerpo = sinComentarios(
    tramo(crudo(PRESU), "export async function cambiarEstadoEduQuote", "export interface EduQuotePdfData"),
  );
  assert.match(cuerpo, /quien\.trim\(\)\.length < 3/);
  assert.match(cuerpo, /400/);
  assert.ok(
    !/quien \?\? "el paciente"/.test(cuerpo),
    "el respaldo «el paciente» registraba una aceptación sin nombre: ya no hay respaldo, hay 400",
  );
  // Y la pantalla exige lo mismo que antes: las dos puertas, la misma regla.
  assert.match(sinComentarios(crudo(PANTALLA_PRESU)), /aceptante\.trim\(\)\.length < 3/);
});

test("una celda-fecha de un .xlsx NO se aplana a texto: se rebota con su motivo", () => {
  // 🔴 OLA C·fin 3 · ESTA PRUEBA PEDÍA LO CONTRARIO, y pedía mal. Lo que
  // afirmaba —que `cell.text` devuelve «lo que Excel enseña en la celda»—
  // es falso: para una fecha es `Date.toString()` y NO aplica el `numFmt`
  // de la celda, así que salía «Sun Mar 22 2026 00:00:00 GMT+0000 (…)».
  // Eso no arreglaba la matrícula (62 caracteres > 30) y en cambio pasaba
  // por el nombre (62 ≤ 80) y por el teléfono, creando una cuenta de
  // Supabase con nombre de fecha y un teléfono inventado. El comportamiento
  // que sí se quiere se ejecuta contra un `.xlsx` de verdad en
  // edu-c-fin-3.test.ts; aquí se deja fijada la forma que no puede volver.
  const limpio = sinComentarios(crudo(IMPORTAR));
  assert.match(limpio, /if \(v instanceof Date\) return v;/);
  assert.ok(
    !/cell\.text \|\| v/.test(limpio),
    "`cell.text` de una fecha es Date.toString(): aplanarla ahí es inventarse un formato",
  );
});
