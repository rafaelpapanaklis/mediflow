// ws1-t1 (Ortodoncia conectada a la reserva web). Run: npm run test:orto-landing-valoracion
import { test } from "node:test";
import assert from "node:assert/strict";
import { conValoracionDeOrtodoncia } from "../landing-servicio-valoracion";

test("sin módulo activo (orthoValoracion null), la lista sale exactamente igual", () => {
  const servicios = [{ name: "Limpieza dental", price: "$500", durationMin: 30, icon: null }];
  assert.deepEqual(conValoracionDeOrtodoncia(servicios, null), servicios);
  assert.deepEqual(conValoracionDeOrtodoncia(servicios, undefined), servicios);
});

test("con módulo activo, agrega Valoración de ortodoncia al final", () => {
  const servicios = [{ name: "Limpieza dental", price: "$500", durationMin: 30, icon: null }];
  const out = conValoracionDeOrtodoncia(servicios, { name: "Valoración de ortodoncia", durationMin: 45 });
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { name: "Valoración de ortodoncia", price: null, durationMin: 45, icon: "🦷" });
  assert.equal(out[0], servicios[0], "no toca lo que ya había");
});

test("si la clínica ya escribió ese servicio a mano en su landing, no se duplica", () => {
  const servicios = [{ name: "valoración de Ortodoncia ", price: "Desde $800", durationMin: 60, icon: "🦷" }];
  const out = conValoracionDeOrtodoncia(servicios, { name: "Valoración de ortodoncia", durationMin: 45 });
  assert.equal(out.length, 1, "gana lo que la clínica ya escribió, no se agrega un segundo");
  assert.equal(out[0].price, "Desde $800");
});

test("catálogo público vacío + módulo activo: la lista nace con solo Valoración", () => {
  const out = conValoracionDeOrtodoncia([], { name: "Valoración de ortodoncia", durationMin: 45 });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Valoración de ortodoncia");
});
