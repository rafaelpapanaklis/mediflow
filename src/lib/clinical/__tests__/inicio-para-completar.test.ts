// F-2 (tercera auditoría): cita de hoy a las 14:00, consulta iniciada a las 06:21 → «Completar consulta» daba 409
// («una cita que todavía no empieza»). Con el código viejo el cierre medía contra la hora agendada (este módulo no
// existía).

import { test } from "node:test";
import assert from "node:assert/strict";
import { inicioParaCompletar } from "../inicio-para-completar";
import { completarNoFutura } from "@/lib/agenda/transitions";

const TZ = "America/Mexico_City";
const AHORA = new Date("2026-10-04T12:30:00Z"); // 06:30 CDMX

test("consulta iniciada hoy antes de su hora: se mide contra el inicio real y se puede completar", () => {
  const cita = { status: "IN_PROGRESS", startsAt: new Date("2026-10-04T20:00:00Z"), startedAt: new Date("2026-10-04T12:21:00Z") };
  assert.ok(completarNoFutura(AHORA, cita.startsAt), "con la hora agendada se rechazaba");
  const inicio = inicioParaCompletar(cita, AHORA, TZ);
  assert.equal(inicio.toISOString(), "2026-10-04T12:21:00.000Z");
  assert.equal(completarNoFutura(AHORA, inicio), null);
});

test("una cita de OTRO día (7-oct) sigue sin poder completarse, aunque se haya iniciado", () => {
  const cita = { status: "IN_PROGRESS", startsAt: new Date("2026-10-07T19:00:00Z"), startedAt: new Date("2026-10-04T12:21:00Z") };
  const inicio = inicioParaCompletar(cita, AHORA, TZ);
  assert.equal(inicio.toISOString(), cita.startsAt.toISOString());
  assert.ok(completarNoFutura(AHORA, inicio));
});

test("sin consulta iniciada (o sin hora de inicio) no cambia nada", () => {
  const startsAt = new Date("2026-10-04T20:00:00Z");
  assert.equal(inicioParaCompletar({ status: "IN_CHAIR", startsAt, startedAt: null }, AHORA, TZ), startsAt);
  assert.equal(inicioParaCompletar({ status: "IN_PROGRESS", startsAt, startedAt: null }, AHORA, TZ), startsAt);
});
