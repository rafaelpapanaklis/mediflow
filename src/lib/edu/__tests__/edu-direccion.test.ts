/**
 * LAS CUENTAS DEL PANEL DE DIRECCIÓN — Ola 7 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-direccion.test.ts
 *
 * (No hay `npm run test:edu-direccion`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo se comprueba SIN base de datos: `direccion-core.ts` recibe datos y
 * devuelve datos.
 *
 * Lo que fija este archivo:
 *  1. que la VENTANA del periodo y la del periodo anterior sean del mismo
 *     largo y estén pegadas — comparar siete días contra treinta es la
 *     forma más fácil de que un tablero mienta;
 *  2. 🔴 que la VARIACIÓN no invente un porcentaje cuando el periodo
 *     anterior fue CERO (no hay "+100 %" ni "+∞ %": se dice que no hay
 *     comparación);
 *  3. 🔴 que un sillón SIN HORARIO no tenga ocupación —"siempre abierto"
 *     no es un denominador— y que la ocupación no pase del 100 %;
 *  4. que el semáforo del sillón cambie de ámbar a rojo en el umbral, y
 *     que el estado agregado de una especialidad use EL MISMO umbral que
 *     el veredicto por alumno de la Ola 6 (importado, no copiado);
 *  5. que CADA cifra del tablero tenga una lista detrás, y que cada lista
 *     esté cableada de verdad en el servidor;
 *  6. que el CSV lleve el control del dinero y no se pueda convertir en
 *     una fórmula de Excel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_DIR_DETALLE_DETALLES,
  EDU_DIR_DETALLE_KEYS,
  EDU_DIR_DETALLE_TITULOS,
  EDU_DIR_ESPERA_ROJA_MIN,
  EDU_DIR_MAX_DIAS,
  EDU_DIR_PERIODOS,
  EDU_DIR_PERIODO_LABELS,
  EDU_DIR_SEMAFORO_TAG,
  EDU_DIR_SILLON_LABELS,
  EDU_DIR_SILLON_SEMAFORO,
  buildEduDireccionCsv,
  eduDirAtrasoLabel,
  eduDirCapacidadMinutos,
  eduDirCsvFileName,
  eduDirEsperaLabel,
  eduDirEstadoAgregado,
  eduDirFiltrosDeQuery,
  eduDirFiltrosDeSearchParams,
  eduDirMinutosDesde,
  eduDirOcupacion,
  eduDirPctLabel,
  eduDirQueryDeFiltros,
  eduDirSemaforoDeAtraso,
  eduDirSillonEstado,
  eduDirVariacion,
  eduDirVentana,
  eduDirWeekdayCounts,
  parseEduDirDetalle,
  parseEduDirPeriodo,
  type EduDirAhora,
  type EduDirPanel,
} from "../direccion-core";
import { EDU_ATRASO_UMBRAL_VIGILAR } from "../evaluacion-core";

const TZ = "America/Mexico_City";
/** Lunes 31 de agosto de 2026, 12:00 en Ciudad de México (18:00 UTC). */
const AHORA = new Date("2026-08-31T18:00:00.000Z");

// ─────────────────────────────────────────────────────────────────────
// 1 · La ventana del periodo
// ─────────────────────────────────────────────────────────────────────

test("«Hoy» es UN día, el del calendario del INSTITUTO (no el del servidor)", () => {
  const v = eduDirVentana({ periodo: "hoy" }, TZ, AHORA);
  assert.equal(v.periodo, "hoy");
  assert.equal(v.desdeISO, "2026-08-31");
  assert.equal(v.hastaISO, "2026-08-31");
  assert.equal(v.dias, 1);
  // El extremo derecho es EXCLUSIVO: con `lte` a la medianoche siguiente,
  // una cita de las 00:00 saldría en los dos días.
  assert.equal(v.to.getTime() - v.from.getTime(), 24 * 60 * 60 * 1000);
});

test("«Semana» son 7 días TERMINANDO hoy, y «Mes» 30 (ventanas que ruedan)", () => {
  const s = eduDirVentana({ periodo: "semana" }, TZ, AHORA);
  assert.equal(s.desdeISO, "2026-08-25");
  assert.equal(s.hastaISO, "2026-08-31");
  assert.equal(s.dias, 7);

  const m = eduDirVentana({ periodo: "mes" }, TZ, AHORA);
  assert.equal(m.desdeISO, "2026-08-02");
  assert.equal(m.hastaISO, "2026-08-31");
  assert.equal(m.dias, 30);
});

test("🔴 el periodo ANTERIOR es del MISMO largo y está PEGADO al actual", () => {
  for (const p of ["hoy", "semana", "mes"] as const) {
    const v = eduDirVentana({ periodo: p }, TZ, AHORA);
    const largo = v.to.getTime() - v.from.getTime();
    const largoPrev = v.prevTo.getTime() - v.prevFrom.getTime();
    assert.equal(largoPrev, largo, `${p}: el periodo anterior no mide lo mismo`);
    // Pegado: el anterior termina justo donde empieza el actual. Un hueco
    // de un día entre los dos dejaría fuera de la comparación las citas de
    // ese día, y nadie lo notaría nunca.
    assert.equal(v.prevTo.getTime(), v.from.getTime(), `${p}: hay un hueco entre los periodos`);
  }
});

test("«Hoy» avisa de que va a medias y ayer está completo", () => {
  const v = eduDirVentana({ periodo: "hoy" }, TZ, AHORA);
  assert.ok(v.aviso && v.aviso.length > 20, "«Hoy» tiene que advertir de la comparación");
  assert.equal(v.compara, "contra el día anterior");
});

test("un rango con las fechas al revés se endereza en vez de rebotar", () => {
  const v = eduDirVentana(
    { periodo: "rango", desde: "2026-08-31", hasta: "2026-08-01" },
    TZ,
    AHORA,
  );
  assert.equal(v.desdeISO, "2026-08-01");
  assert.equal(v.hastaISO, "2026-08-31");
  assert.equal(v.dias, 31);
});

test(`un rango de más de ${EDU_DIR_MAX_DIAS} días se recorta y LO DICE`, () => {
  const v = eduDirVentana(
    { periodo: "rango", desde: "2020-01-01", hasta: "2026-01-01" },
    TZ,
    AHORA,
  );
  assert.equal(v.dias, EDU_DIR_MAX_DIAS);
  assert.ok(v.aviso && /recort/i.test(v.aviso), "el recorte tiene que salir en un aviso");
});

test("«Personalizado» sin fechas cae a «Hoy» en vez de pintar un periodo vacío", () => {
  const v = eduDirVentana({ periodo: "rango" }, TZ, AHORA);
  assert.equal(v.periodo, "hoy");
  assert.equal(v.dias, 1);
});

test("un periodo inventado cae a «Hoy» (nunca a un rango infinito)", () => {
  assert.equal(parseEduDirPeriodo("trimestre"), null);
  assert.equal(parseEduDirPeriodo(null), null);
  assert.equal(parseEduDirPeriodo("MES"), "mes");
  const v = eduDirVentana({ periodo: "trimestre" }, TZ, AHORA);
  assert.equal(v.periodo, "hoy");
});

test("los cuatro periodos tienen etiqueta en español", () => {
  for (const p of EDU_DIR_PERIODOS) {
    assert.ok(EDU_DIR_PERIODO_LABELS[p], `falta la etiqueta de ${p}`);
  }
});

test("los días de la semana del periodo se cuentan bien (la capacidad depende de eso)", () => {
  // 2026-08-31 es lunes. Siete días desde ahí: uno de cada.
  const semana = eduDirWeekdayCounts("2026-08-31", 7);
  assert.deepEqual(semana, [1, 1, 1, 1, 1, 1, 1]);

  // Tres días desde el lunes: lunes, martes, miércoles.
  const tres = eduDirWeekdayCounts("2026-08-31", 3);
  assert.equal(tres[1], 1);
  assert.equal(tres[2], 1);
  assert.equal(tres[3], 1);
  assert.equal(tres[0], 0);
  assert.equal(
    tres.reduce((a, b) => a + b, 0),
    3,
  );
});

// ─────────────────────────────────────────────────────────────────────
// 2 · La variación
// ─────────────────────────────────────────────────────────────────────

test("la variación dice el porcentaje y los dos números", () => {
  const v = eduDirVariacion(20, 16);
  assert.equal(v.delta, 4);
  assert.equal(v.pct, 25);
  assert.equal(v.sentido, 1);
  assert.match(v.texto, /\+25 %/);
  assert.match(v.texto, /16 → 20/);
});

test("🔴 con el periodo anterior en CERO no se inventa un porcentaje", () => {
  const sube = eduDirVariacion(7, 0);
  assert.equal(sube.pct, null, "dividir entre cero no puede producir un porcentaje");
  assert.match(sube.texto, /antes no hubo ninguno/);

  const nada = eduDirVariacion(0, 0);
  assert.equal(nada.pct, null);
  assert.equal(nada.sentido, 0);
  assert.match(nada.texto, /igual/);
});

test("bajar se marca como bajar (el color lo decide quien lee, no la cuenta)", () => {
  const v = eduDirVariacion(8, 10);
  assert.equal(v.sentido, -1);
  assert.equal(v.pct, -20);
  assert.match(v.texto, /-20 %/);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · La ocupación del sillón
// ─────────────────────────────────────────────────────────────────────

test("🔴 un sillón SIN horario no tiene capacidad: «siempre abierto» no es un denominador", () => {
  assert.equal(eduDirCapacidadMinutos([], [1, 1, 1, 1, 1, 1, 1]), null);
  assert.equal(eduDirOcupacion(600, null), null);
  assert.equal(eduDirPctLabel(null), "—");
});

test("la capacidad multiplica cada franja por las veces que cae su día", () => {
  // Lunes a viernes de 08:00 a 14:00 = 360 min por día.
  const slots = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 8 * 60,
    endMinute: 14 * 60,
  }));
  // Una semana completa desde el lunes: cinco días hábiles.
  const capacidad = eduDirCapacidadMinutos(slots, eduDirWeekdayCounts("2026-08-31", 7));
  assert.equal(capacidad, 5 * 360);

  // Dos semanas: el doble.
  const dos = eduDirCapacidadMinutos(slots, eduDirWeekdayCounts("2026-08-31", 14));
  assert.equal(dos, 10 * 360);
});

test("una franja al revés o de largo cero no suma capacidad", () => {
  const cero = eduDirCapacidadMinutos(
    [{ weekday: 1, startMinute: 600, endMinute: 600 }],
    eduDirWeekdayCounts("2026-08-31", 7),
  );
  assert.equal(cero, null, "una franja vacía no puede dar capacidad");

  const alReves = eduDirCapacidadMinutos(
    [{ weekday: 1, startMinute: 900, endMinute: 600 }],
    eduDirWeekdayCounts("2026-08-31", 7),
  );
  assert.equal(alReves, null);
});

test("🔴 la ocupación se TOPA en 100 %: un «137 %» proyectado no lo contesta nadie", () => {
  assert.equal(eduDirOcupacion(1800, 1800), 1);
  assert.equal(eduDirOcupacion(2400, 1800), 1);
  assert.equal(eduDirOcupacion(900, 1800), 0.5);
  assert.equal(eduDirPctLabel(0.5), "50 %");
  assert.equal(eduDirPctLabel(eduDirOcupacion(2400, 1800)), "100 %");
});

// ─────────────────────────────────────────────────────────────────────
// 4 · El semáforo
// ─────────────────────────────────────────────────────────────────────

test("un sillón vacío está LIBRE y no es un problema (gris, no rojo)", () => {
  assert.equal(eduDirSillonEstado(false, null), "LIBRE");
  assert.equal(EDU_DIR_SILLON_SEMAFORO.LIBRE, "NEUTRO");
  assert.equal(EDU_DIR_SEMAFORO_TAG.NEUTRO, "edu-tag--muted");
});

test("🔴 el sillón pasa de ámbar a ROJO exactamente en el umbral de espera", () => {
  assert.equal(eduDirSillonEstado(true, null), "ATENDIENDO");
  assert.equal(eduDirSillonEstado(true, 0), "ESPERA");
  assert.equal(eduDirSillonEstado(true, EDU_DIR_ESPERA_ROJA_MIN - 1), "ESPERA");
  assert.equal(eduDirSillonEstado(true, EDU_DIR_ESPERA_ROJA_MIN), "ESPERA_LARGA");
  assert.equal(eduDirSillonEstado(true, 240), "ESPERA_LARGA");

  assert.equal(EDU_DIR_SILLON_SEMAFORO.ATENDIENDO, "OK");
  assert.equal(EDU_DIR_SILLON_SEMAFORO.ESPERA, "VIGILAR");
  assert.equal(EDU_DIR_SILLON_SEMAFORO.ESPERA_LARGA, "ACTUAR");
});

test("los dos estados de espera se LEEN igual: el color añade urgencia, no cambia el hecho", () => {
  assert.equal(EDU_DIR_SILLON_LABELS.ESPERA, EDU_DIR_SILLON_LABELS.ESPERA_LARGA);
});

test("el semáforo académico de la Ola 6 se traduce sin reinterpretarse", () => {
  assert.equal(eduDirSemaforoDeAtraso("ATRASADO"), "ACTUAR");
  assert.equal(eduDirSemaforoDeAtraso("VIGILAR"), "VIGILAR");
  assert.equal(eduDirSemaforoDeAtraso("AL_DIA"), "OK");
  assert.equal(eduDirSemaforoDeAtraso(null), "NEUTRO");
  assert.equal(eduDirAtrasoLabel(null), "Sin calcular");
});

test("los minutos de espera nunca son negativos y un instante ilegible da null", () => {
  assert.equal(eduDirMinutosDesde(new Date(AHORA.getTime() - 90 * 60_000), AHORA), 90);
  assert.equal(eduDirMinutosDesde(new Date(AHORA.getTime() + 60_000), AHORA), 0);
  assert.equal(eduDirMinutosDesde(null, AHORA), null);
  assert.equal(eduDirMinutosDesde("no-es-fecha", AHORA), null);
  assert.equal(eduDirEsperaLabel(null), "—");
  assert.equal(eduDirEsperaLabel(0), "recién");
  assert.equal(eduDirEsperaLabel(90), "1 h 30 min");
});

// ─────────────────────────────────────────────────────────────────────
// 5 · El estado agregado de una especialidad
// ─────────────────────────────────────────────────────────────────────

/** Un agregado con los mismos números en las dos mitades (todos medibles). */
function agregadoUniforme(hechos: number, esperados: number, totales: number, medibles = 3) {
  return eduDirEstadoAgregado({
    hechos,
    totales,
    hechosMedibles: hechos,
    esperados,
    totalesMedibles: totales,
    medibles,
  });
}

test("🔴 el estado de una especialidad usa EL MISMO umbral que el de un alumno (Ola 6)", () => {
  const totales = 100;
  const esperados = 100;
  // Justo en el umbral: VIGILAR. Un punto por debajo: ATRASADO.
  assert.equal(
    agregadoUniforme(EDU_ATRASO_UMBRAL_VIGILAR * esperados, esperados, totales).estado,
    "VIGILAR",
  );
  assert.equal(
    agregadoUniforme(EDU_ATRASO_UMBRAL_VIGILAR * esperados - 1, esperados, totales).estado,
    "ATRASADO",
  );
  assert.equal(agregadoUniforme(esperados, esperados, totales).estado, "AL_DIA");
});

test("sin requisitos capturados NO hay semáforo, y se dice qué falta capturar", () => {
  const v = agregadoUniforme(0, 0, 0, 5);
  assert.equal(v.estado, null);
  assert.equal(v.avance, null);
  assert.match(v.motivo, /Requisitos/);
});

test("🔴 sin fechas en las generaciones NO se pinta un rojo inventado", () => {
  const v = eduDirEstadoAgregado({
    hechos: 4,
    totales: 20,
    hechosMedibles: 0,
    esperados: 0,
    totalesMedibles: 0,
    medibles: 0,
  });
  assert.equal(v.estado, null, "sin nadie medible no se puede juzgar la especialidad");
  assert.equal(v.esperado, null);
  assert.equal(v.avance, 0.2, "el avance SÍ se sabe: 4 de 20");
  assert.match(v.motivo, /Especialidades y generaciones/);
});

/**
 * 🔴 LA RAZÓN DE QUE LA FUNCIÓN RECIBA DOS MITADES. Diez alumnos al día en
 * una generación fechada, más dos cuya generación nadie fechó: los dos
 * suman a los TOTALES (su plan existe) y no a los ESPERADOS (no se sabe
 * cuánto ha transcurrido de su ciclo). Con una sola cuenta, la especialidad
 * saldría ATRASADA por un dato administrativo — y ese rojo se lo enseñaría
 * alguien a un grupo de alumnos.
 */
test("🔴 un alumno con la generación sin fechas NO arrastra a su especialidad a rojo", () => {
  const conLasDosMitades = eduDirEstadoAgregado({
    // 10 medibles al día (100 de 100) + 2 sin fechas (0 de 20 cada uno).
    hechos: 100,
    totales: 140,
    hechosMedibles: 100,
    esperados: 100,
    totalesMedibles: 100,
    medibles: 10,
  });
  assert.equal(conLasDosMitades.estado, "AL_DIA");

  // La versión ingenua —una sola cuenta con todos revueltos— habría dado
  // 100/140 = 0,71: por debajo del umbral, o sea ATRASADO.
  assert.ok(100 / 140 < EDU_ATRASO_UMBRAL_VIGILAR);

  // Y la barra SÍ enseña los 140, que es la verdad de lo que falta.
  assert.ok(conLasDosMitades.avance !== null);
  assert.ok(Math.abs((conLasDosMitades.avance ?? 0) - 100 / 140) < 1e-9);
});

test("el motivo dice con cuántos estudiantes se midió la especialidad", () => {
  const v = agregadoUniforme(50, 80, 100, 7);
  assert.match(v.motivo, /7 estudiantes medibles/);
  const uno = agregadoUniforme(50, 80, 100, 1);
  assert.match(uno.motivo, /1 estudiante medible/);
});

test("al principio del ciclo no se espera nada todavía, y sale AL_DIA con su motivo", () => {
  const v = agregadoUniforme(0, 0, 30, 4);
  assert.equal(v.estado, "AL_DIA");
  assert.match(v.motivo, /apenas empieza/);
});

test("el avance se topa en 100 % aunque se cumpla de más", () => {
  const v = agregadoUniforme(50, 10, 20, 2);
  assert.equal(v.avance, 1);
});

// ─────────────────────────────────────────────────────────────────────
// 6 · Cada cifra abre una lista, y cada lista está cableada
// ─────────────────────────────────────────────────────────────────────

test("cada lista del catálogo tiene título y explicación en español", () => {
  for (const k of EDU_DIR_DETALLE_KEYS) {
    const titulo = EDU_DIR_DETALLE_TITULOS[k];
    const detalle = EDU_DIR_DETALLE_DETALLES[k];
    assert.ok(titulo && titulo.length > 3, `${k} sin título`);
    assert.ok(detalle && detalle.length > 20, `${k} sin explicación usable`);
    assert.notEqual(titulo, k, `${k} se titula con su propia key`);
  }
});

test("una key de lista inventada se descarta (no se consulta a ciegas)", () => {
  assert.equal(parseEduDirDetalle("todo"), null);
  assert.equal(parseEduDirDetalle(null), null);
  assert.equal(parseEduDirDetalle("firmas-pendientes"), "firmas-pendientes");
});

/**
 * 🔴 EL CANDADO MECÁNICO DE LA OLA: una key en el catálogo que el servidor
 * no resuelve es una cifra que se puede tocar y no abre nada. El escáner
 * busca su `case` en direccion.ts, igual que edu-permissions.test.ts busca
 * el lector de cada permiso.
 */
test("cada lista del catálogo la resuelve de verdad el servidor (ningún botón muerto)", () => {
  const raiz = join(__dirname, "..", "..", "..", "..");
  const servidor = readFileSync(join(raiz, "src", "lib", "edu", "direccion.ts"), "utf8");
  const sinCablear = EDU_DIR_DETALLE_KEYS.filter((k) => !servidor.includes(`case "${k}":`));
  assert.deepEqual(
    sinCablear,
    [],
    `listas del catálogo que el servidor no resuelve: ${sinCablear.join(", ")}`,
  );
});

test("la pantalla lee cada cifra que el servidor sabe abrir (ninguna lista huérfana)", () => {
  const raiz = join(__dirname, "..", "..", "..", "..");
  const pantalla = readFileSync(
    join(raiz, "src", "components", "edu", "direccion", "direccion-screen.tsx"),
    "utf8",
  );
  const servidor = readFileSync(join(raiz, "src", "lib", "edu", "direccion.ts"), "utf8");
  // Las que la pantalla abre por su nombre, más las que salen del catálogo
  // de tarjetas que arma el servidor.
  const huerfanas = EDU_DIR_DETALLE_KEYS.filter(
    (k) => !pantalla.includes(`"${k}"`) && !servidor.includes(`detalle: "${k}"`),
  );
  assert.deepEqual(
    huerfanas,
    [],
    `listas que nadie abre desde la pantalla: ${huerfanas.join(", ")}`,
  );
});

// ─────────────────────────────────────────────────────────────────────
// 7 · Los filtros de la URL
// ─────────────────────────────────────────────────────────────────────

test("los cuatro parámetros se leen con el MISMO nombre desde la URL y desde la página", () => {
  const params = new URLSearchParams(
    "periodo=rango&desde=2026-08-01&hasta=2026-08-31&especialidad=abc123",
  );
  const deQuery = eduDirFiltrosDeQuery(params);
  const deSearch = eduDirFiltrosDeSearchParams({
    periodo: "rango",
    desde: "2026-08-01",
    hasta: ["2026-08-31"],
    especialidad: "abc123",
  });
  assert.deepEqual(deQuery, deSearch);
});

test("la query se arma al revés sin perder nada (y sin fechas cuando no son de un rango)", () => {
  const conRango = eduDirQueryDeFiltros({
    periodo: "rango",
    desde: "2026-08-01",
    hasta: "2026-08-31",
    especialidad: "abc",
  });
  assert.equal(conRango, "periodo=rango&desde=2026-08-01&hasta=2026-08-31&especialidad=abc");

  // En un periodo fijo, las fechas sobran: llevarlas dejaría una URL que
  // dice "mes" y "del 1 al 31" a la vez.
  const mes = eduDirQueryDeFiltros({
    periodo: "mes",
    desde: "2026-08-01",
    hasta: "2026-08-31",
    especialidad: null,
  });
  assert.equal(mes, "periodo=mes");
});

// ─────────────────────────────────────────────────────────────────────
// 8 · La exportación
// ─────────────────────────────────────────────────────────────────────

function panelDePrueba(): EduDirPanel {
  const ventana = eduDirVentana({ periodo: "semana" }, TZ, AHORA);
  return {
    ventana,
    institucion: "Instituto de Especialidades Odontológicas",
    sede: null,
    especialidadId: null,
    especialidadNombre: null,
    tarjetas: [
      {
        detalle: "pacientes-atendidos",
        label: "Pacientes atendidos",
        value: "42",
        raw: 42,
        note: "Personas distintas.",
        semaforo: "NEUTRO",
        variacion: eduDirVariacion(42, 30),
        sub: null,
      },
      {
        detalle: "casos-abiertos",
        label: "Tratamientos iniciados",
        value: "9",
        raw: 9,
        note: "Casos abiertos.",
        semaforo: "NEUTRO",
        variacion: eduDirVariacion(9, 9),
        sub: {
          detalle: "casos-cerrados",
          label: "terminados",
          value: "4",
          raw: 4,
          note: "Casos cerrados.",
          semaforo: "NEUTRO",
          variacion: eduDirVariacion(4, 6),
          sub: null,
        },
      },
    ],
    opciones: [{ id: "p1", name: "Endodoncia" }],
    especialidades: [
      {
        programId: "p1",
        // Un nombre preparado a mala fe: si el CSV no lo escapa, Excel lo
        // abre como fórmula.
        programName: "=SUM(A1:A9)",
        alumnos: 12,
        enClinicaHoy: 5,
        pacientes: 30,
        cobradoCents: 123_45,
        avance: 0.4,
        esperado: 0.5,
        estado: "VIGILAR",
        motivo: "A esta altura del ciclo se esperan 10 de 20 y llevan 8.",
      },
    ],
    cobradoSinCaso: 50_00,
    masActivos: [
      {
        studentId: "s1",
        studentName: "Ana Rodríguez",
        matricula: "A-01",
        programName: "Endodoncia",
        pacientes: 9,
        citas: 14,
        horasLabel: "12 h",
        estado: "AL_DIA",
        motivo: "",
      },
    ],
    atrasados: [
      {
        studentId: "s2",
        studentName: "Luis Pérez",
        matricula: "A-02",
        programName: "Endodoncia",
        pacientes: 1,
        citas: 2,
        horasLabel: "2 h",
        estado: "ATRASADO",
        motivo: "Con 60 % del ciclo transcurrido se esperan 12 de 20 y lleva 3.",
      },
    ],
    dinero: {
      cobradoCents: 500_00,
      cobradoPrevCents: 400_00,
      emitidoCents: 620_00,
      pendienteCents: 120_00,
      cobros: 8,
      publicoCents: 400_00,
      alumnoCents: 220_00,
      controlCents: 90_00,
      controlCount: 2,
      inversoCents: 30_00,
      inversoCount: 1,
      sinListaCents: 0,
      sinListaCount: 0,
      ticketPromedioCents: 77_50,
      porSillonCents: 25_00,
      sillonesActivos: 20,
    },
    pendientes: {
      firmas: 3,
      firmaMasViejaMin: 95,
      pacientesSinAlumno: 4,
      calificacionesSinRegistrar: 2,
      alumnosSinDocente: 1,
    },
    uso: {
      ocupacion: 0.62,
      usadosMin: 4200,
      capacidadMin: 6800,
      libresMin: 2600,
      sillonesSinHorario: 2,
      citasPerdidas: 6,
      noShow: 4,
      canceladas: 2,
      duracionPromedioMin: 55,
      sillones: [
        {
          chairId: "c1",
          name: "Unidad 1",
          number: 1,
          usadosMin: 300,
          capacidadMin: 1800,
          ocupacion: 0.1667,
          citas: 5,
        },
        {
          chairId: "c2",
          name: "Unidad 2",
          number: 2,
          usadosMin: 900,
          capacidadMin: null,
          ocupacion: null,
          citas: 9,
        },
      ],
    },
    avisos: ["2 sillones no tienen horario capturado."],
  };
}

function ahoraDePrueba(): EduDirAhora {
  return {
    generadoISO: AHORA.toISOString(),
    horaLabel: "12:00",
    pacientesEnClinica: 5,
    alumnosAtendiendo: 3,
    sillonesEnUso: 3,
    sillonesTotal: 20,
    docentesResponsables: 2,
    sillonesSinDocente: 1,
    esperandoFirma: 1,
    esperaMasViejaMin: 22,
    sillones: [
      {
        chairId: "c1",
        name: "Unidad 1",
        number: 1,
        estado: "ESPERA_LARGA",
        appointmentId: "a1",
        patientId: "pa1",
        patientName: "María -Ortiz",
        patientFolio: "P-0001",
        studentId: "s1",
        studentName: "Ana Rodríguez",
        programName: "Endodoncia",
        caseId: "k1",
        desdeLabel: "10:30",
        esperaMinutos: 22,
        esperaEtapa: "Procedimiento",
        supervisorName: "Dr. Gómez",
        supervisorId: "u1",
      },
    ],
    recepcion: [],
    docentes: [{ userId: "u1", name: "Dr. Gómez", sillones: 1, porTitularidad: false }],
  };
}

test("el CSV lleva BOM y el tablero entero, bloque por bloque", () => {
  const csv = buildEduDireccionCsv(panelDePrueba(), ahoraDePrueba());
  assert.ok(csv.startsWith("﻿"), "sin BOM, Excel rompe los acentos");
  for (const bloque of [
    "LA CLÍNICA AHORA",
    "SILLONES",
    "ACTIVIDAD DEL PERIODO",
    "POR ESPECIALIDAD",
    "ESTUDIANTES ATRASADOS",
    "DINERO",
    "PENDIENTES",
    "USO DE LA CLÍNICA",
    "SILLÓN A SILLÓN",
    "AVISOS",
  ]) {
    assert.ok(csv.includes(bloque), `al CSV le falta el bloque ${bloque}`);
  }
});

test("🔴 el CSV lleva las DOS filas de control del dinero, con su importe y cuántas son", () => {
  const csv = buildEduDireccionCsv(panelDePrueba(), null);
  assert.match(csv, /CONTROL · tarifa de estudiante a paciente que llegó solo/);
  assert.match(csv, /CONTROL · paciente de estudiante con lista general/);
  // El importe formateado del control (90.00) y su cuenta (2).
  assert.ok(csv.includes("$90.00"), "el importe del control no salió en el CSV");
});

test("🔴 un nombre preparado no se convierte en fórmula de Excel", () => {
  const csv = buildEduDireccionCsv(panelDePrueba(), ahoraDePrueba());
  assert.ok(csv.includes(`"'=SUM(A1:A9)"`), "la especialidad no se escapó");
  assert.ok(csv.includes(`"'-Ortiz`) || csv.includes(`"'María -Ortiz"`) || csv.includes("María -Ortiz"));
  assert.ok(!/(^|,)"=SUM/.test(csv), "quedó una celda que empieza por = sin apóstrofo");
});

test("la sub-cifra de una tarjeta también sale en el CSV (si no, «terminados» se pierde)", () => {
  const csv = buildEduDireccionCsv(panelDePrueba(), null);
  assert.ok(csv.includes("terminados"), "la segunda cifra de la tarjeta no se exportó");
});

test("el CSV se puede armar sin el bloque en vivo (la exportación no depende de él)", () => {
  const csv = buildEduDireccionCsv(panelDePrueba(), null);
  assert.ok(!csv.includes("LA CLÍNICA AHORA"));
  assert.ok(csv.includes("ACTIVIDAD DEL PERIODO"));
});

test("el nombre del archivo dice el periodo y no se parece al de la bitácora", () => {
  assert.equal(eduDirCsvFileName("2026-08-31", "2026-08-31"), "panel-direccion-2026-08-31.csv");
  assert.equal(
    eduDirCsvFileName("2026-08-01", "2026-08-31"),
    "panel-direccion-2026-08-01_2026-08-31.csv",
  );
  assert.ok(!eduDirCsvFileName("2026-08-31", "2026-08-31").startsWith("bitacora"));
});
