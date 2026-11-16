// Avisos de Inicio por sede — lo puro (ws6-t6, 16-nov-2026).
//
//   npx tsx --test src/lib/barber/__tests__/aviso-por-sede.test.ts
import { test } from "node:test";
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
