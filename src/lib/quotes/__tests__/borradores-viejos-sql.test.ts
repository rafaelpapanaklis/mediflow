// Candados de los dos SQL de los borradores fantasma de presupuestos viejos
// (sql/presupuesto-borradores-viejos-1-CONTEO.sql y -2-ARREGLO.sql). No ejecuta
// SQL: los LEE. Lo que vigila es que el archivo que Rafael pega en la base de
// clínicas que pagan siga sin poder guardar nada por accidente.
// Run: npm run test:borradores-viejos-sql
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = join(__dirname, "..", "..", "..", "..", "sql");
const sinComentarios = (s: string) => s.replace(/^\s*--.*$/gm, "");
const CONTEO = sinComentarios(readFileSync(join(SQL, "presupuesto-borradores-viejos-1-CONTEO.sql"), "utf8"));
const ARREGLO = sinComentarios(readFileSync(join(SQL, "presupuesto-borradores-viejos-2-ARREGLO.sql"), "utf8"));

// Lo que saca a una factura de la limpieza. Tiene que decir lo mismo en los dos archivos.
const EXCLUSIONES = [
  /i\."paid" = 0/,
  /NOT EXISTS \(SELECT 1 FROM "payments"\s+\w+\s+WHERE \w+\."invoiceId"\s+= i\."id"\)/,
  /i\."cfdiUuid" IS NULL/,
  /NOT EXISTS \(SELECT 1 FROM "cfdi_records"\s+\w+\s+WHERE \w+\."invoiceId"\s+= i\."id"\)/,
  /NOT EXISTS \(SELECT 1 FROM "payment_plans" \w+ WHERE \w+\."invoiceId" = i\."id"\)/,
  /i\."appointmentId" IS NULL/,
  /NOT EXISTS \(SELECT 1 FROM "quotes" qa WHERE qa\."invoiceId" = i\."id" AND qa\."status" = 'ACCEPTED'\)/,
  // Importe cambiado a mano: alguien la estaba trabajando.
  /NOT EXISTS \(SELECT 1 FROM "quotes" qt WHERE qt\."invoiceId" = i\."id" AND abs\(qt\."total"::numeric - i\."total"::numeric\) > 1\)/,
];
const VENTANA = /i\."createdAt" >= TIMESTAMP '2026-06-29' AND i\."createdAt" < TIMESTAMP '2026-09-17'/;

test("el conteo es de SOLO LECTURA", () => {
  assert.ok(!/\b(update|delete|insert|create|alter|drop|truncate|grant|commit)\b/i.test(CONTEO), "el conteo no puede escribir");
});

test("el arreglo, tal cual, NO guarda nada: termina en ROLLBACK y va en simulacro", () => {
  const sentencias = ARREGLO.split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(sentencias[0], "BEGIN");
  assert.equal(sentencias.at(-1), "ROLLBACK", "la última sentencia viva tiene que ser ROLLBACK");
  assert.ok(!/^\s*COMMIT\b/m.test(ARREGLO), "no puede haber un COMMIT vivo");
  assert.match(ARREGLO, /set_config\('limpieza\.esperadas', '-1', true\)/, "se entrega en simulacro (-1)");
  // Con -1 corta, y con un número distinto del real también.
  assert.match(ARREGLO, /IF esperadas = -1 THEN\s+RAISE EXCEPTION 'SIMULACRO/);
  assert.match(ARREGLO, /IF esperadas <> canceladas THEN\s+RAISE EXCEPTION/);
});

test("pagos, CFDI, plan, cita, presupuesto aceptado e importe cambiado quedan fuera — al elegir Y al cancelar", () => {
  const elegir = ARREGLO.slice(ARREGLO.indexOf('CREATE TEMP TABLE "_candidatas"'), ARREGLO.indexOf("_apartadas_por_condiciones"));
  const cancelar = ARREGLO.slice(ARREGLO.indexOf('UPDATE "invoices" i'), ARREGLO.indexOf('INSERT INTO "_canceladas"'));
  for (const re of EXCLUSIONES) {
    assert.match(elegir, re, `falta al elegir: ${re}`);
    assert.match(cancelar, re, `falta al cancelar: ${re}`);
  }
  assert.match(elegir, /i\."status" = 'DRAFT'/);
  assert.match(cancelar, /i\."status" = 'DRAFT'/);
  assert.match(elegir, VENTANA);
});

test("el conteo cuenta como «se cancelarían» con las MISMAS condiciones que el arreglo", () => {
  const b = CONTEO.slice(CONTEO.indexOf("se_cancelarian") - 1500, CONTEO.indexOf("se_cancelarian"));
  for (const re of [...EXCLUSIONES, VENTANA]) assert.match(b, re, `el conteo B no excluye: ${re}`);
});

test("el arreglo solo toca status, notes y la liga; nunca importes, folios ni pagos, y no borra facturas", () => {
  const set = ARREGLO.slice(ARREGLO.indexOf('UPDATE "invoices" i'), ARREGLO.indexOf('FROM "_candidatas" c'));
  assert.ok(!/"(total|paid|balance|subtotal|discount|invoiceNumber|cfdiUuid|dueDate|items)"\s*=/.test(set));
  assert.ok(!/DELETE FROM "(invoices|quotes|payments|cfdi_records)"/.test(ARREGLO));
  // Cancelar sin desligar rompería el presupuesto (createInvoiceFromQuote devuelve la ligada).
  assert.match(ARREGLO, /UPDATE "quotes" q\s+SET "invoiceId" = NULL/);
});
