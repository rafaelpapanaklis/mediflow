/**
 * «Recargas de saldo» solo enseña el dinero que ENTRA (ws1-t2, 22-sep-2026).
 *
 * Run: npx tsx --test src/app/api/ai-wallet/__tests__/recargas.test.ts
 *
 * Fija la regla de `src/app/api/ai-wallet/recargas.ts`: los consumos (CHARGE)
 * se van a «Consumo de IA», un ajuste negativo no es una recarga, una
 * devolución sí se enseña, y las SPEI en revisión salen sin saldo posterior.
 * También vigila que el `where` de Prisma diga lo mismo que la regla en TS y
 * que lleve SIEMPRE el clinicId.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esRecarga,
  filaDeAsiento,
  filaDeSpeiEnRevision,
  filtroRecargas,
  filtroSpeiEnRevision,
  juntarRecargas,
  type AsientoMonedero,
} from "../recargas";

const fecha = (iso: string) => new Date(iso);

function asiento(parcial: Partial<AsientoMonedero> & Pick<AsientoMonedero, "type" | "amountCents">): AsientoMonedero {
  return {
    id: parcial.id ?? `${parcial.type}-${parcial.amountCents}`,
    balanceAfterCents: parcial.balanceAfterCents ?? 0,
    source: parcial.source ?? "STRIPE",
    note: parcial.note ?? null,
    createdAt: parcial.createdAt ?? fecha("2026-09-01T12:00:00Z"),
    ...parcial,
  };
}

test("qué es una recarga: TOPUP, REFUND y ADJUSTMENT positivo; nunca CHARGE ni ajuste negativo", () => {
  assert.equal(esRecarga({ type: "TOPUP", amountCents: 50000 }), true);
  assert.equal(esRecarga({ type: "REFUND", amountCents: -50000 }), true, "una devolución es dinero que se mueve, no consumo");
  assert.equal(esRecarga({ type: "ADJUSTMENT", amountCents: 20000 }), true, "abono a mano de administración");
  assert.equal(esRecarga({ type: "ADJUSTMENT", amountCents: -20000 }), false, "un ajuste negativo no es una recarga");
  assert.equal(esRecarga({ type: "ADJUSTMENT", amountCents: 0 }), false);
  assert.equal(esRecarga({ type: "CHARGE", amountCents: -37 }), false, "el consumo vive en «Consumo de IA»");
});

test("el where de Prisma dice lo mismo que esRecarga y lleva el clinicId", () => {
  const where = filtroRecargas("clinica-A");
  assert.equal(where.clinicId, "clinica-A");
  assert.deepEqual(where.OR, [
    { type: { in: ["TOPUP", "REFUND"] } },
    { type: "ADJUSTMENT", amountCents: { gt: 0 } },
  ]);
  // Ninguna rama del OR deja pasar un CHARGE.
  const ramas = JSON.stringify(where.OR);
  assert.ok(!ramas.includes("CHARGE"), "el filtro del servidor deja pasar consumos");

  const spei = filtroSpeiEnRevision("clinica-A");
  assert.deepEqual(spei, { clinicId: "clinica-A", method: "SPEI", status: "PENDING" });
});

test("filaDeAsiento: mapea la vía y devuelve null para lo que no es recarga", () => {
  const tarjeta = filaDeAsiento(asiento({ type: "TOPUP", amountCents: 50000, source: "STRIPE", balanceAfterCents: 52000 }));
  assert.ok(tarjeta);
  assert.equal(tarjeta.tipo, "TOPUP");
  assert.equal(tarjeta.via, "STRIPE");
  assert.equal(tarjeta.balanceAfterCents, 52000);
  assert.equal(tarjeta.enRevision, false);

  const abono = filaDeAsiento(asiento({ type: "ADJUSTMENT", amountCents: 10000, source: "ADMIN", note: "cortesía" }));
  assert.ok(abono);
  assert.equal(abono.tipo, "ADJUSTMENT");
  assert.equal(abono.via, "ADMIN");
  assert.equal(abono.note, "cortesía");

  assert.equal(filaDeAsiento(asiento({ type: "CHARGE", amountCents: -37, source: "USAGE" })), null);
  assert.equal(filaDeAsiento(asiento({ type: "ADJUSTMENT", amountCents: -10000, source: "ADMIN" })), null);
});

test("una SPEI en revisión sale marcada y sin saldo posterior", () => {
  const fila = filaDeSpeiEnRevision({ id: "t1", amountCents: 20000, createdAt: fecha("2026-09-20T10:00:00Z") });
  assert.equal(fila.id, "spei:t1", "id propio: no choca con el de un asiento");
  assert.equal(fila.tipo, "SPEI_EN_REVISION");
  assert.equal(fila.via, "SPEI");
  assert.equal(fila.enRevision, true);
  assert.equal(fila.balanceAfterCents, null, "todavía no tocó el saldo");
});

test("juntarRecargas: quita los consumos, mete las SPEI en revisión y ordena de reciente a antigua", () => {
  const filas = juntarRecargas(
    [
      asiento({ id: "c1", type: "CHARGE", amountCents: -37, source: "USAGE", createdAt: fecha("2026-09-21T09:00:00Z") }),
      asiento({ id: "r1", type: "TOPUP", amountCents: 50000, source: "STRIPE", createdAt: fecha("2026-09-10T09:00:00Z") }),
      asiento({ id: "c2", type: "CHARGE", amountCents: -12, source: "USAGE", createdAt: fecha("2026-09-11T09:00:00Z") }),
      asiento({ id: "a1", type: "ADJUSTMENT", amountCents: -5000, source: "ADMIN", createdAt: fecha("2026-09-12T09:00:00Z") }),
      asiento({ id: "a2", type: "ADJUSTMENT", amountCents: 5000, source: "ADMIN", createdAt: fecha("2026-09-13T09:00:00Z") }),
    ],
    [{ id: "t1", amountCents: 20000, createdAt: fecha("2026-09-15T09:00:00Z") }],
  );
  assert.deepEqual(
    filas.map((f) => f.id),
    ["spei:t1", "a2", "r1"],
  );
  assert.ok(filas.every((f) => f.tipo !== ("CHARGE" as string)), "se coló un consumo");
});
