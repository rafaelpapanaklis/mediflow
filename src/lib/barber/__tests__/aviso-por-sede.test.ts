// Avisos de Inicio por sede — lo puro (ws6-t6, 16-nov-2026).
//
//   npx tsx --test src/lib/barber/__tests__/aviso-por-sede.test.ts
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { bookingBlockers, inicioBranchLabel, setupFlags, type InicioBranchSetup } from "@/lib/barber/inicio-avisos";

const sede = (id: string, extra: Partial<InicioBranchSetup>): InicioBranchSetup => ({
  id, label: id, slug: id, isActive: true, hasBarbers: true, hasSchedules: true, hasServices: true, hasWeb: true, ...extra,
});

const principal = sede("Principal", {});
const cerrada = sede("Cerrada", { isActive: false, hasBarbers: false, hasSchedules: false, hasServices: false, hasWeb: false });
const sinBarberos = sede("Norte", { hasBarbers: false, hasSchedules: false });
const sinHorario = sede("Sur", { hasSchedules: false });

test("sede con horario: sin aviso", () => {
  assert.deepEqual(bookingBlockers([principal], true), []);
});

test("sede cerrada: nunca avisa, aunque esté vacía", () => {
  assert.deepEqual(bookingBlockers([cerrada], true), []);
  assert.equal(setupFlags([cerrada]), null, "y no tiene «primeros pasos»");
});

test("sin barberos dice eso; con barberos y sin turno, «no hay horario»", () => {
  assert.deepEqual(bookingBlockers([sinBarberos, sinHorario], true).map((b) => [b.label, b.reason]), [
    ["Norte", "noBarbers"],
    ["Sur", "noSchedules"],
  ]);
});

test("toda la cadena: solo las activas que fallan, nombradas", () => {
  const avisos = bookingBlockers([principal, cerrada, sinBarberos], true);
  assert.deepEqual(avisos, [{ branchId: "Norte", label: "Norte", slug: "Norte", reason: "noBarbers" }]);
});

test("sin reserva en línea en el plan: ningún aviso", () => {
  assert.deepEqual(bookingBlockers([sinBarberos, sinHorario], false), []);
});

test("primeros pasos: se juntan solo las sedes activas", () => {
  assert.deepEqual(setupFlags([cerrada, sinHorario]), { hasBarbers: true, hasSchedules: false, hasServices: true, hasWeb: true });
});

test("el nombre de la sede: el de sucursal si lo tiene", () => {
  assert.equal(inicioBranchLabel({ name: "Barbería Prueba", branchName: "  Centro " }), "Centro");
  assert.equal(inicioBranchLabel({ name: "Barbería Prueba", branchName: null }), "Barbería Prueba");
});

// ── UNA sola sede elegida para todo el panel (regla de servidor y barra) ──
import { BARBER_BRANCH_ALL, sedeElegida } from "@/lib/barber/branch-cookie";

const opciones = [
  { id: "principal", isActive: true },
  { id: "norte", isActive: true },
  { id: "t2", isActive: false },
];

test("sede elegida: una abierta se respeta; «toda la cadena» también", () => {
  assert.equal(sedeElegida({ requested: "norte", options: opciones, fallback: "principal" }), "norte");
  assert.equal(sedeElegida({ requested: BARBER_BRANCH_ALL, options: opciones, fallback: "principal" }), BARBER_BRANCH_ALL);
});

test("sede elegida: una CERRADA nunca queda elegida, ni recuperada de la cookie → la principal", () => {
  assert.equal(sedeElegida({ requested: "t2", options: opciones, fallback: "principal" }), "principal");
});

test("sede elegida: vacía o desconocida → la principal", () => {
  assert.equal(sedeElegida({ requested: null, options: opciones, fallback: "principal" }), "principal");
  assert.equal(sedeElegida({ requested: "otra-cadena", options: opciones, fallback: "principal" }), "principal");
});

test("la barra de arriba usa la misma regla y pone las cerradas aparte, sin poder elegirse", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "components", "barber", "barber-branch-badge.tsx"), "utf8");
  assert.match(src, /sedeElegida\(/);
  assert.match(src, /<optgroup label=\{labels\.closedGroup \?\? labels\.closed\}>/);
  assert.match(src, /<option key=\{o\.id\} value=\{o\.id\} disabled>/);
  const servidor = readFileSync(join(__dirname, "..", "branches.ts"), "utf8");
  assert.match(servidor, /sedeElegida\(\{ requested, options: \[\{ id: requested, isActive: abierta > 0 \}\], fallback: ctx\.barbershopId \}\)/);
});

test("Sucursales no ofrece «Trabajar en esta sede» en una sede cerrada (dejaba la cookie apuntándole)", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "components", "barber", "branches", "branches-client.tsx"), "utf8");
  assert.match(src, /\{!isCurrent && b\.isActive \? \(\s*<Btn size="sm" onClick=\{\(\) => workHere\(b\.id\)\}/);
});
