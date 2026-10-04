/**
 * «Citas del mes» y «Ocupación» con UNA definición (ws1-t2, auditoría de uso
 * del 3/4-oct-2026, C-11 y C-26; decisión 9 de Rafael).
 *
 * Run: npm run test:citas-y-ocupacion
 *
 *   · C-11: cuatro «citas del mes» a la vez (Inicio 76, Finanzas 57,
 *     Analítica 85, Reportes 104) y −52 % contra −47 %. Finanzas cortaba en
 *     «ahora», Analítica no tenía fin de mes (y usaba el mes del servidor),
 *     Reportes contaba canceladas e Inicio comparaba contra «la misma duración
 *     hacia atrás» en vez del mes anterior.
 *   · C-26: Inicio «Ocupación 27 %» era completadas ÷ citas; Analítica
 *     «Eficiencia 0 de 100» usaba horas fijas y el día del servidor. Ahora las
 *     dos salen del horario de Ajustes × quien recibe citas.
 *
 * Con el código viejo falla: `citas-del-periodo.ts`, `ocupacion-del-periodo.ts`
 * y `eficiencia.ts` no existían, y las pantallas contaban cada una a su modo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { citaCuentaEnElPeriodo, citasDelPeriodoWhere, diaDeLaClinica, mesDeLaClinica } from "@/lib/agenda/citas-del-periodo";
import { diasDelPeriodo, ocupacionDelPeriodo } from "@/lib/agenda/ocupacion-del-periodo";
import { puntajeDeEficiencia } from "@/lib/agenda/eficiencia";
import { citasWindowEnd } from "@/lib/finanzas-periodo";

const TZ = "America/Mexico_City";
const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
// 3-oct-2026 a las 23:10 en la Ciudad de México (05:10 UTC del 4).
const AHORA = new Date("2026-10-04T05:10:00Z");

test("C-11: el mes es el de la clínica, entero y con fin; el anterior es septiembre entero", () => {
  const oct = mesDeLaClinica(TZ, AHORA);
  assert.equal(oct.desde.toISOString(), "2026-10-01T06:00:00.000Z");
  assert.equal(oct.hasta.toISOString(), "2026-11-01T06:00:00.000Z");
  const sep = mesDeLaClinica(TZ, AHORA, -1);
  assert.equal(sep.desde.toISOString(), "2026-09-01T06:00:00.000Z");
  assert.equal(sep.hasta.toISOString(), "2026-10-01T06:00:00.000Z");
  const hoy = diaDeLaClinica(TZ, AHORA);
  assert.equal(hoy.desde.toISOString(), "2026-10-03T06:00:00.000Z");
  assert.deepEqual(citasDelPeriodoWhere("cl", oct.desde, oct.hasta), {
    clinicId: "cl",
    startsAt: { gte: oct.desde, lt: oct.hasta },
    status: { notIn: ["CANCELLED"] },
  });
  assert.throws(() => citasDelPeriodoWhere("", oct.desde, oct.hasta), /clinicId/);
});

test("C-11: con la misma siembra, las cuatro cuentas viejas daban cuatro números; la nueva, uno", () => {
  const c = (iso: string, status = "SCHEDULED") => ({ startsAt: new Date(iso), status });
  const citas = [
    c("2026-10-01T15:00:00Z", "COMPLETED"),
    c("2026-10-02T15:00:00Z", "NO_SHOW"), // existió: cuenta
    c("2026-10-02T16:00:00Z", "CANCELLED"), // no cuenta
    c("2026-10-03T22:00:00Z"), // hoy, 16:00 en CDMX
    c("2026-10-20T15:00:00Z"), // más tarde este mes: cuenta
    c("2026-11-05T15:00:00Z"), // noviembre: no es de octubre
    c("2026-10-01T03:00:00Z"), // 30-sep 21:00 en CDMX: es de septiembre
  ];
  const oct = mesDeLaClinica(TZ, AHORA);
  const nueva = citas.filter((x) => x.startsAt >= oct.desde && x.startsAt < oct.hasta && citaCuentaEnElPeriodo(x.status)).length;
  assert.equal(nueva, 4);
  // Las viejas, para que se vea el hueco:
  const finanzasVieja = citas.filter((x) => x.startsAt >= oct.desde && x.startsAt <= AHORA && x.status !== "CANCELLED").length;
  const analiticaVieja = citas.filter((x) => x.startsAt >= new Date("2026-10-01T04:00:00Z") && x.status !== "CANCELLED").length; // día 1 del servidor (NY), sin fin
  const reportesVieja = citas.filter((x) => x.startsAt >= oct.desde && x.startsAt < oct.hasta).length; // con canceladas
  assert.deepEqual([finanzasVieja, analiticaVieja, reportesVieja], [3, 5, 5]);
  // Finanzas ahora corta las citas al fin del mes, no en «ahora».
  assert.equal(citasWindowEnd("mes", AHORA, AHORA).toISOString(), "2026-11-01T06:00:00.000Z");
  assert.equal(citasWindowEnd("hoy", AHORA, AHORA).toISOString(), "2026-10-04T06:00:00.000Z");
  const to = new Date("2026-09-30T05:59:59.999Z");
  assert.equal(citasWindowEnd("mes_anterior", AHORA, to).getTime(), to.getTime() + 1);
});

test("C-11: las cuatro pantallas usan la definición única", () => {
  const analitica = leer("src/app/dashboard/analytics/page.tsx");
  assert.match(analitica, /citasDelPeriodoWhere\(clinicId, mes\.desde, mes\.hasta\)/);
  assert.match(analitica, /citasDelPeriodoWhere\(clinicId, mesAnterior\.desde, mesAnterior\.hasta\)/);
  assert.doesNotMatch(analitica, /startsAt: \{ gte: firstMonth \}/);
  const finanzas = leer("src/lib/finanzas-resumen.server.ts");
  assert.match(finanzas, /citasDelPeriodoWhere\(clinicId, from, params\.citasHasta/);
  assert.match(leer("src/app/api/finanzas/route.ts"), /citasHasta = citasWindowEnd\(/);
  assert.match(leer("src/app/dashboard/reports/cargar-reportes.ts"), /citasDelPeriodoWhere\(clinicId, r\.start, r\.end\)/);
  const inicio = leer("src/app/api/dashboard/home/admin/route.ts");
  assert.match(inicio, /periodRangeUtc\(period, timezone, new Date\(from\.getTime\(\) - 1\)\)/);
  assert.match(inicio, /citasDelPeriodoWhere\(clinicId, prevFrom, prevTo\)/);
  assert.match(inicio, /queCuenta: "citasDelPeriodo"/);
  // Y cada pantalla lo dice.
  for (const f of [
    "src/components/dashboard/finanzas-rediseno/finanzas-rediseno.tsx",
    "src/app/dashboard/finanzas/finanzas-client.tsx",
    "src/app/dashboard/analytics/overview-client.tsx",
    "src/app/dashboard/analytics/overview-rediseno.tsx",
    "src/app/dashboard/reports/reports-client.tsx",
  ]) assert.match(leer(f), /citasDelPeriodo/, f);
});

// Horario de Ajustes: L-V 09:00-19:00 (600 min), sábado 09:00-14:00 (300), domingo cerrado.
const HORARIO = [0, 1, 2, 3, 4].map((d) => ({ dayOfWeek: d, enabled: true, openTime: "09:00", closeTime: "19:00" }))
  .concat([{ dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" }, { dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "14:00" }]);

test("C-26: ocupación = minutos agendados ÷ horario × quien recibe citas (sin canceladas ni «No asistió»)", () => {
  // Semana del lunes 5 al domingo 11 de octubre de 2026, dos doctores.
  const desde = new Date("2026-10-05T06:00:00Z");
  const hasta = new Date("2026-10-12T06:00:00Z");
  assert.equal(diasDelPeriodo(desde, hasta, TZ).length, 7);
  const cita = (ini: string, min: number, status = "CONFIRMED", doctorId = "d1") => ({
    startsAt: new Date(ini), endsAt: new Date(new Date(ini).getTime() + min * 60_000), status, doctorId,
  });
  const citas = [
    cita("2026-10-05T16:00:00Z", 600), // lunes, 10 h del d1
    cita("2026-10-06T16:00:00Z", 330, "COMPLETED", "d2"),
    cita("2026-10-07T16:00:00Z", 120, "CANCELLED"), // no cuenta
    cita("2026-10-08T16:00:00Z", 120, "NO_SHOW"), // no ocupa
  ];
  const o = ocupacionDelPeriodo({ desde, hasta, zona: TZ, schedules: HORARIO, profesionales: ["d1", "d2"], citas });
  // Disponible: (5 × 600 + 300) × 2 = 6,600 min. Ocupado: 600 + 330 = 930 → 14 %.
  assert.equal(o.minutosDisponibles, 6600);
  assert.equal(o.minutosOcupados, 930);
  assert.equal(o.porcentaje, 14);
  // Sin horario en Ajustes no se inventa.
  assert.equal(ocupacionDelPeriodo({ desde, hasta, zona: TZ, schedules: [], profesionales: ["d1"], citas }).porcentaje, null);
  // Sin nadie que reciba citas, tampoco.
  assert.equal(ocupacionDelPeriodo({ desde, hasta, zona: TZ, schedules: HORARIO, profesionales: [], citas }).porcentaje, null);
});

test("C-26: la «Eficiencia» de Analítica sale del mismo horario (y del día de la clínica)", () => {
  const mes = mesDeLaClinica(TZ, new Date("2026-10-06T18:00:00Z"));
  const hoy = diaDeLaClinica(TZ, new Date("2026-10-06T18:00:00Z"));
  // Martes 6-oct: el d1 tiene 300 de sus 600 min.
  const citas = [{ startsAt: new Date("2026-10-06T15:00:00Z"), endsAt: new Date("2026-10-06T20:00:00Z"), status: "CONFIRMED", doctorId: "d1" }];
  const e = puntajeDeEficiencia({
    hoy, mes, ahora: new Date("2026-10-06T18:00:00Z"), zona: TZ, schedules: HORARIO, profesionales: ["d1"], citas, minutosPorEspacio: 30,
  });
  // Horas: 50 % × 0.6 = 30; espacios: 1 de 20 = 5 % × 0.4 = 2 → 32.
  assert.equal(e.hoy, 32);
  assert.equal(e.ocupacionHoy, 50);
  assert.equal(e.sinHorario, false);
  assert.ok(e.ocupacionMes !== null && e.ocupacionMes < 50);
  const sin = puntajeDeEficiencia({ hoy, mes, ahora: new Date("2026-10-06T18:00:00Z"), zona: TZ, schedules: [], profesionales: ["d1"], citas, minutosPorEspacio: 30 });
  assert.equal(sin.sinHorario, true);
  assert.equal(sin.hoy, 0);
});

test("C-26: Inicio ya no llama «Ocupación» a completadas ÷ citas", () => {
  const inicio = leer("src/app/api/dashboard/home/admin/route.ts");
  assert.doesNotMatch(inicio, /current\.completed \/ current\.appointments/);
  assert.match(inicio, /cargarOcupacionDelPeriodo\(clinicId, timezone, from, to\)/);
  assert.match(inicio, /queCuenta: "ocupacion"/);
  const ef = leer("src/app/api/analytics/efficiency-score/route.ts");
  assert.doesNotMatch(ef, /agendaDayEnd - clinic\.agendaDayStart/);
  assert.match(ef, /puntajeDeEficiencia\(/);
});

test("los textos nuevos existen en es y en", () => {
  for (const l of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${l}.json`));
    for (const k of ["citasDelPeriodo", "ocupacion"]) assert.equal(typeof d.queCuenta[k], "string", `${l} queCuenta.${k}`);
    for (const k of ["ocupacionMes", "ocupacionSinHorario"]) assert.equal(typeof d.analytics.overview[k], "string", `${l} ${k}`);
  }
});
