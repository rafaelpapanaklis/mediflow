// UNA regla de atribución por doctor también en Ortodoncia (ws1-t2, auditoría
// de uso del 3/4-oct-2026, C-08). Puras: sin Prisma.
//
//   npm run test:orto-regla-unica
//
// Lo que vio la auditoría (t2 A5, t9 cruces y prueba 35): Finanzas › Ortodoncia
// daba Alejandro $1,300 y Mariana $800; «Por doctor», la Analítica y la nómina,
// Alejandro $1,000 y Mariana $500. El bloque de Ortodoncia mandaba TODO pago
// de un caso al doctor del caso (también el control MF-1110 de $300, que nació
// de una cita de T9final) y contaba el saldo a favor aplicado ($300 de MF-1097)
// como cobrado. Con el código viejo falla: `doctorDeUnCobro` no existía y
// `produccionPorDoctor` daba Alejandro $1,300.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repartirPorDoctor, type MovimientoDeDoctor } from "@/lib/dinero/ingresos";
import { doctorDeUnCobro, idsSinNombre, produccionPorDoctor, type PagoDeCaso } from "../produccion";

const TZ = "America/Mexico_City";
const NOMBRES = new Map([
  ["d-alejandro", "Alejandro"],
  ["d-mariana", "Mariana"],
  ["d-t9", "T9final Ortodoncista"],
]);

// Casos: Alejandro lleva plan-a; Mariana, plan-m.
const doctorActualPorCaso = new Map<string, string | null>([["plan-a", "d-alejandro"], ["plan-m", "d-mariana"]]);
const casoPorFactura = new Map([
  ["f-trat-a", "plan-a"],
  ["mf-1110", "plan-a"],
  ["f-trat-m", "plan-m"],
  ["mf-1097", "plan-m"],
]);

// Cobros del periodo (ya sin el saldo a favor aplicado: eso lo quita el cargador, ver produccion-db.test).
const pagos: PagoDeCaso[] = [
  { planId: "plan-a", invoiceId: "f-trat-a", amount: 1000, method: "cash", paidAt: new Date("2026-10-02T17:00:00Z"), appointmentId: null },
  // El control de octubre nació de una cita de T9final: es de T9final, no del doctor del caso.
  { planId: "plan-a", invoiceId: "mf-1110", amount: 300, method: "cash", paidAt: new Date("2026-10-03T17:00:00Z"), appointmentId: "cita-t9", facturaDoctorId: null, citaDoctorId: "d-t9" },
  { planId: "plan-m", invoiceId: "f-trat-m", amount: 500, method: "transfer", paidAt: new Date("2026-10-02T18:00:00Z"), appointmentId: null },
];

const comoMovimiento = (p: PagoDeCaso): MovimientoDeDoctor => ({
  invoiceId: p.invoiceId,
  amount: p.amount,
  paidAt: p.paidAt,
  facturaDoctorId: p.facturaDoctorId ?? null,
  appointmentId: p.appointmentId ?? null,
  citaDoctorId: p.citaDoctorId ?? null,
});

describe("C-08: Ortodoncia reparte con la misma regla que «Por doctor»", () => {
  it("el control que nació de una cita va al doctor de la cita; el tratamiento, a quien lleva el caso", () => {
    const filas = produccionPorDoctor({ pagos, doctorActualPorCaso, cambios: [], nombres: NOMBRES, zonaHoraria: TZ });
    assert.deepEqual(
      filas.map((f) => [f.doctorName, f.amountMxn]),
      [["Alejandro", 1000], ["Mariana", 500], ["T9final Ortodoncista", 300]],
    );
  });

  it("cada doctor recibe en Ortodoncia lo mismo que en «Por doctor» por esos cobros", () => {
    const orto = produccionPorDoctor({ pagos, doctorActualPorCaso, cambios: [], nombres: NOMBRES, zonaHoraria: TZ });
    const porDoctor = repartirPorDoctor({
      cobros: pagos.map(comoMovimiento),
      reembolsos: [],
      casoPorFactura,
      doctorActualPorCaso,
      cambios: [],
    });
    for (const f of orto) assert.equal(porDoctor.get(f.doctorId)?.total, f.amountMxn, f.doctorName);
    assert.equal(orto.reduce((s, f) => s + f.amountMxn, 0), Array.from(porDoctor.values()).reduce((s, v) => s + v.total, 0));
  });

  it("la regla: cita → factura, si no la cita; caso sin cita → quien lo llevaba ese día; si no, la factura", () => {
    const caso = { planId: "p", doctorActual: "d-hoy", cambios: [{ planId: "p", at: new Date("2026-10-05T00:00:00Z"), de: "d-antes", a: "d-hoy" }] };
    const dia = new Date("2026-10-02T12:00:00Z");
    assert.deepEqual(doctorDeUnCobro({ paidAt: dia, appointmentId: "c", facturaDoctorId: "d-fac", citaDoctorId: "d-cita" }, caso), { doctorId: "d-fac", orto: true });
    assert.deepEqual(doctorDeUnCobro({ paidAt: dia, appointmentId: "c", facturaDoctorId: null, citaDoctorId: "d-cita" }, caso), { doctorId: "d-cita", orto: true });
    assert.deepEqual(doctorDeUnCobro({ paidAt: dia, appointmentId: null, facturaDoctorId: "d-fac" }, caso), { doctorId: "d-antes", orto: true });
    assert.deepEqual(doctorDeUnCobro({ paidAt: dia, appointmentId: null, facturaDoctorId: "d-fac" }, null), { doctorId: "d-fac", orto: false });
    assert.deepEqual(doctorDeUnCobro({ paidAt: dia }, null), { doctorId: null, orto: false });
  });

  it("los doctores sin nombre (el de la cita, el de un cambio) se piden a la base", () => {
    assert.deepEqual(idsSinNombre(pagos, [{ planId: "plan-a", at: new Date(), de: "d-viejo", a: "d-alejandro" }], new Map([["d-alejandro", "A"]])), ["d-t9", "d-viejo"]);
  });
});

describe("C-08: la pantalla dice qué regla usa", () => {
  it("el bloque «Ortodoncia» de Finanzas lleva su «Qué cuenta» de la regla única, en es y en", async () => {
    const { readFileSync } = await import("node:fs");
    const leer = (f: string) => readFileSync(`${process.cwd()}/${f}`, "utf8");
    assert.match(leer("src/components/dashboard/finanzas-rediseno/bloque-ortodoncia.tsx"), /clave="ortoPorDoctor"/);
    for (const l of ["es", "en"]) {
      const d = JSON.parse(leer(`src/i18n/dictionaries/${l}.json`));
      assert.equal(typeof d.queCuenta.ortoPorDoctor, "string", l);
      assert.match(d.queCuenta.ortoCobrado, l === "es" ? /saldo a favor/ : /credit balance/, l);
    }
  });
});

describe("C-08 (segunda vuelta): «incluye $X de ortodoncia» de la Analítica = Finanzas › Ortodoncia", () => {
  it("el control que nació de una cita también es dinero de ortodoncia (T9final $4,000 + $300 = $4,300)", () => {
    // La foto de t6: MF-1132 ($4,000, factura del tratamiento del caso de T9final, sin cita) y
    // MF-1110 ($300, control del mismo caso cobrado desde una cita de T9final).
    const casos = new Map<string, string | null>([["plan-t9", "d-t9"]]);
    const pagosT9: PagoDeCaso[] = [
      { planId: "plan-t9", invoiceId: "mf-1132", amount: 4000, method: "cash", paidAt: new Date("2026-10-03T17:00:00Z"), appointmentId: null },
      { planId: "plan-t9", invoiceId: "mf-1110", amount: 300, method: "cash", paidAt: new Date("2026-10-03T18:00:00Z"), appointmentId: "cita-1110", facturaDoctorId: null, citaDoctorId: "d-t9" },
    ];
    const finanzas = produccionPorDoctor({ pagos: pagosT9, doctorActualPorCaso: casos, cambios: [], nombres: NOMBRES, zonaHoraria: TZ });
    const analitica = repartirPorDoctor({
      cobros: pagosT9.map(comoMovimiento),
      reembolsos: [],
      casoPorFactura: new Map([["mf-1132", "plan-t9"], ["mf-1110", "plan-t9"]]),
      doctorActualPorCaso: casos,
      cambios: [],
    });
    assert.equal(finanzas[0].amountMxn, 4300);
    assert.deepEqual(analitica.get("d-t9"), { total: 4300, orto: 4300 }, "antes: orto 4,000 (el control con cita no contaba)");
  });
});
