/**
 * Un control de ortodoncia agendado «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.6).
 *
 * Run: node_modules/.bin/tsx --test src/lib/orthodontics/__tests__/produccion-sin-doctor.test.ts
 *
 * La factura de un control nace de su cita. Si la cita es «Sin doctor» y la factura tampoco
 * tiene doctor, el cobro se iba a «Sin doctor tratante» aunque el caso tuviera tratante. Ahora,
 * como último recurso, va a quien llevaba el caso el día del cobro. Con el código de
 * f4d8fe31d fallan las tres pruebas (daba `doctorId: null`).
 *
 * Ids con forma de cuid, de siembra y de una cita importada de Dentalink (no uuid), como en la base.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { doctorDeUnCobro, produccionPorDoctor, SIN_DOCTOR_TRATANTE, type PagoDeCaso } from "../produccion";
import { repartirPorDoctor } from "@/lib/dinero/ingresos";

const TRATANTE = "cmabc123xyz0000def456ghi"; // cuid
const ANTES = "seed-doctor-1"; // id de siembra
const OTRA = "clx9doc0a000108l4aaaa0002";
const PLAN = "cmplan00001orto000000001";
const CITA_DENTALINK = "dentalink-appt-88231";
const TZ = "America/Mexico_City";

test("control «Sin doctor» con factura sin doctor → al tratante del caso (no a «Sin doctor tratante»)", () => {
  const caso = { planId: PLAN, doctorActual: TRATANTE, cambios: [] };
  const r = doctorDeUnCobro(
    { paidAt: new Date("2026-11-03T17:00:00Z"), appointmentId: CITA_DENTALINK, facturaDoctorId: null, citaDoctorId: null },
    caso,
  );
  assert.deepEqual(r, { doctorId: TRATANTE, orto: true });
});

test("el último recurso es quien llevaba el caso EL DÍA del cobro; la factura y la cita siguen mandando", () => {
  const cambios = [{ planId: PLAN, at: new Date("2026-10-15T12:00:00Z"), de: ANTES, a: TRATANTE }];
  const caso = { planId: PLAN, doctorActual: TRATANTE, cambios };
  // Cobrado antes de la reasignación: era de ANTES.
  assert.equal(
    doctorDeUnCobro({ paidAt: new Date("2026-10-10T17:00:00Z"), appointmentId: CITA_DENTALINK, citaDoctorId: null }, caso).doctorId,
    ANTES,
  );
  // Con doctor en la factura o en la cita, como siempre (C-08).
  assert.equal(doctorDeUnCobro({ paidAt: new Date(), appointmentId: "c1", facturaDoctorId: OTRA, citaDoctorId: null }, caso).doctorId, OTRA);
  assert.equal(doctorDeUnCobro({ paidAt: new Date(), appointmentId: "c1", facturaDoctorId: null, citaDoctorId: OTRA }, caso).doctorId, OTRA);
  // Fuera de un caso, sin doctor sigue siendo «sin doctor».
  assert.deepEqual(doctorDeUnCobro({ paidAt: new Date(), appointmentId: "c1", facturaDoctorId: null, citaDoctorId: null }, null), { doctorId: null, orto: false });
});

test("la producción del mes y «Por doctor» de Finanzas reparten igual: el control va al tratante y el total no cambia", () => {
  const pagos: PagoDeCaso[] = [
    // Control agendado «Sin doctor» (cita importada de Dentalink), factura sin doctor.
    { planId: PLAN, invoiceId: "inv-ctrl-1", amount: 800, method: "cash", paidAt: new Date("2026-11-03T17:00:00Z"), appointmentId: CITA_DENTALINK, facturaDoctorId: null, citaDoctorId: null },
    // La mensualidad del tratamiento (sin cita).
    { planId: PLAN, invoiceId: "inv-trat-1", amount: 2_000, method: "card", paidAt: new Date("2026-11-02T17:00:00Z"), appointmentId: null, facturaDoctorId: null, citaDoctorId: null },
  ];
  const prod = produccionPorDoctor({
    pagos,
    doctorActualPorCaso: new Map([[PLAN, TRATANTE]]),
    cambios: [],
    nombres: new Map([[TRATANTE, "Dra. Renata Ruiz"]]),
    mes: "2026-11",
    zonaHoraria: TZ,
  });
  assert.deepEqual(prod, [{ doctorId: TRATANTE, doctorName: "Dra. Renata Ruiz", amountMxn: 2_800 }]);
  assert.ok(!prod.some((p) => p.doctorName === SIN_DOCTOR_TRATANTE));

  const finanzas = repartirPorDoctor({
    cobros: pagos.map((p) => ({ invoiceId: p.invoiceId, amount: p.amount, paidAt: p.paidAt, appointmentId: p.appointmentId ?? null, facturaDoctorId: p.facturaDoctorId ?? null, citaDoctorId: p.citaDoctorId ?? null })),
    reembolsos: [],
    casoPorFactura: new Map([["inv-ctrl-1", PLAN], ["inv-trat-1", PLAN]]),
    doctorActualPorCaso: new Map([[PLAN, TRATANTE]]),
    cambios: [],
  });
  assert.deepEqual(finanzas.get(TRATANTE), { total: 2_800, orto: 2_800 });
  assert.equal(finanzas.get(null), undefined, "nada queda «Sin doctor»");
});
