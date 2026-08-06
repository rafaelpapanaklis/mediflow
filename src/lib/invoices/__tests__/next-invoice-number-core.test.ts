import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  InvoiceNumberExhaustedError,
  invoiceFolioToInt,
  isInvoiceNumberConflict,
  formatInvoiceNumber,
  maxInvoiceFolioInt,
  nextInvoiceNumberFrom,
  nextInvoiceNumberFromFolios,
  withInvoiceNumberRetry,
} from "../next-invoice-number-core";

// Genera folios contiguos MF-0001..MF-nnnn.
const seq = (n: number) =>
  Array.from({ length: n }, (_, i) => formatInvoiceNumber(i + 1));

test("clínica sin facturas → primer folio MF-0001", () => {
  assert.equal(nextInvoiceNumberFromFolios([]), "MF-0001");
  assert.equal(nextInvoiceNumberFrom(null), "MF-0001");
});

test("folios contiguos → sigue el máximo", () => {
  assert.equal(nextInvoiceNumberFromFolios(seq(5)), "MF-0006");
  assert.equal(nextInvoiceNumberFromFolios(["MF-0001"]), "MF-0002");
});

test("con huecos → NO reasigna un folio ya emitido", () => {
  // El bug original: 3 filas → count+1 = MF-0004, que ya existe → P2002 → y
  // como ningún insert entra, el count nunca sube: bloqueo PERMANENTE.
  assert.equal(nextInvoiceNumberFromFolios(["MF-0001", "MF-0003", "MF-0004"]), "MF-0005");
});

test("borrar un DRAFT intermedio → el folio nunca retrocede", () => {
  // Se emitieron 10 y se borraron en duro 7 DRAFT: quedan 3 filas, máximo 10.
  const vivas = ["MF-0002", "MF-0006", "MF-0010"];
  assert.equal(nextInvoiceNumberFromFolios(vivas), "MF-0011");
  // Y con COUNT habría dado MF-0004 → colisión con el MF-0004 ya emitido.
  assert.notEqual(nextInvoiceNumberFromFolios(vivas), "MF-0004");
});

test("una factura CANCELLED sigue ocupando su folio (no se recicla)", () => {
  // La anulación no libera el folio: el máximo se calcula sobre TODAS las filas.
  assert.equal(nextInvoiceNumberFromFolios(["MF-0001", "MF-0002" /* cancelada */]), "MF-0003");
});

test("serie INV-YYYY-####: cuenta el ÚLTIMO bloque de dígitos, no todos", () => {
  // El generador de /api/clinical parseaba TODOS los dígitos: "INV-2026-0007"
  // → 20260007 → siguiente "MF-20260008" y la numeración quedaba arruinada.
  assert.equal(invoiceFolioToInt("INV-2026-0007"), 7);
  assert.notEqual(invoiceFolioToInt("INV-2026-0007"), 20260007);
  assert.equal(invoiceFolioToInt("MF-0009"), 9);
});

test("las dos series conviven: el máximo es global y el folio no colisiona", () => {
  assert.equal(nextInvoiceNumberFromFolios(["INV-2026-0007", "MF-0009"]), "MF-0010");
  assert.equal(nextInvoiceNumberFromFolios(["MF-0002", "INV-2026-0005"]), "MF-0006");
  // Mismo número en ambas series (strings distintos, unique intacto): sigue en 8.
  assert.equal(nextInvoiceNumberFromFolios(["MF-0007", "INV-2026-0007"]), "MF-0008");
});

test("folio > 9999 → crece a 5 dígitos, no se trunca", () => {
  assert.equal(nextInvoiceNumberFromFolios(["MF-9999"]), "MF-10000");
  assert.equal(formatInvoiceNumber(10000), "MF-10000");
  assert.equal(formatInvoiceNumber(123456), "MF-123456");
});

test("comparación NUMÉRICA, no de texto: MF-10000 > MF-9999", () => {
  // Como string, "MF-9999" > "MF-10000" y el folio retrocedería a MF-10000 otra vez.
  assert.equal(maxInvoiceFolioInt(["MF-9999", "MF-10000"]), 10000);
  assert.equal(nextInvoiceNumberFromFolios(["MF-9999", "MF-10000"]), "MF-10001");
  assert.equal(nextInvoiceNumberFromFolios(["MF-10000", "MF-9999"]), "MF-10001");
});

test("filas con folio corrupto o no numérico se ignoran", () => {
  const folios = ["MF-0007", "ABC", "", "SIN-FOLIO", null, undefined, "   "];
  assert.equal(nextInvoiceNumberFromFolios(folios), "MF-0008");
  assert.equal(invoiceFolioToInt("ABC"), null);
  assert.equal(invoiceFolioToInt(""), null);
  assert.equal(invoiceFolioToInt(null), null);
});

test("folio con dígitos absurdos se ignora (protege el CAST a BIGINT)", () => {
  assert.equal(invoiceFolioToInt("MF-" + "9".repeat(40)), null);
  // Y no arrastra al resto: el máximo usable sigue siendo el válido.
  assert.equal(nextInvoiceNumberFromFolios(["MF-0003", "MF-" + "9".repeat(40)]), "MF-0004");
});

test("solo folios corruptos → arranca en MF-0001", () => {
  assert.equal(nextInvoiceNumberFromFolios(["ABC", "---"]), "MF-0001");
});

// ── Concurrencia: el retry ante P2002 ────────────────────────────────────────

const folioConflict = (target: unknown) => {
  const err = new Error("Unique constraint failed") as Error & {
    code: string;
    meta: { target: unknown };
  };
  err.code = "P2002";
  err.meta = { target };
  return err;
};

test("isInvoiceNumberConflict: reconoce el P2002 del folio en sus dos formas", () => {
  assert.equal(isInvoiceNumberConflict(folioConflict(["clinicId", "invoiceNumber"])), true);
  assert.equal(isInvoiceNumberConflict(folioConflict("invoices_clinicId_invoiceNumber_key")), true);
  // Sin target no se puede distinguir: se asume folio (reintentar es inocuo).
  assert.equal(isInvoiceNumberConflict(folioConflict(undefined)), true);
});

test("isInvoiceNumberConflict: el P2002 de appointmentId NO es carrera de folio", () => {
  // Ese unique significa "la cita ya tiene factura": debe llegar a la ruta
  // para traducirse a su 409 de factura-ya-existe, nunca reintentarse.
  assert.equal(isInvoiceNumberConflict(folioConflict(["appointmentId"])), false);
  assert.equal(isInvoiceNumberConflict(folioConflict("invoices_appointmentId_key")), false);
  assert.equal(isInvoiceNumberConflict(new Error("cualquier otra cosa")), false);
  assert.equal(isInvoiceNumberConflict(null), false);
});

test("dos emisiones simultáneas: el segundo intento recalcula y entra", async () => {
  let calls = 0;
  const result = await withInvoiceNumberRetry(async () => {
    calls += 1;
    if (calls < 3) throw folioConflict(["clinicId", "invoiceNumber"]);
    return "MF-0042";
  });
  assert.equal(result, "MF-0042");
  assert.equal(calls, 3);
});

test("un error ajeno al folio NO se reintenta: se propaga al primer intento", async () => {
  let calls = 0;
  await assert.rejects(
    withInvoiceNumberRetry(async () => {
      calls += 1;
      throw folioConflict(["appointmentId"]);
    }),
    (err: any) => err?.code === "P2002",
  );
  assert.equal(calls, 1);
});

test("carrera permanente → InvoiceNumberExhaustedError tras agotar intentos", async () => {
  let calls = 0;
  await assert.rejects(
    withInvoiceNumberRetry(async () => {
      calls += 1;
      throw folioConflict(["clinicId", "invoiceNumber"]);
    }),
    InvoiceNumberExhaustedError,
  );
  assert.equal(calls, 5);
});

// ── Guards de regresión sobre la query real ──────────────────────────────────

test("el folio no se recicla: la query NO filtra por status ni deletedAt", () => {
  // Si alguien excluye las CANCELLED del MAX, sus folios se reasignan y vuelve
  // el P2002 permanente que este módulo arregla.
  const sql = readFileSync(join(__dirname, "..", "next-invoice-number.ts"), "utf8");
  const query = sql.slice(sql.indexOf("SELECT MAX"), sql.indexOf("`;", sql.indexOf("SELECT MAX")));
  assert.ok(query.includes('FROM "invoices"'), "la query debe leer de invoices");
  assert.ok(!/status/.test(query), "la query NO debe filtrar por status");
  assert.ok(!/deletedAt/.test(query), "la query NO debe filtrar por deletedAt");
});

test("la extracción SQL y la JS son la misma (último bloque de dígitos)", () => {
  const sql = readFileSync(join(__dirname, "..", "next-invoice-number.ts"), "utf8");
  assert.ok(
    sql.includes("substring(\"invoiceNumber\" from '([0-9]+)[^0-9]*$')"),
    "la query debe extraer el último bloque de dígitos, igual que invoiceFolioToInt",
  );
});
