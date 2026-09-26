/**
 * La lista de pendientes del Dashboard y las cuatro tarjetas.
 *
 * Run: npm run test:admin-uso
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { construirPortada, type FilaPortada } from "../atencion-core";
import { contarTiles, unirPendientes } from "../pendientes";
import type { SenalCupo } from "@/lib/admin/uso-core";

const AHORA = new Date("2026-09-26T16:00:00.000Z");
const DIA = 86_400_000;
const hace = (n: number) => new Date(AHORA.getTime() - n * DIA);
const en = (n: number) => new Date(AHORA.getTime() + n * DIA);

function fila(over: Partial<FilaPortada>): FilaPortada {
  return {
    id: "x", nombre: "X", plan: "PRO", createdAt: hace(300), trialEndsAt: en(20), subscriptionStatus: "active",
    nextBillingDate: en(20), archivedAt: null, pacientes: 100, citasTotales: 500, ultimaCita: hace(1),
    actividad: { citas: 30, facturas: 5, notas: 8 }, actividadPrevia: { citas: 20, facturas: 4, notas: 6 },
    ultimoAcceso: hace(0), enLinea: false, cobrosFallidos: 0, montoPorCobrar: 0, algunaVezPago: true,
    ...over,
  };
}

const cupo = (over: Partial<SenalCupo>): SenalCupo => ({
  clave: "c:almacenamiento", motivo: "almacenamiento", severidad: "medio", clinicaId: "c", clinicaNombre: "C",
  titulo: "Almacenamiento", dato: "87% de 15 GB", monto: 0, ...over,
});

test("los pendientes juntan negocio y cupos, lo crítico arriba y el dinero después", () => {
  const portada = construirPortada([
    fila({ id: "a", nombre: "A", subscriptionStatus: "past_due", cobrosFallidos: 1, montoPorCobrar: 419 }),
    fila({ id: "b", nombre: "B", subscriptionStatus: "trialing", trialEndsAt: hace(64), nextBillingDate: null }),
    fila({ id: "c", nombre: "C" }),
  ], AHORA);
  const pend = unirPendientes(portada, [
    cupo({ clinicaId: "c", clinicaNombre: "C" }),
    cupo({ clave: "c:pago", clinicaId: "c", clinicaNombre: "C", motivo: "pago-por-verificar", severidad: "alto", titulo: "Pago por verificar", dato: "1 pago", monto: 689 }),
  ]);
  assert.deepEqual(pend.map((p) => p.severidad), ["critico", "critico", "alto", "medio"]);
  assert.equal(pend[0].clinicaNombre, "A", "el cobro fallido con dinero va antes que el trial vencido sin importe");
  assert.equal(pend[0].monto, 419);
  assert.equal(pend[1].motivo, "usando_sin_plan");
  assert.equal(pend[2].href, "/admin/payments", "un pago por verificar lleva a Pagos");
  assert.equal(pend[3].href, "/admin/clinics/c");
});

test("las cuatro tarjetas cuentan CLÍNICAS, no señales, y las renovaciones de Stripe se suman", () => {
  const portada = construirPortada([
    fila({ id: "a", nombre: "A", subscriptionStatus: "past_due", cobrosFallidos: 2, montoPorCobrar: 838 }),
    fila({ id: "t", nombre: "T", subscriptionStatus: null, trialEndsAt: en(3), nextBillingDate: null, algunaVezPago: false }),
  ], AHORA);
  const pend = unirPendientes(portada, [
    cupo({ clave: "c:1", clinicaId: "c", clinicaNombre: "C" }),
    cupo({ clave: "c:2", clinicaId: "c", clinicaNombre: "C", motivo: "tokens", titulo: "Tokens IA" }),
    cupo({ clave: "d:pago", clinicaId: "d", clinicaNombre: "D", motivo: "pago-por-verificar", severidad: "alto", titulo: "Pago por verificar", dato: "2 pagos", monto: 1378 }),
    cupo({ clave: "e:ren", clinicaId: "e", clinicaNombre: "E", motivo: "renovacion-manual", severidad: "alto", titulo: "Renovación manual", dato: "en 2 d" }),
  ]);
  const tiles = contarTiles(pend, 3);
  assert.deepEqual(tiles.porVerificar, { clinicas: 1, monto: 1378 });
  assert.equal(tiles.cobrosRotos, 1);
  assert.equal(tiles.renovaciones, 1 + 1 + 3, "trial que vence + renovación manual + 3 de Stripe");
  assert.equal(tiles.cercaDelTope, 1, "dos señales de la misma clínica cuentan una vez");
});

test("sin nada, todo a cero", () => {
  const portada = construirPortada([fila({ id: "ok", nombre: "OK" })], AHORA);
  const tiles = contarTiles(unirPendientes(portada, []), 0);
  assert.deepEqual(tiles, { porVerificar: { clinicas: 0, monto: 0 }, cobrosRotos: 0, renovaciones: 0, cercaDelTope: 0 });
});
