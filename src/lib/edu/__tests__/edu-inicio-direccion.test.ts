/**
 * EL INICIO DE LA DIRECCIÓN — las tres series por día.
 *
 * Run:  npm run test:edu
 *       (o npx tsx --test src/lib/edu/__tests__/edu-inicio-direccion.test.ts)
 *
 * Todo SIN base de datos: lo puro sale de direccion-core.ts y de
 * visibility.ts, y lo que solo se puede comprobar leyendo el servidor
 * —que las consultas de este tablero armen su `where` con el alcance y no
 * a mano— se comprueba leyendo el archivo, igual que ya hace
 * edu-direccion.test.ts con las quince listas de detalle.
 *
 * Lo que fija este archivo:
 *  1. que la serie traiga TODOS los días del periodo, incluidos los que no
 *     tuvieron nada — una gráfica que se salta los domingos cerrados
 *     dibuja una clínica que trabaja siete días;
 *  2. que el día de cada fila se decida en la zona del INSTITUTO y no en
 *     la del servidor;
 *  3. 🔴 que el total NO se deduzca sumando las barras cuando la cifra
 *     cuenta PERSONAS: quien vino dos días suma dos barras y un total;
 *  4. 🔴 que un DOCENTE, un ESTUDIANTE y CAJA no reciban estas series;
 *  5. 🔴 que las series que cuelgan de un edificio respeten la SEDE, y que
 *     la que no cuelga de ninguno lo DIGA en vez de inventarse una;
 *  6. que la variación contra el periodo anterior sea la MISMA cuenta que
 *     usa el tablero de Dirección, con su regla de no inventar
 *     porcentajes — y que en dinero se ESCRIBA en dinero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_DIR_INICIO_PERIODOS,
  EDU_DIR_INICIO_PERIODO_DEFAULT,
  EDU_DIR_FIRMA_VIEJA_MIN,
  EDU_DIR_MAX_DIAS,
  EDU_DIR_SERIE_KEYS,
  eduDirArmarSerie,
  eduDirDiaDe,
  eduDirDiasDeVentana,
  eduDirEtiquetaDeDia,
  eduDirMaximoPuntos,
  eduDirPuntosPorDia,
  eduDirSemaforoDeFirmas,
  eduDirSumaPuntos,
  eduDirVariacion,
  eduDirVariacionEn,
  eduDirVentana,
  parseEduDirInicioPeriodo,
} from "../direccion-core";
import {
  eduAppointmentScopeWhere,
  eduChargeScopeWhere,
  eduPuedeVerLaClinicaEntera,
  EDU_CLINICA_ENTERA_NONE_DETAIL,
} from "../visibility";
import type { EduRole } from "../types";

const TZ = "America/Mexico_City";
/** Lunes 31 de agosto de 2026, 12:00 en Ciudad de México (18:00 UTC). */
const AHORA = new Date("2026-08-31T18:00:00.000Z");
const INST = "inst_1";

const actor = (role: EduRole) => ({ role, eduUserId: "u_1" });

// ─────────────────────────────────────────────────────────────────────
// 1 · El conmutador semana / mes
// ─────────────────────────────────────────────────────────────────────

test("el conmutador del Inicio tiene DOS posiciones, y «hoy» no es una de ellas", () => {
  assert.deepEqual([...EDU_DIR_INICIO_PERIODOS], ["semana", "mes"]);
  assert.equal(EDU_DIR_INICIO_PERIODO_DEFAULT, "semana");
});

test("«hoy» y «rango» son legales en Dirección y aquí caen a la semana", () => {
  // Los dos son valores VÁLIDOS de parseEduDirPeriodo: si el Inicio
  // reusara ese parser sin más, un enlace desde el tablero dejaría una
  // gráfica de UNA barra.
  assert.equal(parseEduDirInicioPeriodo("hoy"), "semana");
  assert.equal(parseEduDirInicioPeriodo("rango"), "semana");
  assert.equal(parseEduDirInicioPeriodo("mes"), "mes");
  assert.equal(parseEduDirInicioPeriodo("semana"), "semana");
  assert.equal(parseEduDirInicioPeriodo(null), "semana");
  assert.equal(parseEduDirInicioPeriodo(["mes"]), "semana");
  assert.equal(parseEduDirInicioPeriodo("MES"), "mes");
});

test("las tres gráficas son las tres que pide la pantalla, en orden", () => {
  assert.deepEqual([...EDU_DIR_SERIE_KEYS], ["pacientes", "cobrado", "autorizaciones"]);
});

// ─────────────────────────────────────────────────────────────────────
// 2 · Los días del periodo: TODOS
// ─────────────────────────────────────────────────────────────────────

test("la semana son SIETE días consecutivos que terminan hoy", () => {
  const v = eduDirVentana({ periodo: "semana" }, TZ, AHORA);
  const dias = eduDirDiasDeVentana(v.desdeISO, v.dias);
  assert.equal(dias.length, 7);
  assert.equal(dias[0], "2026-08-25");
  assert.equal(dias[6], "2026-08-31");
});

test("el mes son TREINTA días consecutivos que terminan hoy", () => {
  const v = eduDirVentana({ periodo: "mes" }, TZ, AHORA);
  const dias = eduDirDiasDeVentana(v.desdeISO, v.dias);
  assert.equal(dias.length, 30);
  assert.equal(dias[0], "2026-08-02");
  assert.equal(dias[29], "2026-08-31");
});

test("los días llevan el MISMO tope que la ventana: nadie puede pedir mil barras", () => {
  const dias = eduDirDiasDeVentana("2026-01-01", 5000);
  assert.equal(dias.length, EDU_DIR_MAX_DIAS);
});

test("un día SIN datos vale cero y se pinta igual (el domingo cerrado existe)", () => {
  const valores = new Map([
    ["2026-08-25", 4],
    ["2026-08-27", 6],
  ]);
  const puntos = eduDirPuntosPorDia("2026-08-25", 7, valores);
  assert.equal(puntos.length, 7);
  assert.deepEqual(
    puntos.map((p) => p.value),
    [4, 0, 6, 0, 0, 0, 0],
  );
  // Y los días vacíos son días de verdad, con su fecha y su etiqueta.
  assert.equal(puntos[1].dayISO, "2026-08-26");
  assert.ok(puntos[1].label.length > 0);
  assert.ok(puntos[1].largo.includes("2026"));
});

test("una clave FUERA del periodo no se cuela en la primera ni en la última barra", () => {
  const valores = new Map([
    ["2026-08-24", 99], // el día anterior al periodo
    ["2026-09-01", 99], // el siguiente
    ["2026-08-25", 3],
  ]);
  const puntos = eduDirPuntosPorDia("2026-08-25", 7, valores);
  assert.equal(eduDirSumaPuntos(puntos), 3);
  assert.equal(puntos[0].value, 3);
});

test("sin valores, la serie entera es cero y su máximo es cero (no se cae)", () => {
  const puntos = eduDirPuntosPorDia("2026-08-25", 7, null);
  assert.equal(eduDirSumaPuntos(puntos), 0);
  assert.equal(eduDirMaximoPuntos(puntos), 0);
});

test("la etiqueta del eje es CORTA: cabe con 30 barras y no repite el mes", () => {
  assert.equal(eduDirEtiquetaDeDia("2026-08-25"), "Mar 25");
  assert.equal(eduDirEtiquetaDeDia("2026-08-30"), "Dom 30");
  assert.equal(eduDirEtiquetaDeDia("basura"), "—");
  // La fecha COMPLETA sigue estando: es la del globo del ratón.
  const p = eduDirPuntosPorDia("2026-08-25", 1, null)[0];
  assert.equal(p.label, "Mar 25");
  assert.ok(p.largo.includes("agosto") && p.largo.includes("2026"), p.largo);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · El día se decide en la zona del INSTITUTO
// ─────────────────────────────────────────────────────────────────────

test("un pago de las 19:00 en México es de HOY, no de mañana (que es lo que diría UTC)", () => {
  // 2026-08-31 19:00 en CDMX = 2026-09-01 01:00 UTC.
  const instante = new Date("2026-09-01T01:00:00.000Z");
  assert.equal(eduDirDiaDe(instante, TZ), "2026-08-31");
  assert.equal(eduDirDiaDe(instante, "UTC"), "2026-09-01");
});

test("una fecha ilegible no se cuenta en NINGÚN día (antes que en el equivocado)", () => {
  assert.equal(eduDirDiaDe(null, TZ), null);
  assert.equal(eduDirDiaDe(undefined, TZ), null);
  assert.equal(eduDirDiaDe(new Date("no soy una fecha"), TZ), null);
});

test("una zona horaria inventada cae a UTC en vez de reventar la portada", () => {
  assert.equal(eduDirDiaDe(new Date("2026-09-01T01:00:00.000Z"), "Marte/Olympus"), "2026-09-01");
});

// ─────────────────────────────────────────────────────────────────────
// 4 · La serie armada
// ─────────────────────────────────────────────────────────────────────

const serieDe = (valores: [string, number][], total: number, anterior: number) =>
  eduDirArmarSerie({
    key: "pacientes",
    titulo: "Pacientes atendidos",
    detalle: "d",
    unidad: "conteo",
    puntos: eduDirPuntosPorDia("2026-08-25", 7, new Map(valores)),
    total,
    anterior,
  });

test("🔴 el total NO es la suma de las barras cuando la cifra cuenta PERSONAS", () => {
  // La misma persona vino el martes y el jueves: dos barras de 1, y UNA
  // sola persona en el total. Si eduDirArmarSerie dedujera el total
  // sumando, diría 2 y contradiría a la tarjeta del tablero de Dirección.
  const s = serieDe(
    [
      ["2026-08-26", 1],
      ["2026-08-28", 1],
    ],
    1,
    0,
  );
  assert.equal(eduDirSumaPuntos(s.puntos), 2);
  assert.equal(s.total, 1);
  assert.equal(s.totalLabel, "1");
});

test("en dinero el total se formatea como dinero y el máximo sale de las barras", () => {
  const s = eduDirArmarSerie({
    key: "cobrado",
    titulo: "Dinero cobrado",
    detalle: "d",
    unidad: "dinero",
    puntos: eduDirPuntosPorDia("2026-08-25", 7, new Map([["2026-08-27", 123456]])),
    total: 123456,
    anterior: 0,
  });
  assert.ok(s.totalLabel.includes("1,234.56"), s.totalLabel);
  assert.equal(s.maximo, 123456);
});

test("un día NEGATIVO (se devolvió más de lo que entró) no se tapa en cero", () => {
  const puntos = eduDirPuntosPorDia("2026-08-25", 7, new Map([["2026-08-27", -5000]]));
  assert.equal(puntos[2].value, -5000);
  assert.equal(eduDirSumaPuntos(puntos), -5000);
  // El máximo de una serie que solo baja es 0: no hay barra hacia arriba.
  assert.equal(eduDirMaximoPuntos(puntos), 0);
});

test("un total o un anterior que no son números no envenenan la serie", () => {
  const s = serieDe([["2026-08-25", 2]], Number.NaN, Number.POSITIVE_INFINITY);
  assert.equal(s.total, 0);
  assert.equal(s.anterior, 0);
  assert.equal(s.variacion.pct, null);
});

// ─────────────────────────────────────────────────────────────────────
// 5 · La variación contra el periodo anterior
// ─────────────────────────────────────────────────────────────────────

test("la variación de la serie es la MISMA cuenta del tablero, no una copia", () => {
  const s = serieDe([["2026-08-25", 20]], 20, 16);
  assert.deepEqual(s.variacion, eduDirVariacion(20, 16));
  assert.equal(s.variacion.pct, 25);
  assert.equal(s.variacion.sentido, 1);
  assert.ok(s.variacion.texto.includes("16 → 20"));
});

test("🔴 con CERO en el periodo anterior no se inventa un porcentaje", () => {
  const s = serieDe([["2026-08-25", 7]], 7, 0);
  assert.equal(s.variacion.pct, null);
  assert.equal(s.variacion.delta, 7);
  assert.ok(!s.variacion.texto.includes("%"), s.variacion.texto);
});

test("cero contra cero no es una caída: se dice que no hubo nada en ninguno", () => {
  const s = serieDe([], 0, 0);
  assert.equal(s.variacion.pct, null);
  assert.equal(s.variacion.sentido, 0);
  assert.ok(s.variacion.texto.includes("igual"), s.variacion.texto);
});

test("🔴 la variación del DINERO se escribe en dinero, no en centavos pelados", () => {
  // "(0 → 842300)" se lee como ochocientos cuarenta y dos mil pesos cuando
  // son ocho mil cuatrocientos veintitrés.
  const sube = eduDirArmarSerie({
    key: "cobrado",
    titulo: "t",
    detalle: "d",
    unidad: "dinero",
    puntos: [],
    total: 842300,
    anterior: 0,
  });
  assert.ok(!sube.variacion.texto.includes("842300"), sube.variacion.texto);
  assert.ok(sube.variacion.texto.includes("8,423.00"), sube.variacion.texto);

  const baja = eduDirArmarSerie({
    key: "cobrado",
    titulo: "t",
    detalle: "d",
    unidad: "dinero",
    puntos: [],
    total: 500000,
    anterior: 1000000,
  });
  assert.equal(baja.variacion.pct, -50);
  assert.ok(baja.variacion.texto.includes("10,000.00"), baja.variacion.texto);
  assert.ok(baja.variacion.texto.includes("5,000.00"), baja.variacion.texto);
  assert.ok(!/\b1000000\b/.test(baja.variacion.texto), baja.variacion.texto);
});

test("la ARITMÉTICA de la variación no cambia por cambiar la unidad", () => {
  const casos: [number, number][] = [
    [20, 16],
    [0, 0],
    [7, 0],
    [5, 10],
  ];
  for (const [a, b] of casos) {
    const conteo = eduDirVariacionEn(a, b, "conteo");
    const dinero = eduDirVariacionEn(a, b, "dinero");
    assert.deepEqual(conteo, eduDirVariacion(a, b));
    assert.equal(dinero.pct, conteo.pct);
    assert.equal(dinero.delta, conteo.delta);
    assert.equal(dinero.sentido, conteo.sentido);
  }
});

test("el periodo anterior es del MISMO largo y está pegado por la izquierda", () => {
  for (const periodo of EDU_DIR_INICIO_PERIODOS) {
    const v = eduDirVentana({ periodo }, TZ, AHORA);
    const actual = v.to.getTime() - v.from.getTime();
    const previo = v.prevTo.getTime() - v.prevFrom.getTime();
    assert.equal(actual, previo, periodo);
    assert.equal(v.prevTo.getTime(), v.from.getTime(), periodo);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 6 · 🔴 QUIÉN RECIBE LAS SERIES
//
// El Inicio de dirección enseña TOTALES —el dinero de la escuela, cuántas
// personas se atendieron—, así que no se puede recortar: un total
// recortado presentado como el total es un dato falso. Se NIEGA.
// ─────────────────────────────────────────────────────────────────────

test("🔴 solo DIRECCIÓN ve la clínica entera: docente, estudiante y caja NO", () => {
  assert.equal(eduPuedeVerLaClinicaEntera(actor("DIRECCION")), true);
  assert.equal(eduPuedeVerLaClinicaEntera(actor("DOCENTE")), false);
  assert.equal(eduPuedeVerLaClinicaEntera(actor("ALUMNO")), false);
  // Caja ve pacientes, agenda y dinero, pero NO casos: sin casos no se
  // puede decir "tratamientos autorizados" sin que salga un cero que se
  // lee como "esta semana no se autorizó nada".
  assert.equal(eduPuedeVerLaClinicaEntera(actor("CAJA")), false);
});

test("un actor inventado o roto no ve la clínica entera", () => {
  assert.equal(eduPuedeVerLaClinicaEntera({ role: "RECTOR" as EduRole, eduUserId: "u" }), false);
  assert.equal(
    eduPuedeVerLaClinicaEntera(null as unknown as { role: EduRole; eduUserId: string }),
    false,
  );
  // Un DOCENTE sin id de usuario tampoco: sin id no hay a quién atribuir
  // nada, y "todos" sería la respuesta equivocada.
  assert.equal(eduPuedeVerLaClinicaEntera({ role: "DOCENTE", eduUserId: "" }), false);
});

test("el motivo del 403 lo escribe visibility.ts UNA vez, para las dos pantallas", () => {
  assert.ok(EDU_CLINICA_ENTERA_NONE_DETAIL.includes("clínica ENTERA"));
  const servidor = leerServidor();
  // El tablero de Dirección y el Inicio lanzan el MISMO texto, importado.
  assert.ok(
    servidor.includes("EDU_CLINICA_ENTERA_NONE_DETAIL"),
    "direccion.ts dejó de usar el motivo del punto único",
  );
  assert.ok(
    !/tiene sentido para quien la ve entera/.test(servidor),
    "direccion.ts volvió a escribir el motivo a mano en vez de importarlo",
  );
});

// ─────────────────────────────────────────────────────────────────────
// 7 · 🔴 LA SEDE
//
// Lo que cuelga de un EDIFICIO se recorta (citas por su sillón, cobros por
// la columna que se selló al emitir). Lo ACADÉMICO no: un estudiante rota
// entre sedes y su expediente es uno solo.
// ─────────────────────────────────────────────────────────────────────

test("con una sede elegida, las CITAS se recortan por el sillón de esa sede", () => {
  const where = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "all" },
    now: AHORA,
    campusIds: ["camp_norte"],
  });
  assert.equal(where.institutionId, INST);
  assert.deepEqual(where.chair, { institutionId: INST, campusId: { in: ["camp_norte"] } });
});

test("con una sede elegida, los COBROS se recortan por su columna de sede", () => {
  const where = eduChargeScopeWhere({
    institutionId: INST,
    scope: { kind: "all" },
    campusIds: ["camp_norte"],
  });
  assert.deepEqual(where.campusId, { in: ["camp_norte"] });
});

test("sin sedes dadas de alta (null) NADA se recorta: el tablero es el de siempre", () => {
  const citas = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "all" },
    now: AHORA,
    campusIds: null,
  });
  assert.equal(citas.chair, undefined);
  const cobros = eduChargeScopeWhere({
    institutionId: INST,
    scope: { kind: "all" },
    campusIds: null,
  });
  assert.equal(cobros.campusId, undefined);
});

test("🔴 una lista de sedes VACÍA no devuelve el instituto entero", () => {
  // `[]` significa "ninguna sede", y `null` significa "sin recorte". El
  // día que alguien compruebe con `if (campusIds?.length)` esto falla.
  const citas = eduAppointmentScopeWhere({
    institutionId: INST,
    scope: { kind: "all" },
    now: AHORA,
    campusIds: [],
  });
  assert.deepEqual(citas.chair, { institutionId: INST, campusId: { in: [] } });
});

// ─────────────────────────────────────────────────────────────────────
// 8 · El semáforo de la bandeja de firmas
// ─────────────────────────────────────────────────────────────────────

test("sin autorizaciones esperando el acceso va en NEUTRO, no en verde", () => {
  assert.equal(eduDirSemaforoDeFirmas(0, null), "NEUTRO");
  assert.equal(eduDirSemaforoDeFirmas(0, 999), "NEUTRO");
});

test("una firma reciente es VIGILAR y una vieja es ACTUAR, con el umbral del tablero", () => {
  assert.equal(eduDirSemaforoDeFirmas(3, EDU_DIR_FIRMA_VIEJA_MIN - 1), "VIGILAR");
  assert.equal(eduDirSemaforoDeFirmas(3, EDU_DIR_FIRMA_VIEJA_MIN), "ACTUAR");
  // Sin saber cuánto lleva la más vieja no se pinta un rojo a ciegas.
  assert.equal(eduDirSemaforoDeFirmas(3, null), "VIGILAR");
});

// ─────────────────────────────────────────────────────────────────────
// 9 · CANDADO MECÁNICO sobre el servidor
//
// Lo de arriba prueba las cuentas. Esto prueba que la consulta que las
// alimenta no se saltó el alcance — que es el error que no se ve leyendo
// una pantalla, porque la pantalla sigue pintando números.
// ─────────────────────────────────────────────────────────────────────

const RAIZ = join(process.cwd(), "src", "lib", "edu");

function leerServidor(): string {
  return readFileSync(join(RAIZ, "direccion.ts"), "utf8");
}

/** El cuerpo de getEduDireccionInicio, sin el resto del archivo. */
function cuerpoDelInicio(): string {
  const src = leerServidor();
  const desde = src.indexOf("export async function getEduDireccionInicio");
  assert.ok(desde > 0, "se renombró o se borró getEduDireccionInicio");
  const hasta = src.indexOf("export async function getEduDireccionDetalle", desde);
  assert.ok(hasta > desde, "se movió getEduDireccionDetalle: hay que reajustar el corte");
  return src.slice(desde, hasta);
}

test("🔴 el Inicio pide el ALCANCE antes que nada: es lo que niega a quien ve una parte", () => {
  const cuerpo = cuerpoDelInicio();
  assert.ok(
    cuerpo.includes("eduDirAlcance(ctx, now)"),
    "getEduDireccionInicio dejó de pasar por eduDirAlcance: un DOCENTE recibiría el dinero de la escuela",
  );
});

test("🔴 ninguna consulta del Inicio escribe su propio filtro de instituto a mano", () => {
  const cuerpo = cuerpoDelInicio();
  // Las citas y los pagos SIEMPRE por el alcance (que lleva la sede
  // dentro); las autorizaciones por institutionId, que sale del alcance.
  assert.ok(cuerpo.includes("...alcance.citas()"), "las citas del Inicio ya no usan el alcance");
  assert.ok(cuerpo.includes("...alcance.pagos"), "los pagos del Inicio ya no usan el alcance");
  assert.ok(cuerpo.includes("...alcance.cobros"), "los cobros del Inicio ya no usan el alcance");
  assert.ok(
    cuerpo.includes("pagoCharge(alcance, null)"),
    "los pagos del Inicio dejaron de colgar su sede del cobro",
  );
  assert.ok(
    !/institutionId:\s*ctx\./.test(cuerpo),
    "una consulta del Inicio lee el institutionId del contexto crudo en vez del alcance",
  );
});

test("🔴 la sede recorta las citas y el dinero del Inicio, y NO las autorizaciones", () => {
  const cuerpo = cuerpoDelInicio();
  // Las tres consultas de EduCaseApproval van por institutionId a secas: no
  // hay columna de sede en esa tabla y derivarla del sillón de alguna cita
  // del caso sería inventarla. La pantalla lo dice cuando hay sede elegida.
  const aprobaciones = cuerpo.split("prisma.eduCaseApproval").slice(1);
  assert.equal(aprobaciones.length, 3, "cambió el número de consultas de autorizaciones");
  for (const bloque of aprobaciones) {
    const consulta = bloque.slice(0, bloque.indexOf("}),"));
    assert.ok(
      !consulta.includes("campus"),
      "alguien le puso una sede a las autorizaciones: un caso no es de un edificio",
    );
  }
  assert.ok(
    cuerpo.includes("ctx.campusLabel"),
    "se quitó el aviso de que las autorizaciones no se recortan por sede",
  );
});

test("🔴 el Inicio NO se inventa su propia ventana ni sus propios topes", () => {
  const cuerpo = cuerpoDelInicio();
  assert.ok(cuerpo.includes("eduDirVentana("), "el Inicio dejó de usar la ventana del tablero");
  assert.ok(cuerpo.includes("EDU_DIR_MAX_CITAS"), "el Inicio dejó de usar el tope de citas");
  assert.ok(cuerpo.includes("EDU_DIR_MAX_FILAS"), "el Inicio dejó de usar el tope de filas");
  assert.ok(
    !/new Date\(\)(?!\s*\))/.test(cuerpo.replace("now: Date = new Date()", "")),
    "el Inicio fabrica un `now` por su cuenta: el periodo dejaría de ser el mismo que el del tablero",
  );
});

test("🔴 la gráfica de dinero cuenta PAGOS y no cobros emitidos", () => {
  const cuerpo = cuerpoDelInicio();
  assert.ok(
    cuerpo.includes("prisma.eduPayment.findMany"),
    "el dinero del Inicio dejó de leer pagos",
  );
  assert.ok(
    cuerpo.includes("paidAt: enPeriodo"),
    "el dinero del Inicio dejó de repartirse por la fecha del PAGO",
  );
  assert.ok(
    !/prisma\.eduCharge\.findMany/.test(cuerpo),
    "el Inicio empezó a sumar cobros emitidos como si fueran dinero cobrado",
  );
});

test("🔴 solo cuentan las autorizaciones APROBADAS, no las que caducaron", () => {
  const cuerpo = cuerpoDelInicio();
  assert.ok(
    cuerpo.includes('status: "APPROVED"'),
    "la serie de autorizaciones dejó de exigir APPROVED",
  );
  assert.ok(
    cuerpo.includes("decidedAt: enPeriodo"),
    "la serie de autorizaciones dejó de usar la fecha de la firma",
  );
});

const PAGINA = join(process.cwd(), "src", "app", "instituto", "(panel)", "inicio", "page.tsx");

test("la pantalla del Inicio pide el tablero SOLO con el permiso de dirección", () => {
  const page = readFileSync(PAGINA, "utf8");
  assert.ok(
    page.includes('"direccion.panel"'),
    "el Inicio dejó de comprobar el permiso del tablero",
  );
  assert.ok(page.includes("getEduDireccionInicio"), "el Inicio dejó de pedir las series");
  assert.ok(
    page.includes("getEduAlmacenamientoPanel"),
    "el Inicio dejó de pedir el medidor de almacenamiento",
  );
  // 🔴 El medidor NO pasa por la sede: la cuota es del instituto entero.
  assert.ok(
    /getEduAlmacenamientoPanel\(ctx\)/.test(page),
    "alguien le pasó la sede al medidor de almacenamiento: la cuota es del INSTITUTO",
  );
});

test("el medidor de almacenamiento se REUSA, no se recalcula en el Inicio", () => {
  const page = readFileSync(PAGINA, "utf8");
  assert.ok(
    page.includes("EduAlmacenamientoCard"),
    "el Inicio dejó de usar la tarjeta que ya existía",
  );
  assert.ok(
    !/eduStudy|sizeBytes|storageQuotaBytes/.test(page),
    "el Inicio empezó a contar bytes por su cuenta en vez de reusar almacenamiento.ts",
  );
});
