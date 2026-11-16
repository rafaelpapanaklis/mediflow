// «Cambiar método de pago» (lógica L2, ronda 2): reglas y bitácora, sin base.
//   npx tsx --test src/lib/barber/__tests__/cambiar-metodo.test.ts
import "./_sin-server-only";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendMethodChange,
  METHOD_CHANGE_PREFIX,
  methodChangeBlocker,
  parseMethodChanges,
} from "@/lib/barber/method-change-core";
import { buildSaleTag, parseSaleTag, saleKindOf, stripSaleTag } from "@/lib/barber/memberships-core";
import { CANCELLED_MARK, isSaleCancelled } from "@/lib/barber/commissions";
import { breakdownOf, expectedCashFor } from "@/lib/barber/cash";
import { Prisma } from "@prisma/client";

const base = { current: "CASH" as const, cancelled: false, hasSession: true, sessionClosed: false };

test("reglas: solo turno abierto, solo métodos del mostrador, nada en línea ni cancelado", () => {
  assert.equal(methodChangeBlocker({ ...base, next: "CARD" }), null);
  assert.equal(methodChangeBlocker({ ...base, next: "SPEI" }), null);
  assert.equal(methodChangeBlocker({ ...base, next: "CASH" }), "SAME_METHOD");
  assert.equal(methodChangeBlocker({ ...base, next: "STRIPE" }), "INVALID_METHOD");
  assert.equal(methodChangeBlocker({ ...base, next: undefined }), "INVALID_METHOD");
  assert.equal(methodChangeBlocker({ ...base, next: "card" }), "INVALID_METHOD");
  assert.equal(methodChangeBlocker({ ...base, next: "CARD", sessionClosed: true }), "SESSION_CLOSED");
  assert.equal(methodChangeBlocker({ ...base, next: "CARD", hasSession: false }), "NO_SESSION");
  assert.equal(methodChangeBlocker({ ...base, next: "CARD", cancelled: true }), "ALREADY_CANCELLED");
  assert.equal(methodChangeBlocker({ ...base, current: "STRIPE", next: "CASH" }), "ONLINE_PAYMENT");
});

test("bitácora: quién, cuándo, de qué a qué, en orden, al FINAL de las notas", () => {
  let notes: string | null = "pagó con billete de 500";
  notes = appendMethodChange(notes, { at: "2026-11-15T20:00:00.000Z", by: "Rafa", from: "CASH", to: "CARD" });
  notes = appendMethodChange(notes, { at: "2026-11-15T20:05:00.000Z", by: "Ana", from: "CARD", to: "SPEI" });
  assert.ok(notes.startsWith("pagó con billete de 500\n"));
  assert.deepEqual(parseMethodChanges(notes), [
    { at: "2026-11-15T20:00:00.000Z", by: "Rafa", from: "CASH", to: "CARD" },
    { at: "2026-11-15T20:05:00.000Z", by: "Ana", from: "CARD", to: "SPEI" },
  ]);
  assert.equal(stripSaleTag(notes), "pagó con billete de 500", "la nota escrita sigue; la bitácora no se enseña");
  assert.equal(stripSaleTag(appendMethodChange(null, { at: "x", by: "y", from: "CASH", to: "CARD" })), null);
  assert.deepEqual(parseMethodChanges(`${METHOD_CHANGE_PREFIX}{dañado`), [], "una línea dañada no truena");
});

test("no estorba al sello del ticket de mostrador ni a la marca de cancelación", () => {
  const tag = buildSaleTag({ k: "deposit", appt: "cita1" });
  const changed = appendMethodChange(tag, { at: "a", by: "b", from: "CASH", to: "CARD" });
  assert.deepEqual(parseSaleTag(changed), { k: "deposit", appt: "cita1" });
  assert.equal(saleKindOf(changed), "deposit");
  // La cancelación se escribe DELANTE: el ticket se sigue leyendo cancelado.
  const cancelled = `${CANCELLED_MARK} 2026-11-15T21:00:00.000Z · Rafa · error · Original: Corte · subtotal 180.00 · propina 0.00 · total 180.00 (CARD)\n${changed}`;
  assert.equal(isSaleCancelled({ notes: cancelled }), true);
  assert.equal(parseMethodChanges(cancelled).length, 1);
  assert.equal(isSaleCancelled({ notes: changed }), false);
});

test("el corte por método sale del método de cada ticket: cambiarlo mueve el dinero y el esperado", () => {
  const t = (paymentMethod: "CASH" | "CARD" | "SPEI", total: number, tip = 0) => ({ cancelled: false, paymentMethod, subtotal: total - tip, tip, total });
  const antes = breakdownOf([t("CASH", 200, 20), t("CASH", 180)]);
  assert.equal(antes.byMethod.CASH.total, 380);
  assert.equal(expectedCashFor(new Prisma.Decimal(500), antes.cashTotal).toNumber(), 880);
  const despues = breakdownOf([t("CARD", 200, 20), t("CASH", 180)]);
  assert.equal(despues.byMethod.CASH.total, 180);
  assert.equal(despues.byMethod.CARD.total, 200);
  assert.equal(despues.cashTips.toNumber(), 0);
  assert.equal(expectedCashFor(new Prisma.Decimal(500), despues.cashTotal).toNumber(), 680);
  assert.equal(
    antes.byMethod.CASH.total + antes.byMethod.CARD.total,
    despues.byMethod.CASH.total + despues.byMethod.CARD.total,
    "el total del turno no cambia",
  );
});
