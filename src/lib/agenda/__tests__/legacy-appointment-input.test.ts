import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyTimesToUtc } from "../time-utils";

/**
 * Hallazgo 24. `/dashboard/appointments` manda la hora como la trae su
 * formulario — `{date:"2026-09-08", startTime:"09:00", durationMins:30}` en la
 * hora de la clínica — mientras que `POST /api/appointments` exige
 * `startsAt`/`endsAt` ISO. Verificado en la app real: ese payload devuelve
 * **400 missing_startsAt siempre**; el de la Agenda (startsAt/endsAt) → 201.
 *
 * La conversión hora-de-pared → instante NO puede hacerse en el navegador:
 * necesita la tz IANA de la clínica y el cliente nunca la recibe (la página
 * no la baja). Hacerla con la tz del dispositivo crearía citas a la hora
 * equivocada para cualquiera que no esté físicamente en la clínica.
 *
 * Por eso vive en el servidor, y es el INVERSO EXACTO de lo que la propia
 * pantalla usa para pintar esos campos: `dateISOInTz` / `timeHHMMInTz`
 * (src/lib/agenda/legacy-helpers.ts, llamados desde
 * src/app/dashboard/appointments/page.tsx).
 */

const MX = "America/Mexico_City"; // UTC-6 en septiembre

test("24: {date, startTime, durationMins} se resuelve en la tz de la clínica", () => {
  const r = legacyTimesToUtc(
    { date: "2026-09-08", startTime: "09:00", durationMins: 30 },
    MX,
  );
  assert.ok(r, "el payload de la pantalla debe resolverse, no rechazarse");
  assert.equal(r.startsAt.toISOString(), "2026-09-08T15:00:00.000Z");
  assert.equal(r.endsAt.toISOString(), "2026-09-08T15:30:00.000Z");
});

test("24: si no viene durationMins se usa endTime", () => {
  const r = legacyTimesToUtc(
    { date: "2026-09-08", startTime: "09:00", endTime: "10:15" },
    MX,
  );
  assert.ok(r);
  assert.equal(r.startsAt.toISOString(), "2026-09-08T15:00:00.000Z");
  assert.equal(r.endsAt.toISOString(), "2026-09-08T16:15:00.000Z");
});

test("24: el endTime sin envolver del cliente ('24:15') cae en el día siguiente", () => {
  // addTime("23:30", 45) del cliente devuelve "24:15", no "00:15".
  const r = legacyTimesToUtc(
    { date: "2026-09-08", startTime: "23:30", endTime: "24:15" },
    MX,
  );
  assert.ok(r);
  assert.equal(r.startsAt.toISOString(), "2026-09-09T05:30:00.000Z");
  assert.equal(r.endsAt.toISOString(), "2026-09-09T06:15:00.000Z");
});

test("24: la duración manda sobre el endTime cuando vienen las dos", () => {
  const r = legacyTimesToUtc(
    { date: "2026-09-08", startTime: "09:00", endTime: "23:00", durationMins: 45 },
    MX,
  );
  assert.ok(r);
  assert.equal(r.endsAt.toISOString(), "2026-09-08T15:45:00.000Z");
});

test("24: es el inverso exacto de lo que la pantalla pinta", () => {
  // La misma cita, ida y vuelta: la pantalla parte de startsAt y muestra
  // date/startTime en tz; al guardar debe volver al MISMO instante.
  const original = new Date("2026-09-08T16:00:00.000Z"); // 10:00 en MX
  const r = legacyTimesToUtc(
    { date: "2026-09-08", startTime: "10:00", durationMins: 60 },
    MX,
  );
  assert.ok(r);
  assert.equal(r.startsAt.getTime(), original.getTime());
});

test("24: otra zona da otro instante (por eso no lo decide el navegador)", () => {
  const mx = legacyTimesToUtc({ date: "2026-09-08", startTime: "09:00", durationMins: 30 }, MX);
  const cun = legacyTimesToUtc({ date: "2026-09-08", startTime: "09:00", durationMins: 30 }, "America/Cancun");
  assert.ok(mx && cun);
  assert.equal(cun.startsAt.toISOString(), "2026-09-08T14:00:00.000Z"); // UTC-5
  assert.notEqual(mx.startsAt.getTime(), cun.startsAt.getTime());
});

test("24: payload incompleto o basura devuelve null (el 400 lo da la ruta)", () => {
  assert.equal(legacyTimesToUtc({ startTime: "09:00", durationMins: 30 }, MX), null);
  assert.equal(legacyTimesToUtc({ date: "2026-09-08", durationMins: 30 }, MX), null);
  assert.equal(legacyTimesToUtc({ date: "2026-09-08", startTime: "09:00" }, MX), null);
  assert.equal(legacyTimesToUtc({ date: "8/9/2026", startTime: "09:00", durationMins: 30 }, MX), null);
  assert.equal(legacyTimesToUtc({ date: "2026-09-08", startTime: "9 am", durationMins: 30 }, MX), null);
  assert.equal(legacyTimesToUtc({ date: "2026-09-08", startTime: "09:00", durationMins: 0 }, MX), null);
  assert.equal(legacyTimesToUtc({ date: "2026-09-08", startTime: "09:00", endTime: "08:00" }, MX), null);
  assert.equal(legacyTimesToUtc({}, MX), null);
});
