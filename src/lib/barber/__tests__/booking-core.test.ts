/**
 * Reserva pública de barbería — el núcleo que decide qué horarios EXISTEN.
 *
 * Correr:
 *   npx tsx --test src/lib/barber/__tests__/booking-core.test.ts
 *
 * Lo que se prueba aquí es lo que el contrato exige poder afirmar:
 *  · jamás se ofrece un hueco que la base vaya a rechazar (solape real, no
 *    "empieza a la misma hora");
 *  · los bloqueos de barbería completa apagan a TODOS y los personales solo
 *    a su dueño;
 *  · el segundo que llega al mismo hueco se queda sin él (el mismo cálculo
 *    corre DENTRO de la transacción, ya viendo la cita del primero).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_SLOT_STEP_MIN,
  advisoryLockKey,
  addIsoDays,
  barberTodayISO,
  barberTzLocalToUtc,
  computeFreeBarbersForDay,
  isValidIsoDate,
  isoDateWeekday,
  isoDaysBetween,
  minutesToHhMm,
  parseHhMm,
  pickLeastBusy,
  shortReference,
  toPublicSlots,
  type AvailabilityData,
  type BusyInterval,
} from "../booking-core";

const TZ = "America/Mexico_City";
/** Lunes 24 de agosto de 2026 (dayOfWeek 1). */
const LUNES = "2026-08-24";

function at(dateISO: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return barberTzLocalToUtc(dateISO, h, m, TZ).getTime();
}

function busy(dateISO: string, from: string, to: string): BusyInterval {
  return { startMs: at(dateISO, from), endMs: at(dateISO, to) };
}

/** Barbería con los barberos dados, todos de 10:00 a 14:00 los lunes. */
function shop(
  barberIds: string[],
  opts: { busy?: Record<string, BusyInterval[]>; schedules?: AvailabilityData["schedules"] } = {},
): AvailabilityData {
  const busyByBarber = new Map<string, BusyInterval[]>();
  for (const id of barberIds) busyByBarber.set(id, opts.busy?.[id] ?? []);
  return {
    barberIds,
    schedules:
      opts.schedules ??
      barberIds.map((barberId) => ({
        barberId,
        dayOfWeek: 1, // lunes
        startMinute: 10 * 60,
        endMinute: 14 * 60,
      })),
    busyByBarber,
  };
}

/** Un "ahora" muy anterior al día probado: no recorta nada. */
const ANTES = new Date("2026-08-01T12:00:00Z");

// ── Fechas y horas ──────────────────────────────────────────────────────

test("isValidIsoDate rechaza fechas que no existen", () => {
  assert.equal(isValidIsoDate("2026-08-24"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false, "30 de febrero no existe");
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("24/08/2026"), false);
  assert.equal(isValidIsoDate(null), false);
  assert.equal(isValidIsoDate(20260824), false);
});

test("parseHhMm valida horas de verdad", () => {
  assert.equal(parseHhMm("10:30"), 630);
  assert.equal(parseHhMm("00:00"), 0);
  assert.equal(parseHhMm("23:59"), 1439);
  assert.equal(parseHhMm("24:00"), null);
  assert.equal(parseHhMm("10:60"), null);
  assert.equal(parseHhMm("9:30"), null, "exige dos dígitos");
  assert.equal(minutesToHhMm(630), "10:30");
  assert.equal(minutesToHhMm(0), "00:00");
});

test("el día de la semana no depende de la zona del servidor", () => {
  assert.equal(isoDateWeekday("2026-08-24"), 1, "lunes");
  assert.equal(isoDateWeekday("2026-08-23"), 0, "domingo = 0, como BarberSchedule");
  assert.equal(isoDateWeekday("2026-08-29"), 6, "sábado");
});

test("addIsoDays e isoDaysBetween cruzan meses y años", () => {
  assert.equal(addIsoDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addIsoDays("2026-12-31", 1), "2027-01-01");
  assert.equal(isoDaysBetween("2026-08-24", "2026-09-24"), 31);
  assert.equal(isoDaysBetween("2026-08-24", "2026-08-24"), 0);
});

test("barberTzLocalToUtc respeta el horario de verano donde lo hay", () => {
  // Tijuana SÍ cambia de hora (Ciudad de México ya no). En agosto está en
  // PDT (UTC-7): las 10:00 locales son las 17:00 UTC.
  const verano = barberTzLocalToUtc("2026-08-24", 10, 0, "America/Tijuana");
  assert.equal(verano.toISOString(), "2026-08-24T17:00:00.000Z");
  // En enero está en PST (UTC-8): las 10:00 locales son las 18:00 UTC.
  const invierno = barberTzLocalToUtc("2026-01-19", 10, 0, "America/Tijuana");
  assert.equal(invierno.toISOString(), "2026-01-19T18:00:00.000Z");
  // Ciudad de México, sin cambio de hora: siempre UTC-6.
  assert.equal(
    barberTzLocalToUtc("2026-08-24", 10, 0, TZ).toISOString(),
    "2026-08-24T16:00:00.000Z",
  );
  assert.equal(
    barberTzLocalToUtc("2026-01-19", 10, 0, TZ).toISOString(),
    "2026-01-19T16:00:00.000Z",
  );
});

test("barberTodayISO da el día EN LA BARBERÍA, no en el servidor", () => {
  // 05:00 UTC del 25 son todavía las 23:00 del 24 en Ciudad de México.
  const t = new Date("2026-08-25T05:00:00Z");
  assert.equal(barberTodayISO(TZ, t), "2026-08-24");
  assert.equal(barberTodayISO("UTC", t), "2026-08-25");
});

// ── Huecos ──────────────────────────────────────────────────────────────

test("los huecos caben COMPLETOS dentro del turno", () => {
  const free = computeFreeBarbersForDay(shop(["b1"]), LUNES, 60, TZ, ANTES);
  const times = toPublicSlots(free).map((s) => s.time);
  assert.equal(times[0], "10:00");
  assert.equal(
    times[times.length - 1],
    "13:00",
    "un servicio de 60 min no puede empezar a las 13:15 si cierran a las 14:00",
  );
  // Rejilla de 15 minutos, sin saltos.
  assert.equal(times.length, (4 * 60 - 60) / BARBER_SLOT_STEP_MIN + 1);
});

test("la rejilla se ancla a la hora en punto, no al inicio del turno", () => {
  const raro = shop(["b1"], {
    schedules: [{ barberId: "b1", dayOfWeek: 1, startMinute: 9 * 60 + 5, endMinute: 11 * 60 }],
  });
  const times = toPublicSlots(computeFreeBarbersForDay(raro, LUNES, 30, TZ, ANTES)).map(
    (s) => s.time,
  );
  assert.equal(times[0], "09:15", "abre 9:05 → el primer hueco es 9:15");
  assert.equal(times.includes("09:05"), false);
});

test("una cita OCUPA todo lo que dura, no solo la hora en que empieza", () => {
  // Cita de 10:00 a 11:00. Un servicio de 30 min NO cabe ni a las 10:15 ni a
  // las 10:30 ni a las 10:45 — este es exactamente el bug que en el dental
  // dejaba ofrecer "10:30" y reventaba contra la base al insertar.
  const conCita = shop(["b1"], { busy: { b1: [busy(LUNES, "10:00", "11:00")] } });
  const times = toPublicSlots(computeFreeBarbersForDay(conCita, LUNES, 30, TZ, ANTES)).map(
    (s) => s.time,
  );
  for (const t of ["10:00", "10:15", "10:30", "10:45"]) {
    assert.equal(times.includes(t), false, `${t} se solapa con la cita de 10:00-11:00`);
  }
  assert.equal(times.includes("11:00"), true, "a las 11:00 el sillón ya está libre");
  assert.equal(times.includes("09:45"), false, "fuera del turno");
});

test("un servicio largo no se cuela entre dos citas pegadas", () => {
  // Libre solo de 11:00 a 12:00. Un servicio de 90 min no cabe en ningún lado.
  const apretado = shop(["b1"], {
    busy: { b1: [busy(LUNES, "10:00", "11:00"), busy(LUNES, "12:00", "14:00")] },
  });
  assert.equal(computeFreeBarbersForDay(apretado, LUNES, 90, TZ, ANTES).size, 0);
  // Uno de 60 sí: exactamente a las 11:00.
  const cabe = toPublicSlots(computeFreeBarbersForDay(apretado, LUNES, 60, TZ, ANTES));
  assert.deepEqual(cabe.map((s) => s.time), ["11:00"]);
});

test("un bloqueo de barbería completa apaga a TODOS", () => {
  const cerrado = busy(LUNES, "10:00", "14:00");
  const data = shop(["b1", "b2"], { busy: { b1: [cerrado], b2: [cerrado] } });
  assert.equal(computeFreeBarbersForDay(data, LUNES, 30, TZ, ANTES).size, 0);
});

test("un bloqueo personal solo apaga a su dueño", () => {
  const data = shop(["b1", "b2"], { busy: { b1: [busy(LUNES, "10:00", "12:00")] } });
  const slots = toPublicSlots(computeFreeBarbersForDay(data, LUNES, 30, TZ, ANTES));
  const alas10 = slots.find((s) => s.time === "10:00");
  const alas12 = slots.find((s) => s.time === "12:00");
  assert.equal(alas10?.available, 1, "solo b2 puede a las 10:00");
  assert.equal(alas12?.available, 2, "a las 12:00 pueden los dos");
});

test("los días sin turno no ofrecen nada", () => {
  const martes = addIsoDays(LUNES, 1);
  assert.equal(computeFreeBarbersForDay(shop(["b1"]), martes, 30, TZ, ANTES).size, 0);
});

test("hoy no se ofrecen horas pasadas ni las de dentro de un ratito", () => {
  // Son las 11:20 en la barbería (17:20 UTC). Con 30 min de colchón, el
  // primer hueco posible es después de las 11:50 → 12:00.
  const ahora = new Date("2026-08-24T17:20:00Z");
  const times = toPublicSlots(computeFreeBarbersForDay(shop(["b1"]), LUNES, 30, TZ, ahora)).map(
    (s) => s.time,
  );
  assert.equal(times.includes("11:00"), false, "ya pasó");
  assert.equal(times.includes("11:30"), false, "cae dentro del colchón mínimo");
  assert.equal(times[0], "12:00");
});

test("'cualquiera disponible' suma barberos y respeta el orden de la barbería", () => {
  const data = shop(["b1", "b2", "b3"], { busy: { b1: [busy(LUNES, "10:00", "11:00")] } });
  const free = computeFreeBarbersForDay(data, LUNES, 30, TZ, ANTES);
  assert.deepEqual(free.get("10:00"), ["b2", "b3"]);
  assert.deepEqual(free.get("11:00"), ["b1", "b2", "b3"], "sortOrder de la barbería");
  // Lo que se PUBLICA es solo el conteo: los ids nunca salen a la calle.
  const publicado = toPublicSlots(free).find((s) => s.time === "10:00");
  assert.deepEqual(Object.keys(publicado ?? {}).sort(), ["available", "time"]);
});

test("el segundo que reserva el mismo hueco se queda sin él", () => {
  // Un solo barbero. Dos personas ven "12:00" libre al mismo tiempo.
  const antes = shop(["b1"]);
  assert.equal(computeFreeBarbersForDay(antes, LUNES, 60, TZ, ANTES).has("12:00"), true);

  // La primera commitea su cita. La segunda transacción vuelve a calcular
  // DENTRO del candado y ya ve esa cita: 12:00 desaparece.
  const despues = shop(["b1"], { busy: { b1: [busy(LUNES, "12:00", "13:00")] } });
  const libres = computeFreeBarbersForDay(despues, LUNES, 60, TZ, ANTES);
  assert.equal(libres.has("12:00"), false);
  assert.deepEqual(libres.get("12:00") ?? [], [], "sin candidatos → slotTaken (409)");
});

// ── Candado y reparto ───────────────────────────────────────────────────

test("la clave del candado es estable, cabe en int4 y distingue días", () => {
  const a = advisoryLockKey("barber:booking:shop_1:2026-08-24");
  const b = advisoryLockKey("barber:booking:shop_1:2026-08-24");
  const c = advisoryLockKey("barber:booking:shop_1:2026-08-25");
  const d = advisoryLockKey("barber:booking:shop_2:2026-08-24");
  assert.deepEqual(a, b, "la misma clave siempre da el mismo candado");
  assert.notDeepEqual(a, c, "otro día, otro candado");
  assert.notDeepEqual(a, d, "otra barbería, otro candado");
  for (const n of [...a, ...c, ...d]) {
    assert.equal(Number.isInteger(n), true);
    assert.ok(n >= -2147483648 && n <= 2147483647, "rango de int4 de Postgres");
  }
});

test("'cualquiera' reparte hacia el barbero menos cargado", () => {
  const carga = new Map([["b1", 5], ["b2", 1], ["b3", 3]]);
  assert.equal(pickLeastBusy(["b1", "b2", "b3"], carga), "b2");
  // Empate: gana el orden de la barbería (el primero de la lista).
  assert.equal(pickLeastBusy(["b1", "b2"], new Map([["b1", 2], ["b2", 2]])), "b1");
  // Sin datos de carga, el primero.
  assert.equal(pickLeastBusy(["b3", "b1"], new Map()), "b3");
  assert.equal(pickLeastBusy([], new Map()), null);
});

test("la referencia que ve el cliente no es el id de la cita", () => {
  const id = "clx9a8b7c6d5e4f3g2h1";
  const ref = shortReference(id);
  assert.equal(ref.length, 6);
  assert.equal(ref, ref.toUpperCase());
  assert.equal(id.includes(ref), false, "va en mayúsculas: no se puede pegar como id");
});
