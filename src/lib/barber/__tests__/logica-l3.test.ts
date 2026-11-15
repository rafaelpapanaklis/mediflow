// Revisión de lógica de uso L3 (15-nov): Equipo, Barberos, Mi web y la cara del cliente.
//
//   npx tsx --test src/lib/barber/__tests__/logica-l3.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { opcionesDeFicha } from "@/lib/barber/team-fichas";
import { horarioDelLocalDesdeTurnos, turnosDesdeHorarioDelLocal } from "@/lib/barber/landing";
import { barberosQueTrabajanHoy, diaDeHoyEnZona } from "@/lib/barber/fila-barberos-hoy";

// ── Fila pública: solo quien trabaja HOY ──
test("Fila: el día de hoy se toma en la zona de la barbería, no la del servidor", () => {
  // 16-nov-2026 03:00 UTC = domingo 15-nov 21:00 en CDMX (lunes en UTC)
  const ahora = new Date("2026-11-16T03:00:00Z");
  assert.equal(diaDeHoyEnZona(ahora, "America/Mexico_City"), 0);
  assert.equal(diaDeHoyEnZona(ahora, "UTC"), 1);
  assert.equal(diaDeHoyEnZona(ahora, "zona/inventada"), 0); // cae a CDMX, no truena
});

test("Fila: no se ofrece al barbero que descansa hoy ni al que no tiene horario", () => {
  const barberos = [
    { id: "luis", schedules: [{ dayOfWeek: 1 }, { dayOfWeek: 2 }] },
    { id: "tono", schedules: [{ dayOfWeek: 2 }] },
    { id: "nuevo", schedules: [] },
  ];
  assert.deepEqual(barberosQueTrabajanHoy(barberos, 1).map((b) => b.id), ["luis"]);
  assert.deepEqual(barberosQueTrabajanHoy(barberos, 0).map((b) => b.id), []);
});

test("Fila: barbería sin ningún horario cargado (solo usa la fila) ofrece a todos", () => {
  const barberos = [{ id: "a", schedules: [] }, { id: "b", schedules: [] }];
  assert.deepEqual(barberosQueTrabajanHoy(barberos, 3).map((b) => b.id), ["a", "b"]);
});

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

// ── Mi web: el horario de la puerta sale de los turnos de los barberos ──

test("Mi web: cada día abre con el primero que entra y cierra con el último que sale", () => {
  const h = horarioDelLocalDesdeTurnos([
    { dayOfWeek: 1, startMinute: 600, endMinute: 840 }, // lunes 10–14 (Luis)
    { dayOfWeek: 1, startMinute: 960, endMinute: 1200 }, // lunes 16–20 (Luis, segundo turno)
    { dayOfWeek: 1, startMinute: 540, endMinute: 1140 }, // lunes 9–19 (Toño)
    { dayOfWeek: 6, startMinute: 540, endMinute: 900 }, // sábado 9–15
    { dayOfWeek: 0, startMinute: 600, endMinute: 600 }, // turno roto: no abre el domingo
  ]);
  assert.ok(h);
  assert.equal(h.length, 7);
  assert.deepEqual(h[0], { dia: 0, abierto: true, desde: "09:00", hasta: "20:00" }); // lunes
  assert.deepEqual(h[5], { dia: 5, abierto: true, desde: "09:00", hasta: "15:00" }); // sábado
  assert.equal(h[6].abierto, false); // domingo
  assert.equal(h[1].abierto, false); // martes sin nadie
});

test("Mi web: sin turnos no se inventa una semana cerrada", () => {
  assert.equal(horarioDelLocalDesdeTurnos([]), null);
});

test("Mi web: ida y vuelta con el horario que hereda un barbero nuevo", () => {
  const turnos = [
    { dayOfWeek: 2, startMinute: 600, endMinute: 1200 },
    { dayOfWeek: 5, startMinute: 570, endMinute: 1140 },
  ];
  const h = horarioDelLocalDesdeTurnos(turnos)!;
  assert.deepEqual(turnosDesdeHorarioDelLocal({ horario: h }), turnos);
});
