// WS1-T5 — anticipo por WhatsApp: las reglas del dinero, sin base ni red.
// Correr: npm run test:anticipos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANTICIPO_MINIMO_MXN,
  PANEL_HORAS_MAX,
  PANEL_HORAS_MIN,
  calcularComision,
  calcularMontoAnticipo,
  citaEsFuturaParaAnticipo,
  evaluarPago,
  refDeAnticipo,
  sugeridoAnticipoPanel,
  validarConfiguracion,
  validarConfiguracionPanel,
  validarMontoAnticipoManual,
  validarPlazoPanelHoras,
  type PagoMp,
} from "../core";
import { apartadoVencido, sinApartadoVencido } from "../../agenda/apartado";

const FIJO = { modo: "fixed" as const, monto: 300, porcentaje: 0 };

describe("cuánto se cobra (lo decide el servidor)", () => {
  it("monto fijo por clínica: el default del encargo", () => {
    assert.equal(calcularMontoAnticipo(FIJO, null), 300);
    // El precio del servicio no cambia un anticipo fijo.
    assert.equal(calcularMontoAnticipo(FIJO, 1800), 300);
  });

  it("porcentaje del precio del catálogo, y cae al fijo si no hay precio", () => {
    const pct = { modo: "percent" as const, monto: 250, porcentaje: 20 };
    assert.equal(calcularMontoAnticipo(pct, 1500), 300);
    assert.equal(calcularMontoAnticipo(pct, 999.99), 200);
    assert.equal(calcularMontoAnticipo(pct, null), 250);
    assert.equal(calcularMontoAnticipo(pct, 0), 250);
  });

  it("total = el precio del servicio; sin precio, el fijo", () => {
    const total = { modo: "total" as const, monto: 300, porcentaje: 0 };
    assert.equal(calcularMontoAnticipo(total, 850), 850);
    assert.equal(calcularMontoAnticipo(total, undefined), 300);
  });

  it("por debajo del mínimo la cita va SIN anticipo (null)", () => {
    assert.equal(calcularMontoAnticipo({ modo: "fixed", monto: 0, porcentaje: 0 }, null), null);
    assert.equal(calcularMontoAnticipo({ modo: "percent", monto: 0, porcentaje: 5 }, 100), null);
    assert.equal(calcularMontoAnticipo({ modo: "fixed", monto: 9.99, porcentaje: 0 }, null), null);
    assert.equal(calcularMontoAnticipo({ modo: "fixed", monto: 10, porcentaje: 0 }, null), 10);
  });
});

describe("marketplace_fee: Mercado Pago recibe PESOS, nunca un porcentaje", () => {
  it("arranca en 0 y en 0 no se manda nada", () => {
    assert.equal(calcularComision("fixed", 0, 300), 0);
    assert.equal(calcularComision("percent", 0, 300), 0);
  });

  it("un % configurado se convierte a pesos en cada cobro", () => {
    assert.equal(calcularComision("percent", 5, 300), 15);
    assert.equal(calcularComision("percent", 3.5, 333), 11.66);
  });

  it("un fijo se manda tal cual", () => {
    assert.equal(calcularComision("fixed", 12.5, 300), 12.5);
  });

  it("una comisión que se come el anticipo no genera link (null)", () => {
    assert.equal(calcularComision("fixed", 300, 300), null);
    assert.equal(calcularComision("fixed", 500, 300), null);
  });
});

describe("validar lo que guarda la pantalla", () => {
  it("acepta lo normal", () => {
    assert.equal(validarConfiguracion({ modo: "fixed", monto: 300, porcentaje: 0, minutos: 30 }), null);
    assert.equal(validarConfiguracion({ modo: "percent", monto: 0, porcentaje: 20, minutos: 45 }), null);
  });
  it("rechaza lo roto", () => {
    assert.ok(validarConfiguracion({ modo: "fixed", monto: 0, porcentaje: 0, minutos: 30 }));
    assert.ok(validarConfiguracion({ modo: "fixed", monto: 5, porcentaje: 0, minutos: 30 }));
    assert.ok(validarConfiguracion({ modo: "percent", monto: 0, porcentaje: 0, minutos: 30 }));
    assert.ok(validarConfiguracion({ modo: "percent", monto: 0, porcentaje: 101, minutos: 30 }));
    assert.ok(validarConfiguracion({ modo: "fixed", monto: 300, porcentaje: 0, minutos: 5 }));
    assert.ok(validarConfiguracion({ modo: "fixed", monto: 300, porcentaje: 0, minutos: 24 * 60 }));
    assert.ok(validarConfiguracion({ modo: "otro", monto: 300, porcentaje: 0, minutos: 30 }));
  });
});

describe("qué se hace con un pago (webhook)", () => {
  const anticipo = { id: "dep1", amount: 300, status: "PENDING", mpCollectorId: "999" };
  const pago = (over: Partial<PagoMp> = {}): PagoMp => ({
    status: "approved",
    statusDetail: "accredited",
    externalReference: refDeAnticipo("dep1"),
    transactionAmount: 300,
    currencyId: "MXN",
    collectorId: "999",
    ...over,
  });

  it("aprobado, de este anticipo, completo → se aplica y se confirma", () => {
    assert.deepEqual(evaluarPago(anticipo, pago()), { accion: "aplicar", monto: 300, confirmar: true, anomalia: null });
  });

  it("pending / in_process / rejected NO confirman: solo se anotan", () => {
    for (const status of ["pending", "in_process", "rejected", "cancelled"]) {
      const d = evaluarPago(anticipo, pago({ status, statusDetail: "x" }));
      assert.equal(d.accion, "anotar_estado", status);
    }
  });

  it("la referencia de OTRO anticipo se ignora (no confirma la cita equivocada)", () => {
    assert.equal(evaluarPago(anticipo, pago({ externalReference: refDeAnticipo("dep2") })).accion, "ignorar");
    assert.equal(evaluarPago(anticipo, pago({ externalReference: "dep1" })).accion, "ignorar");
    assert.equal(evaluarPago(anticipo, pago({ externalReference: null })).accion, "ignorar");
  });

  it("un pago cobrado por OTRA cuenta se ignora", () => {
    assert.equal(evaluarPago(anticipo, pago({ collectorId: "111" })).accion, "ignorar");
  });

  it("pagó menos: el dinero se registra (es suyo) pero la cita NO se confirma", () => {
    const d = evaluarPago(anticipo, pago({ transactionAmount: 1 }));
    assert.equal(d.accion, "aplicar");
    if (d.accion === "aplicar") {
      assert.equal(d.confirmar, false);
      assert.equal(d.monto, 1);
      assert.ok(d.anomalia);
    }
    // 299.99 tampoco pasa por 300: se compara en centavos.
    const casi = evaluarPago(anticipo, pago({ transactionAmount: 299.99 }));
    assert.equal(casi.accion === "aplicar" && casi.confirmar, false);
  });

  it("segundo pago del mismo anticipo ya pagado: se registra y se marca para devolver", () => {
    const d = evaluarPago({ ...anticipo, status: "PAID" }, pago());
    assert.equal(d.accion, "aplicar");
    if (d.accion === "aplicar") {
      assert.equal(d.confirmar, false);
      assert.match(d.anomalia ?? "", /Segundo pago/);
    }
  });

  it("vencido (EXPIRED) pero pagado completo: se intenta confirmar (el servicio decide si el hueco sigue)", () => {
    const d = evaluarPago({ ...anticipo, status: "EXPIRED" }, pago());
    assert.deepEqual(d, { accion: "aplicar", monto: 300, confirmar: true, anomalia: null });
  });

  it("sin monto en MXN legible no se aplica nada", () => {
    assert.equal(evaluarPago(anticipo, pago({ currencyId: "USD" })).accion, "ignorar");
    assert.equal(evaluarPago(anticipo, pago({ transactionAmount: null })).accion, "ignorar");
  });
});

describe("la cita apartada caduca POR DATO", () => {
  const t0 = new Date("2026-09-22T16:00:00Z");
  it("SCHEDULED con plazo vencido ya no ocupa", () => {
    assert.equal(apartadoVencido({ status: "SCHEDULED", holdExpiresAt: new Date("2026-09-22T15:59:59Z") }, t0), true);
    assert.equal(apartadoVencido({ status: "SCHEDULED", holdExpiresAt: "2026-09-22T16:00:00Z" }, t0), true);
  });
  it("con plazo vivo, sin plazo, o confirmada a mano, sí ocupa", () => {
    assert.equal(apartadoVencido({ status: "SCHEDULED", holdExpiresAt: new Date("2026-09-22T16:00:01Z") }, t0), false);
    assert.equal(apartadoVencido({ status: "SCHEDULED", holdExpiresAt: null }, t0), false);
    assert.equal(apartadoVencido({ status: "SCHEDULED" }, t0), false);
    assert.equal(apartadoVencido({ status: "CONFIRMED", holdExpiresAt: new Date("2026-09-01T00:00:00Z") }, t0), false);
  });
  it("el filtro de Prisma usa OR (no NOT: con NULL se comería las citas normales)", () => {
    const w = sinApartadoVencido(t0) as { OR: unknown[] };
    assert.deepEqual(w, {
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: t0 } }, { status: { not: "SCHEDULED" } }],
    });
  });
});

// ── ws1-t3 fase 1 — anticipo pedido DESDE EL PANEL (cita o factura) ────────

describe("configuración del anticipo del panel: solo fixed/percent, sin 'total'", () => {
  it("acepta fixed y percent válidos", () => {
    assert.equal(validarConfiguracionPanel({ modo: "fixed", monto: 300, porcentaje: 0, horas: 24 }), null);
    assert.equal(validarConfiguracionPanel({ modo: "percent", monto: 0, porcentaje: 20, horas: 1 }), null);
  });
  it("rechaza 'total' (no es un modo del panel)", () => {
    assert.match(validarConfiguracionPanel({ modo: "total", monto: 300, porcentaje: 0, horas: 24 }) ?? "", /desconocido/);
  });
  it("el plazo va en HORAS, 1 a 48 (no minutos, no el tope de 240 del bot)", () => {
    assert.equal(validarConfiguracionPanel({ modo: "fixed", monto: 300, porcentaje: 0, horas: PANEL_HORAS_MIN }), null);
    assert.equal(validarConfiguracionPanel({ modo: "fixed", monto: 300, porcentaje: 0, horas: PANEL_HORAS_MAX }), null);
    assert.match(validarConfiguracionPanel({ modo: "fixed", monto: 300, porcentaje: 0, horas: 0 }) ?? "", /horas/);
    assert.match(validarConfiguracionPanel({ modo: "fixed", monto: 300, porcentaje: 0, horas: 49 }) ?? "", /horas/);
  });
});

describe("sugeridoAnticipoPanel: el % siempre es sobre el TOTAL de la factura", () => {
  it("fixed ignora el total", () => {
    assert.equal(sugeridoAnticipoPanel({ modo: "fixed", monto: 250, porcentaje: 0, horas: 24 }, 5000), 250);
  });
  it("percent calcula sobre el total de la factura, no un precio de catálogo", () => {
    assert.equal(sugeridoAnticipoPanel({ modo: "percent", monto: 250, porcentaje: 20, horas: 24 }, 2000), 400);
  });
  it("por debajo del mínimo, sin sugerido (null)", () => {
    assert.equal(sugeridoAnticipoPanel({ modo: "fixed", monto: 5, porcentaje: 0, horas: 24 }, 100), null);
  });
});

describe("validarMontoAnticipoManual: 10 ≤ monto ≤ total − pagado, SIEMPRE en el servidor", () => {
  it("dentro del rango, válido", () => {
    assert.equal(validarMontoAnticipoManual(500, 2000, 0), null);
    assert.equal(validarMontoAnticipoManual(2000, 2000, 0), null); // el total completo también es válido
  });
  it("por debajo del mínimo, inválido aunque el saldo alcance de sobra", () => {
    assert.match(validarMontoAnticipoManual(9.99, 2000, 0) ?? "", /mínimo/);
    assert.equal(validarMontoAnticipoManual(ANTICIPO_MINIMO_MXN, 2000, 0), null);
  });
  it("por encima del saldo pendiente (total − pagado), inválido: nunca se cobra de más", () => {
    assert.match(validarMontoAnticipoManual(1501, 2000, 500) ?? "", /saldo pendiente/);
    assert.equal(validarMontoAnticipoManual(1500, 2000, 500), null);
  });
  it("un monto que el cliente manda manipulado (NaN, texto) se rechaza igual", () => {
    assert.match(validarMontoAnticipoManual(NaN, 2000, 0) ?? "", /válido/);
  });
});

describe("validarPlazoPanelHoras", () => {
  it("1 a 48 horas, entero", () => {
    assert.equal(validarPlazoPanelHoras(24), null);
    assert.match(validarPlazoPanelHoras(0) ?? "", /horas/);
    assert.match(validarPlazoPanelHoras(49) ?? "", /horas/);
    assert.match(validarPlazoPanelHoras(1.5) ?? "", /horas/);
  });
});

describe("citaEsFuturaParaAnticipo — Ajuste 2 (decisión de Rafael): SOLO citas futuras", () => {
  const ahora = new Date("2026-09-27T18:00:00Z");
  const futuro = new Date("2026-09-27T19:00:00Z");
  const pasado = new Date("2026-09-27T17:00:00Z");

  it("SCHEDULED futura: sí", () => {
    assert.equal(citaEsFuturaParaAnticipo({ status: "SCHEDULED", startsAt: futuro }, ahora), true);
  });
  it("CONFIRMED futura: también sí (no solo SCHEDULED)", () => {
    assert.equal(citaEsFuturaParaAnticipo({ status: "CONFIRMED", startsAt: futuro }, ahora), true);
  });
  it("SCHEDULED pero ya pasó: no", () => {
    assert.equal(citaEsFuturaParaAnticipo({ status: "SCHEDULED", startsAt: pasado }, ahora), false);
  });
  it("justo ahora (ni un segundo de margen): no — tiene que ser estrictamente después", () => {
    assert.equal(citaEsFuturaParaAnticipo({ status: "SCHEDULED", startsAt: ahora }, ahora), false);
  });
  it("cualquier otro estado, aunque sea futura: no (CHECKED_IN, COMPLETED, CANCELLED, NO_SHOW…)", () => {
    for (const status of ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW", "PENDING"]) {
      assert.equal(citaEsFuturaParaAnticipo({ status, startsAt: futuro }, ahora), false, status);
    }
  });
});
