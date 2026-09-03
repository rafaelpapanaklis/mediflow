/**
 * Ventana y buckets de la gráfica "Tendencia de ingresos" del home admin.
 *
 * Run: npm run test:home-revenue
 *
 * Foco crítico — el bug que vino a cerrar:
 *  - La tarjeta decía "Ingresos del mes $1,224" y la gráfica pintaba una línea
 *    plana en $0. Misma tabla, mismo `where`… distinta VENTANA: el KPI llegaba
 *    al fin del mes calendario y la gráfica cortaba en "ahora + 1 h", además de
 *    generar buckets sólo hasta el día de hoy. Todo pago con `paidAt` posterior
 *    (el seed de demo escribe `fin de la cita + 1..2 h`) contaba para la
 *    tarjeta y no tenía dónde caer en la gráfica.
 *  - Por eso aquí se prueban DOS invariantes, no el detalle de las etiquetas:
 *      1. la ventana de la gráfica es la MISMA que la del KPI (periodRangeUtc);
 *      2. los buckets teselan esa ventana: TODO instante del rango tiene bucket.
 *    Con las dos, la suma de la serie es el número de la tarjeta por
 *    construcción, no por casualidad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRevenueWindow,
  bucketKeyFor,
  bucketKeyForDate,
  parseRevenueRange,
  rangeForPeriod,
  type RevenueRange,
} from "../revenue-buckets";
import { periodRangeUtc, getTzParts } from "../../agenda/time-utils";

const MX = "America/Mexico_City";
const HOUR = 3_600_000;

// Miércoles 2 de septiembre de 2026, 15:30 en Ciudad de México (la captura del
// reporte original). El seed había dejado los cobros del día a las 17:00-18:00.
const NOW_MX = new Date("2026-09-02T21:30:00Z");

test("la ventana de cada rango es la MISMA que la del KPI del mismo periodo", () => {
  const cases: Array<[RevenueRange, "day" | "month" | "year"]> = [
    ["hoy", "day"],
    ["mes", "month"],
    ["anio", "year"],
  ];
  for (const [range, period] of cases) {
    const win = buildRevenueWindow(range, MX, NOW_MX);
    const kpi = periodRangeUtc(period, MX, NOW_MX);
    assert.equal(
      win.from.toISOString(),
      kpi.from.toISOString(),
      `${range}: el inicio debe coincidir con el del KPI`,
    );
    assert.equal(
      win.to.toISOString(),
      kpi.to.toISOString(),
      `${range}: el fin debe coincidir con el del KPI (no "ahora")`,
    );
  }
});

test("la ventana NUNCA se corta en 'ahora': el mes llega al mes siguiente", () => {
  const { from, to, buckets } = buildRevenueWindow("mes", MX, NOW_MX);
  assert.equal(from.toISOString(), "2026-09-01T06:00:00.000Z");
  assert.equal(to.toISOString(), "2026-10-01T06:00:00.000Z");
  // Septiembre tiene 30 días: un bucket por día, del 1 al 30 (no hasta hoy=2).
  assert.equal(buckets.length, 30);
  assert.equal(buckets[0].label, "1");
  assert.equal(buckets[29].label, "30");
  assert.ok(to.getTime() > NOW_MX.getTime() + HOUR);
});

test("REGRESIÓN: el cobro de una cita de hoy fechado más tarde cae en el bucket de hoy", () => {
  const range: RevenueRange = "mes";
  const { from, to, buckets } = buildRevenueWindow(range, MX, NOW_MX);
  // El seed escribe paidAt = fin de la cita + 1..2 h. Cita de hoy 15:00-16:00
  // → pago a las 17:00 y 18:00 locales, o sea DESPUÉS de "ahora" (15:30).
  const pagoFuturoDeHoy = new Date("2026-09-03T00:00:00Z"); // 18:00 del 2 en MX
  assert.ok(pagoFuturoDeHoy.getTime() > NOW_MX.getTime() + HOUR, "el caso debe ser posterior a ahora+1h");
  assert.ok(pagoFuturoDeHoy >= from && pagoFuturoDeHoy < to, "debe entrar en la ventana consultada");
  const key = bucketKeyForDate(range, pagoFuturoDeHoy, MX);
  assert.equal(key, "2026-09-02");
  assert.ok(buckets.some((b) => b.key === key), "y debe existir el bucket que lo reclama");
});

test("un pago fechado en un día futuro del mes también tiene bucket", () => {
  const range: RevenueRange = "mes";
  const { buckets, to } = buildRevenueWindow(range, MX, NOW_MX);
  const pago = new Date("2026-09-15T18:00:00Z");
  assert.ok(pago < to);
  const key = bucketKeyForDate(range, pago, MX);
  assert.equal(key, "2026-09-15");
  const bucket = buckets.find((b) => b.key === key);
  assert.ok(bucket, "el día 15 debe existir en la serie");
  assert.ok(bucket!.start.getTime() > NOW_MX.getTime(), "y quedar marcado como futuro");
});

test("TESELADO: todo instante de la ventana cae en un bucket (sin huecos)", () => {
  const tzs = ["America/Mexico_City", "UTC", "Asia/Kolkata", "America/Santiago"];
  const ranges: RevenueRange[] = ["hoy", "semana", "mes", "anio"];
  // Fechas elegidas a propósito: cambio de DST en Santiago (5-sep-2026), fin de
  // mes, arranque de año y un 29 de febrero.
  const nows = [
    NOW_MX,
    new Date("2026-09-05T23:30:00Z"),
    new Date("2026-01-01T00:30:00Z"),
    new Date("2026-12-31T23:45:00Z"),
    new Date("2028-02-29T12:00:00Z"),
  ];

  for (const tz of tzs) {
    for (const range of ranges) {
      for (const now of nows) {
        const { buckets, from, to } = buildRevenueWindow(range, tz, now);
        assert.ok(buckets.length > 0, `${tz}/${range}: sin buckets`);
        assert.ok(from < to, `${tz}/${range}: ventana vacía`);

        const keys = new Set(buckets.map((b) => b.key));
        assert.equal(keys.size, buckets.length, `${tz}/${range}: hay claves repetidas`);

        // Los arranques son estrictamente crecientes y el primero es `from`.
        assert.equal(buckets[0].start.getTime(), from.getTime(), `${tz}/${range}: el 1er bucket no arranca en from`);
        for (let i = 1; i < buckets.length; i++) {
          assert.ok(
            buckets[i].start.getTime() > buckets[i - 1].start.getTime(),
            `${tz}/${range}: buckets desordenados`,
          );
          assert.ok(buckets[i].start.getTime() < to.getTime(), `${tz}/${range}: bucket fuera de la ventana`);
        }

        // Barrido de la ventana: cada media hora debe encontrar su bucket. Si
        // faltara un tramo (el bug original), aquí falla.
        const step = range === "anio" ? 6 * HOUR : HOUR / 2;
        for (let t = from.getTime(); t < to.getTime(); t += step) {
          const key = bucketKeyForDate(range, new Date(t), tz);
          assert.ok(
            keys.has(key),
            `${tz}/${range}: el instante ${new Date(t).toISOString()} no tiene bucket (clave ${key})`,
          );
        }
        // Y el último instante de la ventana, que es el que se escapaba.
        const last = new Date(to.getTime() - 1000);
        assert.ok(
          keys.has(bucketKeyForDate(range, last, tz)),
          `${tz}/${range}: el último instante de la ventana no tiene bucket`,
        );
      }
    }
  }
});

test("hoy: 24 buckets horarios del día calendario local", () => {
  const { buckets } = buildRevenueWindow("hoy", MX, NOW_MX);
  assert.equal(buckets.length, 24);
  assert.equal(buckets[0].label, "00:00");
  assert.equal(buckets[23].label, "23:00");
  // El primero arranca a medianoche LOCAL de HOY, no hace 24 horas.
  assert.equal(buckets[0].start.toISOString(), "2026-09-02T06:00:00.000Z");
});

test("semana: lunes → domingo, la misma convención que la agenda", () => {
  const { buckets, from, to } = buildRevenueWindow("semana", MX, NOW_MX);
  assert.equal(buckets.length, 7);
  // 2026-09-02 es miércoles → la semana arranca el lunes 31 de agosto.
  assert.equal(buckets[0].key, "2026-08-31");
  assert.equal(buckets[6].key, "2026-09-06");
  assert.equal(getTzParts(from, MX).day, 31);
  assert.equal(to.toISOString(), "2026-09-07T06:00:00.000Z");
});

test("anio: 12 meses del año en curso (no los últimos 12 rodantes)", () => {
  const { buckets } = buildRevenueWindow("anio", MX, NOW_MX);
  assert.equal(buckets.length, 12);
  assert.equal(buckets[0].key, "2026-01");
  assert.equal(buckets[11].key, "2026-12");
});

test("medianoche: hour===24 se normaliza a 00 y no pierde el pago", () => {
  // Bug de V8 con hour12:false — el mismo parche que formatSlotTime.
  assert.equal(
    bucketKeyFor("hoy", { year: 2026, month: 9, day: 2, hour: 24 }),
    bucketKeyFor("hoy", { year: 2026, month: 9, day: 2, hour: 0 }),
  );
});

test("parseRevenueRange y rangeForPeriod", () => {
  assert.equal(parseRevenueRange("hoy"), "hoy");
  assert.equal(parseRevenueRange("anio"), "anio");
  assert.equal(parseRevenueRange("basura"), "mes");
  assert.equal(parseRevenueRange(null), "mes");
  assert.equal(rangeForPeriod("day"), "hoy");
  assert.equal(rangeForPeriod("month"), "mes");
  assert.equal(rangeForPeriod("year"), "anio");
  // El trimestre no tiene gráfica propia: cae al mes en curso.
  assert.equal(rangeForPeriod("quarter"), "mes");
});
