// FIN-03 — "Vencido" se deriva SIEMPRE de dueDate < hoy (zona de la clínica)
// y saldo > 0. Nunca del status OVERDUE, que nadie escribe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvoiceOverdue, parseInvoiceDueDate, startOfTodayInTz } from "../due-date";

const TZ = "America/Mexico_City"; // UTC-6 fijo desde 2023

test("'YYYY-MM-DD' del editor se ancla a las 00:00 de la clínica, no a UTC", () => {
  const d = parseInvoiceDueDate("2026-08-22", TZ);
  assert.equal(d?.toISOString(), "2026-08-22T06:00:00.000Z");
  // new Date("2026-08-22") daría el 21 a las 18:00 en México: un día antes.
  assert.notEqual(d?.toISOString(), new Date("2026-08-22").toISOString());
});

test("vacío = sin vencimiento (columna NULL); basura = inválido (400)", () => {
  assert.equal(parseInvoiceDueDate(undefined, TZ), undefined);
  assert.equal(parseInvoiceDueDate(null, TZ), undefined);
  assert.equal(parseInvoiceDueDate("", TZ), undefined);
  assert.equal(parseInvoiceDueDate("   ", TZ), undefined);
  assert.equal(parseInvoiceDueDate("mañana", TZ), null);
  assert.equal(parseInvoiceDueDate(123, TZ), null);
});

test("un ISO completo pasa tal cual (contrato anterior del POST)", () => {
  const d = parseInvoiceDueDate("2026-08-22T15:30:00.000Z", TZ);
  assert.equal(d?.toISOString(), "2026-08-22T15:30:00.000Z");
});

test("vence el 22 → NO está vencida el 22, SÍ desde el 23", () => {
  const due = parseInvoiceDueDate("2026-08-22", TZ)!;
  const inv = { status: "PENDING", balance: 500, dueDate: due };
  const startOf22 = parseInvoiceDueDate("2026-08-22", TZ)!;
  const startOf23 = parseInvoiceDueDate("2026-08-23", TZ)!;
  assert.equal(isInvoiceOverdue(inv, startOf22), false);
  assert.equal(isInvoiceOverdue(inv, startOf23), true);
  // También acepta el ISO serializado que viaja al cliente.
  assert.equal(isInvoiceOverdue({ ...inv, dueDate: due.toISOString() }, startOf23.toISOString()), true);
});

test("sin dueDate NUNCA vence (las facturas existentes, todas con NULL)", () => {
  const today = parseInvoiceDueDate("2030-01-01", TZ)!;
  assert.equal(isInvoiceOverdue({ status: "PENDING", balance: 9999, dueDate: null }, today), false);
  assert.equal(isInvoiceOverdue({ status: "PENDING", balance: 9999, dueDate: undefined }, today), false);
});

test("el status OVERDUE no manda: sin fecha o sin saldo no está vencida", () => {
  const today = parseInvoiceDueDate("2030-01-01", TZ)!;
  assert.equal(isInvoiceOverdue({ status: "OVERDUE", balance: 100, dueDate: null }, today), false);
  const past = parseInvoiceDueDate("2020-01-01", TZ)!;
  assert.equal(isInvoiceOverdue({ status: "OVERDUE", balance: 0, dueDate: past }, today), false);
  assert.equal(isInvoiceOverdue({ status: "OVERDUE", balance: 100, dueDate: past }, today), true);
});

test("saldo 0, DRAFT y CANCELLED no vencen aunque la fecha ya pasó", () => {
  const today = parseInvoiceDueDate("2026-08-23", TZ)!;
  const past = parseInvoiceDueDate("2026-08-01", TZ)!;
  assert.equal(isInvoiceOverdue({ status: "PAID", balance: 0, dueDate: past }, today), false);
  assert.equal(isInvoiceOverdue({ status: "PARTIAL", balance: 0, dueDate: past }, today), false);
  assert.equal(isInvoiceOverdue({ status: "DRAFT", balance: 300, dueDate: past }, today), false);
  assert.equal(isInvoiceOverdue({ status: "CANCELLED", balance: 300, dueDate: past }, today), false);
  assert.equal(isInvoiceOverdue({ status: "PARTIAL", balance: 1, dueDate: past }, today), true);
});

test("startOfTodayInTz devuelve las 00:00 locales de la clínica (06:00Z en México)", () => {
  const s = startOfTodayInTz(TZ);
  assert.equal(s.getUTCHours(), 6);
  assert.equal(s.getUTCMinutes(), 0);
  assert.equal(s.getUTCSeconds(), 0);
  assert.ok(s.getTime() <= Date.now());
  assert.ok(Date.now() - s.getTime() < 24 * 3_600_000);
});
