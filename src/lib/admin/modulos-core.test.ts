/**
 * Módulos por clínica en /admin: origen, estado, aporte al MRR y qué pasa al
 * apagar o encender.
 *
 *   npx tsx --test src/lib/admin/modulos-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aporteMensualModulo,
  computeMrrModulos,
  estadoModulo,
  modulosDeClinica,
  modulosEnUso,
  origenModulo,
  planDeApagado,
  planDeEncendido,
  resumenMrrModulos,
  suscripcionesConBajaProgramada,
  type FilaModulo,
} from "./modulos-core";

const AHORA = new Date("2026-09-28T18:00:00Z");
const EN_UN_MES = "2026-10-28T18:00:00Z";
const AYER = "2026-09-27T18:00:00Z";

function fila(over: Partial<FilaModulo> = {}): FilaModulo {
  return {
    clinicId: "c1",
    moduleKey: "orthodontics",
    moduleName: "Ortodoncia",
    status: "active",
    paymentMethod: "card",
    billingCycle: "monthly",
    pricePaidMxn: 129,
    currentPeriodEnd: EN_UN_MES,
    tieneSuscripcionStripe: true,
    ...over,
  };
}

test("origen: la compra real se guarda como card/spei/oxxo, no como «stripe»", () => {
  assert.equal(origenModulo({ paymentMethod: "card" }), "tarjeta");
  assert.equal(origenModulo({ paymentMethod: "stripe" }), "tarjeta");
  assert.equal(origenModulo({ paymentMethod: "spei" }), "pago-unico");
  assert.equal(origenModulo({ paymentMethod: "oxxo" }), "pago-unico");
  assert.equal(origenModulo({ paymentMethod: "admin" }), "cortesia");
  assert.equal(origenModulo({ paymentMethod: "paypal" }), "paypal");
  assert.equal(origenModulo({ paymentMethod: "" }), "otro");
});

test("estado: activo, baja programada, cobro fallido, vencido y apagado", () => {
  assert.equal(estadoModulo(fila(), AHORA), "activo");
  assert.equal(estadoModulo(fila({ bajaProgramada: true }), AHORA), "baja-programada");
  assert.equal(estadoModulo(fila({ status: "paused" }), AHORA), "cobro-fallido");
  assert.equal(estadoModulo(fila({ paymentMethod: "spei", tieneSuscripcionStripe: false, currentPeriodEnd: AYER }), AHORA), "vencido");
  assert.equal(estadoModulo(fila({ status: "cancelled" }), AHORA), "cancelado");
});

test("estado: la baja programada solo aplica a una suscripción de tarjeta", () => {
  assert.equal(
    estadoModulo(fila({ paymentMethod: "admin", tieneSuscripcionStripe: true, bajaProgramada: true }), AHORA),
    "activo",
  );
});

test("aporte: mensual tal cual, anual entre 12, cortesía y no vigentes valen 0", () => {
  assert.equal(aporteMensualModulo(fila(), AHORA), 129);
  assert.equal(aporteMensualModulo(fila({ billingCycle: "annual", pricePaidMxn: 1316 }), AHORA), 109.67);
  assert.equal(aporteMensualModulo(fila({ paymentMethod: "admin", pricePaidMxn: 0, tieneSuscripcionStripe: false }), AHORA), 0);
  assert.equal(aporteMensualModulo(fila({ status: "paused" }), AHORA), 0);
  assert.equal(aporteMensualModulo(fila({ status: "cancelled" }), AHORA), 0);
  assert.equal(aporteMensualModulo(fila({ currentPeriodEnd: AYER }), AHORA), 0);
});

test("aporte: una cortesía no suma aunque la fila conserve un precio viejo", () => {
  assert.equal(aporteMensualModulo(fila({ paymentMethod: "admin", pricePaidMxn: 129 }), AHORA), 0);
});

test("aporte: la baja programada sigue sumando hasta que termina el periodo", () => {
  assert.equal(aporteMensualModulo(fila({ bajaProgramada: true }), AHORA), 129);
});

test("MRR de módulos: suma lo pagado, cuenta la cortesía aparte y no repite clínicas", () => {
  const mrr = computeMrrModulos(
    [
      fila({ clinicId: "c1" }),
      fila({ clinicId: "c2", billingCycle: "annual", pricePaidMxn: 1316 }),
      fila({ clinicId: "c3", paymentMethod: "admin", pricePaidMxn: 0, tieneSuscripcionStripe: false, currentPeriodEnd: "2099-12-31T23:59:59.999Z" }),
      fila({ clinicId: "c4", status: "cancelled" }),
      fila({ clinicId: "c1", moduleKey: "endodontics", moduleName: "Endodoncia", pricePaidMxn: 99 }),
    ],
    AHORA,
  );
  assert.equal(mrr.total, 129 + 109.67 + 99);
  assert.equal(mrr.clinicasPagando, 2);
  assert.deepEqual(
    mrr.porModulo.map((l) => [l.moduleKey, l.clinicas, l.pagando, l.cortesia, l.total]),
    [
      ["orthodontics", 3, 2, 1, 238.67],
      ["endodontics", 1, 1, 0, 99],
    ],
  );
  assert.equal(resumenMrrModulos(mrr), "3 Ortodoncia (1 de cortesía) · 1 Endodoncia");
});

test("MRR de módulos: una clínica archivada (fuera del universo) no suma", () => {
  const mrr = computeMrrModulos([fila({ clinicId: "c1" }), fila({ clinicId: "archivada" })], AHORA, new Set(["c1"]));
  assert.equal(mrr.total, 129);
  assert.equal(mrr.porModulo[0]?.clinicas, 1);
});

test("MRR de módulos: sin filas, vacío y con un texto que lo dice", () => {
  const mrr = computeMrrModulos([], AHORA);
  assert.equal(mrr.total, 0);
  assert.equal(resumenMrrModulos(mrr), "Ninguna clínica con módulos");
});

test("módulos de una clínica: los vigentes primero y la cortesía sin fecha de fin", () => {
  const lista = modulosDeClinica(
    [
      fila({ moduleKey: "viejo", moduleName: "Viejo", status: "cancelled" }),
      fila({ paymentMethod: "admin", pricePaidMxn: 0, tieneSuscripcionStripe: false, currentPeriodEnd: "2099-12-31T23:59:59.999Z" }),
    ],
    AHORA,
  );
  assert.deepEqual(lista.map((m) => m.moduleKey), ["orthodontics", "viejo"]);
  assert.equal(lista[0]?.origen, "cortesia");
  assert.equal(lista[0]?.hasta, null);
  assert.equal(lista[0]?.pagado, 0);
  assert.deepEqual(modulosEnUso(lista).map((m) => m.moduleKey), ["orthodontics"]);
});

test("apagar: una cortesía se apaga en el momento", () => {
  assert.deepEqual(
    planDeApagado(fila({ paymentMethod: "admin", tieneSuscripcionStripe: false }), AHORA),
    { tipo: "inmediato", motivo: "cortesia", pierdeHasta: null },
  );
});

test("apagar: pagado con tarjeta → baja al fin del periodo, no se apaga hoy", () => {
  assert.deepEqual(planDeApagado(fila(), AHORA), {
    tipo: "fin-de-periodo",
    hasta: new Date(EN_UN_MES).toISOString(),
    yaProgramada: false,
  });
  assert.equal(
    (planDeApagado(fila({ bajaProgramada: true }), AHORA) as { yaProgramada: boolean }).yaProgramada,
    true,
  );
});

test("apagar: tarjeta con cobro fallido → se cancela ya en Stripe para que deje de reintentar", () => {
  assert.deepEqual(planDeApagado(fila({ status: "paused" }), AHORA), { tipo: "cancelar-en-stripe-ya" });
});

test("apagar: tarjeta con el periodo ya vencido → no queda nada que conservar", () => {
  assert.deepEqual(planDeApagado(fila({ currentPeriodEnd: AYER }), AHORA), { tipo: "cancelar-en-stripe-ya" });
});

test("apagar: un pago único avisa de hasta cuándo había pagado", () => {
  assert.deepEqual(
    planDeApagado(fila({ paymentMethod: "spei", tieneSuscripcionStripe: false }), AHORA),
    { tipo: "inmediato", motivo: "pago-unico", pierdeHasta: new Date(EN_UN_MES).toISOString() },
  );
});

test("apagar: lo ya apagado no hace nada", () => {
  assert.deepEqual(planDeApagado(fila({ status: "cancelled" }), AHORA), { tipo: "nada", motivo: "ya-apagado" });
});

test("apagar: una cortesía que conserva un id de suscripción vieja no toca Stripe", () => {
  assert.equal(planDeApagado(fila({ paymentMethod: "admin", tieneSuscripcionStripe: true }), AHORA).tipo, "inmediato");
});

test("encender: sin fila, apagado o vencido → cortesía", () => {
  assert.deepEqual(planDeEncendido(null, AHORA), { tipo: "cortesia" });
  assert.deepEqual(planDeEncendido(fila({ status: "cancelled" }), AHORA), { tipo: "cortesia" });
  assert.deepEqual(planDeEncendido(fila({ paymentMethod: "spei", tieneSuscripcionStripe: false, currentPeriodEnd: AYER }), AHORA), { tipo: "cortesia" });
});

test("encender: con la baja programada se deshace la baja, no se regala encima", () => {
  assert.deepEqual(planDeEncendido(fila({ bajaProgramada: true }), AHORA), { tipo: "deshacer-baja" });
});

test("encender: con cobro fallido y suscripción viva, primero hay que cancelarla", () => {
  assert.deepEqual(planDeEncendido(fila({ status: "paused" }), AHORA), {
    tipo: "bloqueado",
    motivo: "cobro-fallido-con-suscripcion",
  });
});

test("encender: lo ya activo no se pisa (una suscripción pagada no se convierte en cortesía)", () => {
  assert.deepEqual(planDeEncendido(fila(), AHORA), { tipo: "nada", motivo: "ya-activo" });
});

test("bitácora: manda la última acción de cada suscripción", () => {
  const baja = (id: string, at: string, action: string) => ({
    entityId: id,
    createdAt: at,
    changes: { _source: { before: null, after: { action, moduleKey: "orthodontics" } } },
  });
  const set = suscripcionesConBajaProgramada([
    baja("sub_1", "2026-09-01T10:00:00Z", "cancel_at_period_end"),
    baja("sub_2", "2026-09-01T10:00:00Z", "cancel_at_period_end"),
    baja("sub_2", "2026-09-02T10:00:00Z", "resume"),
    baja("sub_3", "2026-09-03T10:00:00Z", "resume"),
    baja("sub_3", "2026-09-04T10:00:00Z", "cancel_at_period_end"),
    // Filas de la misma suscripción que no hablan de la baja (renovaciones del webhook).
    { entityId: "sub_1", createdAt: "2026-09-05T10:00:00Z", changes: { _source: { before: null, after: { event: "customer.subscription.updated" } } } },
    { entityId: "sub_4", createdAt: "2026-09-05T10:00:00Z", changes: null },
  ]);
  assert.deepEqual(Array.from(set).sort(), ["sub_1", "sub_3"]);
});
