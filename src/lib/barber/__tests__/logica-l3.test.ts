// Revisión de lógica de uso L3 (15-nov): Equipo, Barberos, Mi web y la cara del cliente.
//
//   npx tsx --test src/lib/barber/__tests__/logica-l3.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { opcionesDeFicha } from "@/lib/barber/team-fichas";

const barberos = [
  { id: "b1", name: "Luis", barbershopId: "s1" },
  { id: "b2", name: "Toño", barbershopId: "s1" },
  { id: "b3", name: "Mario", barbershopId: "s2" },
];
const miembros = [
  { id: "u1", firstName: "Luis", lastName: "R", barberId: "b1", isActive: true },
  { id: "u2", firstName: "Viejo", lastName: "X", barberId: "b2", isActive: false },
];

test("Equipo: la ficha ya ligada a otra persona activa dice de quién es", () => {
  const o = opcionesDeFicha(barberos, miembros, { barbershopId: "s1" });
  assert.deepEqual(o, [
    { id: "b1", name: "Luis", ligadaA: "Luis R" },
    // u2 está dado de baja: su ficha queda libre
    { id: "b2", name: "Toño", ligadaA: null },
  ]);
});

test("Equipo: al editar a quien ya tiene la ficha, no se marca como ajena", () => {
  const o = opcionesDeFicha(barberos, miembros, { barbershopId: "s1", miembroId: "u1" });
  assert.equal(o.find((x) => x.id === "b1")?.ligadaA, null);
});

test("Equipo: solo fichas de la sede de la persona (el servidor rechaza las otras)", () => {
  const o = opcionesDeFicha(barberos, miembros, { barbershopId: "s2" });
  assert.deepEqual(o.map((x) => x.id), ["b3"]);
});

test("Equipo: la ficha actual de otra sede se conserva para no desligarla al guardar", () => {
  const o = opcionesDeFicha(barberos, miembros, { barbershopId: "s2", miembroId: "u1", actual: "b1" });
  assert.deepEqual(o.map((x) => x.id), ["b1", "b3"]);
});
