// Reglas puras del Mercado Pago de la tienda de barber (ws6-t5).
// npx tsx --test src/lib/barber/__tests__/mercadopago-core.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_MP_CALLBACK_PATH,
  comisionDelPedido,
  desempacarIdaBarber,
  empacarIdaBarber,
  evaluarPagoDePedido,
  matrizDelDueno,
  motivoSinCobro,
  renglonesDelPedido,
  venceElPedido,
  vueltaSegura,
  type PagoLeido,
  type PedidoParaPago,
} from "../mercadopago-core";

const ITEMS = [
  { productId: "p1", name: "Cera mate", unitPrice: 189.5, qty: 2 },
  { productId: "p2", name: "Shampoo", unitPrice: 120, qty: 1 },
];

test("renglones a precio congelado, y la suma tiene que dar el total al centavo", () => {
  const r = renglonesDelPedido(ITEMS, 499);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.items, [
    { title: "Cera mate", quantity: 2, unit_price: 189.5 },
    { title: "Shampoo", quantity: 1, unit_price: 120 },
  ]);
  assert.equal(renglonesDelPedido(ITEMS, 499.01).ok, false, "un centavo de diferencia = no se cobra");
  assert.equal(renglonesDelPedido([], 0).ok, false);
  assert.equal(renglonesDelPedido([{ name: "x", unitPrice: 10, qty: 0 }], 0).ok, false, "cantidad 0");
  assert.equal(renglonesDelPedido([{ name: "x", unitPrice: -5, qty: 1 }], -5).ok, false, "precio negativo");
  assert.equal(renglonesDelPedido([{ name: "", unitPrice: 5, qty: 1 }], 5).ok, false, "sin nombre");
  assert.equal(renglonesDelPedido("[]", 0).ok, false);
  // 0.1 + 0.2 en flotante no rompe la cuenta: se suma en centavos.
  assert.ok(renglonesDelPedido([{ name: "a", unitPrice: 0.1, qty: 1 }, { name: "b", unitPrice: 10.2, qty: 1 }], 10.3).ok);
});

test("solo se cobra un pedido PENDING, vigente, sano y de al menos $10", () => {
  const creado = new Date("2026-11-15T10:00:00Z");
  const base = { id: "o1", status: "PENDING", total: 499, items: ITEMS, createdAt: creado };
  const antes = new Date("2026-11-18T09:59:00Z");
  assert.equal(motivoSinCobro(base, antes), null);
  assert.equal(venceElPedido(creado).toISOString(), "2026-11-18T10:00:00.000Z", "72 h");
  assert.equal(motivoSinCobro(base, new Date("2026-11-18T10:00:00Z")), "vencido");
  for (const st of ["PAID_ONLINE", "READY", "PICKED_UP", "CANCELLED", "EXPIRED"]) {
    assert.equal(motivoSinCobro({ ...base, status: st }, antes), "no_pendiente", st);
  }
  assert.equal(motivoSinCobro({ ...base, total: 500 }, antes), "renglones");
  assert.equal(
    motivoSinCobro({ ...base, total: 9.99, items: [{ name: "Liga", unitPrice: 9.99, qty: 1 }] }, antes),
    "bajo_minimo",
  );
});

const PEDIDO: PedidoParaPago = { id: "o1", status: "PENDING", total: 499, mpPaymentId: null, paidAt: null };
const PAGO: PagoLeido = {
  id: "9001",
  status: "approved",
  externalReference: "o1",
  transactionAmount: 499,
  currencyId: "MXN",
  collectorId: "777",
};

test("el pago marca el pedido solo si referencia, cuenta, estado, moneda e importe cuadran", () => {
  assert.deepEqual(evaluarPagoDePedido(PEDIDO, PAGO, "777"), { accion: "marcar", nuevoEstado: "PAID_ONLINE" });
  const ign = (p: Partial<PagoLeido>, pe: Partial<PedidoParaPago> = {}) =>
    evaluarPagoDePedido({ ...PEDIDO, ...pe }, { ...PAGO, ...p }, "777").accion;
  assert.equal(ign({ externalReference: "o2" }), "ignorar", "referencia de otro pedido");
  assert.equal(ign({ externalReference: null }), "ignorar");
  assert.equal(ign({ collectorId: "888" }), "ignorar", "lo cobró otra cuenta");
  assert.equal(ign({ status: "pending" }), "ignorar");
  assert.equal(ign({ status: "rejected" }), "ignorar");
  assert.equal(ign({ currencyId: "USD" }), "ignorar", "otra moneda");
  assert.equal(ign({ currencyId: null }), "ignorar");
  assert.equal(ign({ transactionAmount: 498.99 }), "ignorar", "un centavo menos");
  assert.equal(ign({ transactionAmount: 499.01 }), "ignorar", "un centavo más");
  assert.equal(ign({ transactionAmount: null }), "ignorar");
  assert.equal(ign({}, { status: "EXPIRED" }), "ignorar", "vencido no revive");
  assert.equal(ign({}, { status: "CANCELLED" }), "ignorar");
  assert.equal(ign({}, { status: "PICKED_UP" }), "ignorar");
});

test("idempotente: el mismo pago otra vez no vuelve a marcar; otro pago sobre un pedido pagado tampoco", () => {
  const pagado = { ...PEDIDO, status: "PAID_ONLINE", mpPaymentId: "9001", paidAt: new Date() };
  assert.deepEqual(evaluarPagoDePedido(pagado, PAGO, "777"), { accion: "ya_marcado" });
  assert.equal(evaluarPagoDePedido(pagado, { ...PAGO, id: "9002" }, "777").accion, "ignorar");
});

test("un pedido que la barbería dejó LISTO mientras el cliente pagaba queda pagado y sigue listo", () => {
  assert.deepEqual(evaluarPagoDePedido({ ...PEDIDO, status: "READY" }, PAGO, "777"), {
    accion: "marcar",
    nuevoEstado: "READY",
  });
});

test("comisión igual que el dental: en 0 no se cobra; fija y % en pesos; nunca se come el pedido", () => {
  assert.equal(comisionDelPedido("fixed", 0, 499), 0);
  assert.equal(comisionDelPedido("percent", 0, 499), 0);
  assert.equal(comisionDelPedido("fixed", 5, 499), 5);
  assert.equal(comisionDelPedido("percent", 3, 499), 14.97);
  assert.equal(comisionDelPedido("fixed", 600, 499), 0, "más que el pedido → sin comisión");
  assert.equal(comisionDelPedido("raro", 5, 499), 5, "modo desconocido = fijo");
});

test("la vuelta del checkout solo puede ser de la página de ESA barbería", () => {
  assert.equal(vueltaSegura("la-navaja", "o1", undefined), "/b/la-navaja/tienda/pedido/o1");
  assert.equal(vueltaSegura("la-navaja", "o1", "/b/la-navaja/tienda/pedido/o1?pago=1"), "/b/la-navaja/tienda/pedido/o1?pago=1");
  for (const mala of [
    "https://evil.example/x",
    "//evil.example/x",
    "/b/otra-barberia/tienda",
    "/b/la-navaja/../../admin",
    "/b/la-navaja/\\evil",
    "/b/la-navaja/x y",
    "/b/la-navaja//evil.example",
    42,
  ]) {
    assert.equal(vueltaSegura("la-navaja", "o1", mala), "/b/la-navaja/tienda/pedido/o1", String(mala));
  }
});

test("cookie del OAuth: ida y vuelta, y basura = sin ida", () => {
  const ida = { state: "s", verifier: "v", barbershopId: "b1", barberUserId: "u1" };
  assert.deepEqual(desempacarIdaBarber(empacarIdaBarber(ida)), ida);
  assert.equal(desempacarIdaBarber("no-es-base64-json"), null);
  assert.equal(desempacarIdaBarber(Buffer.from(JSON.stringify({ state: "s" })).toString("base64url")), null);
  assert.equal(desempacarIdaBarber(undefined), null);
  assert.equal(BARBER_MP_CALLBACK_PATH, "/api/barber/mercadopago/oauth/callback");
});

test("solo el DUEÑO de la matriz conecta; la sede que opera no cambia la cuenta", () => {
  const matriz = { id: "m", parentId: null };
  const sucursal = { id: "s", parentId: "m" };
  assert.equal(matrizDelDueno({ role: "OWNER", barbershop: matriz }), "m");
  assert.equal(matrizDelDueno({ role: "OWNER", barbershop: sucursal, homeBarbershop: matriz }), "m", "opera la sucursal");
  assert.equal(matrizDelDueno({ role: "OWNER", barbershop: sucursal, homeBarbershop: sucursal }), null, "dueño de sucursal");
  assert.equal(matrizDelDueno({ role: "RECEPTION", barbershop: matriz }), null);
  assert.equal(matrizDelDueno({ role: "MANAGER", barbershop: matriz }), null, "gerente tampoco");
  assert.equal(matrizDelDueno({ role: "BARBER", barbershop: matriz }), null);
});
