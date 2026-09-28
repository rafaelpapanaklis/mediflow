// ws1-t1 (Ortodoncia conectada a la reserva web). Run: npm run test:orto-landing-valoracion
import { test } from "node:test";
import assert from "node:assert/strict";
import { conControlDeOrtodoncia, conValoracionDeOrtodoncia } from "../landing-servicio-valoracion";

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

/* ── ws1-t1 ronda 2 — conControlDeOrtodoncia (paciente identificado) ──── */

test("sin caso activo (o sin sesión), la lista sale exactamente igual", () => {
  const servicios = [{ name: "Valoración de ortodoncia", price: null, durationMin: 45, icon: "🦷" }];
  assert.deepEqual(conControlDeOrtodoncia(servicios, null), servicios);
  assert.deepEqual(conControlDeOrtodoncia(servicios, undefined), servicios);
});

test("con caso activo, agrega Control de ortodoncia junto a Valoración", () => {
  const servicios = [{ name: "Valoración de ortodoncia", price: null, durationMin: 45, icon: "🦷" }];
  const out = conControlDeOrtodoncia(servicios, { label: "Control de ortodoncia", durationMin: 20 });
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { name: "Control de ortodoncia", price: null, durationMin: 20, icon: "🦷" });
});

test("si la clínica ya tiene un servicio llamado igual, no se duplica", () => {
  const servicios = [{ name: "Control de ortodoncia", price: "$300", durationMin: 30, icon: null }];
  const out = conControlDeOrtodoncia(servicios, { label: "Control de ortodoncia", durationMin: 20 });
  assert.equal(out.length, 1);
  assert.equal(out[0].price, "$300");
});
