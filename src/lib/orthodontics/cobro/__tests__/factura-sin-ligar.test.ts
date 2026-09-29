import { test } from "node:test";
import assert from "node:assert/strict";
import { facturaSinLigarReciente, type FacturaRecienteParaLigar } from "../facturas-ligables";

const ahora = new Date("2026-09-28T20:00:00Z");
const f = (o: Partial<FacturaRecienteParaLigar>): FacturaRecienteParaLigar => ({
  id: "i1", invoiceNumber: "MF-1", items: [{ name: "Tratamiento de ortodoncia (Brackets metálicos)" }], total: 24000,
  createdAt: new Date("2026-09-28T19:30:00Z"), status: "PENDING", appointmentId: null, ligadaACaso: null, ...o,
});

test("ofrece la factura de ortodoncia recién creada y sin ligar", () => {
  assert.equal(facturaSinLigarReciente([f({})], ahora)?.id, "i1");
});
test("no ofrece las viejas, las de cita, las ya ligadas, las canceladas ni las de otro concepto", () => {
  assert.equal(facturaSinLigarReciente([f({ createdAt: new Date("2026-09-20T00:00:00Z") })], ahora), null);
  assert.equal(facturaSinLigarReciente([f({ appointmentId: "a" })], ahora), null);
  assert.equal(facturaSinLigarReciente([f({ ligadaACaso: "c" })], ahora), null);
  assert.equal(facturaSinLigarReciente([f({ status: "CANCELLED" })], ahora), null);
  assert.equal(facturaSinLigarReciente([f({ items: [{ name: "Limpieza" }] })], ahora), null);
});
test("entre varias, la más nueva", () => {
  const r = facturaSinLigarReciente([f({ id: "vieja", createdAt: new Date("2026-09-28T10:00:00Z") }), f({ id: "nueva" })], ahora);
  assert.equal(r?.id, "nueva");
});
