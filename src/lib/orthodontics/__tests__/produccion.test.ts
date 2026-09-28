// Producción de ortodoncia por pago (ws1-t5, ronda 6 — filas 88, 89 y 90).
// Puras: sin Prisma, sin DATABASE_URL.
//
//   npx tsx --test src/lib/orthodontics/__tests__/produccion.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DOCTOR_QUE_YA_NO_ESTA,
  SIN_DOCTOR_TRATANTE,
  cambioDeDoctorDesdeBitacora,
  doctorVigente,
  mesEnZona,
  pagosSinCita,
  produccionPorDoctor,
  rangoDelMes,
  totalesDePagos,
  type CambioDeDoctor,
  type PagoDeCaso,
} from "../produccion";

const TZ = "America/Mexico_City";
const NOMBRES = new Map([
  ["d-ana", "Dra. Ana"],
  ["d-luis", "Dr. Luis"],
]);

function pago(over: Partial<PagoDeCaso> = {}): PagoDeCaso {
  return {
    planId: "plan1",
    invoiceId: "f1",
    amount: 1000,
    method: "cash",
    paidAt: new Date("2026-09-10T18:00:00Z"),
    ...over,
  };
}

describe("mesEnZona", () => {
  it("un cobro del 30 de septiembre a las 19:00 en México es de septiembre, no de octubre", () => {
    // 30-sep 19:00 en México (UTC−6) = 1-oct 01:00 UTC.
    assert.equal(mesEnZona(new Date("2026-10-01T01:00:00Z"), TZ), "2026-09");
    assert.equal(mesEnZona(new Date("2026-10-01T06:00:00Z"), TZ), "2026-10");
  });
});

describe("rangoDelMes", () => {
  it("septiembre en México va del 1-sep 06:00 UTC al 1-oct 06:00 UTC", () => {
    const r = rangoDelMes("2026-09", TZ);
    assert.equal(r.desde.toISOString(), "2026-09-01T06:00:00.000Z");
    assert.equal(r.hasta.toISOString(), "2026-10-01T06:00:00.000Z");
  });
  it("diciembre termina en enero del año siguiente", () => {
    const r = rangoDelMes("2026-12", TZ);
    assert.equal(r.hasta.toISOString(), "2027-01-01T06:00:00.000Z");
  });
  it("todo instante de la ventana cae en ese mes, y sus bordes no", () => {
    const r = rangoDelMes("2026-09", TZ);
    assert.equal(mesEnZona(r.desde, TZ), "2026-09");
    assert.equal(mesEnZona(new Date(r.hasta.getTime() - 1), TZ), "2026-09");
    assert.equal(mesEnZona(r.hasta, TZ), "2026-10");
    assert.equal(mesEnZona(new Date(r.desde.getTime() - 1), TZ), "2026-08");
  });
});

describe("doctorVigente", () => {
  const cambios: CambioDeDoctor[] = [
    { planId: "plan1", at: new Date("2026-09-15T12:00:00Z"), de: "d-ana", a: "d-luis" },
    { planId: "plan1", at: new Date("2026-09-25T12:00:00Z"), de: "d-luis", a: "d-ana" },
    { planId: "otro", at: new Date("2026-09-01T12:00:00Z"), de: "d-luis", a: "d-ana" },
  ];

  it("antes del primer cambio, el caso era de quien lo llevaba entonces", () => {
    assert.equal(doctorVigente("plan1", new Date("2026-09-10T00:00:00Z"), "d-ana", cambios), "d-ana");
  });
  it("entre dos cambios, es del doctor de en medio", () => {
    assert.equal(doctorVigente("plan1", new Date("2026-09-20T00:00:00Z"), "d-ana", cambios), "d-luis");
  });
  it("después del último cambio, es del doctor actual", () => {
    assert.equal(doctorVigente("plan1", new Date("2026-09-26T00:00:00Z"), "d-ana", cambios), "d-ana");
  });
  it("sin cambios registrados, es del doctor actual", () => {
    assert.equal(doctorVigente("sin-historial", new Date("2026-09-10T00:00:00Z"), "d-luis", cambios), "d-luis");
  });
  it("no mezcla los cambios de otro caso", () => {
    assert.equal(doctorVigente("otro", new Date("2026-09-10T00:00:00Z"), "d-ana", cambios), "d-ana");
    assert.equal(doctorVigente("otro", new Date("2026-08-10T00:00:00Z"), "d-ana", cambios), "d-luis");
  });
  it("un caso que no tenía doctor antes del cambio queda sin doctor para los pagos viejos", () => {
    const c: CambioDeDoctor[] = [{ planId: "p", at: new Date("2026-09-15T00:00:00Z"), de: null, a: "d-ana" }];
    assert.equal(doctorVigente("p", new Date("2026-09-01T00:00:00Z"), "d-ana", c), null);
  });
});

describe("produccionPorDoctor", () => {
  const doctorActualPorCaso = new Map<string, string | null>([
    ["plan1", "d-luis"],
    ["plan2", "d-ana"],
    ["plan3", null],
  ]);

  it("reasignar un caso NO le pasa al doctor nuevo lo cobrado antes (fila 88)", () => {
    const r = produccionPorDoctor({
      pagos: [
        pago({ paidAt: new Date("2026-09-05T18:00:00Z"), amount: 3000 }), // lo cobró Ana
        pago({ paidAt: new Date("2026-09-20T18:00:00Z"), amount: 1000 }), // ya con Luis
      ],
      doctorActualPorCaso,
      cambios: [{ planId: "plan1", at: new Date("2026-09-15T12:00:00Z"), de: "d-ana", a: "d-luis" }],
      nombres: NOMBRES,
      mes: "2026-09",
      zonaHoraria: TZ,
    });
    assert.deepEqual(r, [
      { doctorId: "d-ana", doctorName: "Dra. Ana", amountMxn: 3000 },
      { doctorId: "d-luis", doctorName: "Dr. Luis", amountMxn: 1000 },
    ]);
  });

  it("un reembolso RESTA; no se suma como cobro (fila 88)", () => {
    const r = produccionPorDoctor({
      pagos: [
        pago({ planId: "plan2", amount: 5000 }),
        pago({ planId: "plan2", amount: 1500, method: "refund" }),
      ],
      doctorActualPorCaso,
      cambios: [],
      nombres: NOMBRES,
      mes: "2026-09",
      zonaHoraria: TZ,
    });
    assert.deepEqual(r, [{ doctorId: "d-ana", doctorName: "Dra. Ana", amountMxn: 3500 }]);
  });

  it("un cobro devuelto entero no deja al doctor con producción", () => {
    const r = produccionPorDoctor({
      pagos: [pago({ planId: "plan2", amount: 5000 }), pago({ planId: "plan2", amount: 5000, method: "refund" })],
      doctorActualPorCaso,
      cambios: [],
      nombres: NOMBRES,
      zonaHoraria: TZ,
    });
    assert.deepEqual(r, []);
  });

  it("si en el mes solo hubo un reembolso, el neto sale negativo: no se esconde", () => {
    const r = produccionPorDoctor({
      pagos: [pago({ planId: "plan2", amount: 800, method: "refund" })],
      doctorActualPorCaso,
      cambios: [],
      nombres: NOMBRES,
      zonaHoraria: TZ,
    });
    assert.deepEqual(r, [{ doctorId: "d-ana", doctorName: "Dra. Ana", amountMxn: -800 }]);
  });

  it("solo cuenta los pagos del mes pedido, en la zona de la clínica", () => {
    const r = produccionPorDoctor({
      pagos: [
        pago({ planId: "plan2", amount: 100, paidAt: new Date("2026-09-01T05:59:00Z") }), // 31-ago 23:59 en México
        pago({ planId: "plan2", amount: 200, paidAt: new Date("2026-09-01T06:00:00Z") }), // 1-sep 00:00
        pago({ planId: "plan2", amount: 400, paidAt: new Date("2026-10-01T05:59:00Z") }), // 30-sep 23:59
        pago({ planId: "plan2", amount: 800, paidAt: new Date("2026-10-01T06:00:00Z") }), // 1-oct 00:00
      ],
      doctorActualPorCaso,
      cambios: [],
      nombres: NOMBRES,
      mes: "2026-09",
      zonaHoraria: TZ,
    });
    assert.deepEqual(r, [{ doctorId: "d-ana", doctorName: "Dra. Ana", amountMxn: 600 }]);
  });

  it("caso sin doctor, doctor que ya no está y caso que el usuario no puede ver", () => {
    const r = produccionPorDoctor({
      pagos: [
        pago({ planId: "plan3", amount: 700 }),
        pago({ planId: "plan1", amount: 900, paidAt: new Date("2026-09-02T18:00:00Z") }),
        pago({ planId: "plan-invisible", amount: 99999 }),
      ],
      doctorActualPorCaso,
      cambios: [{ planId: "plan1", at: new Date("2026-09-15T12:00:00Z"), de: "d-se-fue", a: "d-luis" }],
      nombres: NOMBRES,
      mes: "2026-09",
      zonaHoraria: TZ,
    });
    assert.deepEqual(r, [
      { doctorId: "d-se-fue", doctorName: DOCTOR_QUE_YA_NO_ESTA, amountMxn: 900 },
      { doctorId: null, doctorName: SIN_DOCTOR_TRATANTE, amountMxn: 700 },
    ]);
  });

  it("suma en centavos: tres abonos de 33.33 y uno de 0.01 dan 100.00", () => {
    const r = produccionPorDoctor({
      pagos: [33.33, 33.33, 33.33, 0.01].map((amount) => pago({ planId: "plan2", amount })),
      doctorActualPorCaso,
      cambios: [],
      nombres: NOMBRES,
      zonaHoraria: TZ,
    });
    assert.equal(r[0]?.amountMxn, 100);
  });
});

describe("totalesDePagos", () => {
  it("separa lo cobrado de lo reembolsado", () => {
    assert.deepEqual(
      totalesDePagos([pago({ amount: 1000 }), pago({ amount: 250.5, method: "refund" }), pago({ amount: 99.5, method: "transfer" })]),
      { cobrado: 1099.5, reembolsado: 250.5, neto: 849 },
    );
  });
});

describe("cambioDeDoctorDesdeBitacora", () => {
  const createdAt = new Date("2026-09-15T12:00:00Z");
  it("lee una reasignación", () => {
    assert.deepEqual(
      cambioDeDoctorDesdeBitacora({
        entityId: "plan1",
        createdAt,
        changes: { treatingDoctorId: { before: "d-ana", after: "d-luis" } },
      }),
      { planId: "plan1", at: createdAt, de: "d-ana", a: "d-luis" },
    );
  });
  it("lee la primera asignación de un caso que no tenía doctor", () => {
    assert.deepEqual(
      cambioDeDoctorDesdeBitacora({ entityId: "p", createdAt, changes: { treatingDoctorId: { before: null, after: "d-ana" } } }),
      { planId: "p", at: createdAt, de: null, a: "d-ana" },
    );
  });
  it("una fila que no tocó al doctor no es un cambio", () => {
    assert.equal(cambioDeDoctorDesdeBitacora({ entityId: "p", createdAt, changes: { status: { before: "PLANNED", after: "IN_PROGRESS" } } }), null);
    assert.equal(cambioDeDoctorDesdeBitacora({ entityId: "p", createdAt, changes: null }), null);
    assert.equal(cambioDeDoctorDesdeBitacora({ entityId: "p", createdAt, changes: "texto" }), null);
    assert.equal(cambioDeDoctorDesdeBitacora({ entityId: "p", createdAt, changes: { treatingDoctorId: { before: "d-ana", after: "d-ana" } } }), null);
  });
});

describe("pagosSinCita (fila 89)", () => {
  it("deja fuera el cargo de un control: la analítica ya lo cuenta por su cita", () => {
    const pagos = [
      pago({ invoiceId: "tratamiento", amount: 3000, appointmentId: null }),
      pago({ invoiceId: "extra", amount: 500 }),
      pago({ invoiceId: "control", amount: 800, appointmentId: "cita-1" }),
    ];
    assert.deepEqual(pagosSinCita(pagos).map((p) => p.invoiceId), ["tratamiento", "extra"]);
  });
});
