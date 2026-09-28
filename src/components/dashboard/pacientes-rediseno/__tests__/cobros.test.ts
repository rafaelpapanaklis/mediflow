/**
 * WS1-T4 ronda 6 — la misma factura dice lo mismo en la portada y en Facturación.
 *
 * Run: npx tsx --test src/components/dashboard/pacientes-rediseno/__tests__/cobros.test.ts
 *
 * MF-1017 ($36,000, pagados $13,000) salía «Pendiente» en Resumen → Cobros y
 * «Parcial» en la pestaña Facturación: la portada decidía por el saldo y
 * Facturación por el estado de la factura.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeT, type Dictionary } from "@/i18n/t";
import {
  INVOICE_STATUS_BADGES,
  invoiceStatusBadge,
} from "@/components/dashboard/billing/invoice-status";
import { CLASE_ETIQUETA_COBRO, etiquetaDeCobro } from "../cobros";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const es = makeT(JSON.parse(leer("i18n/dictionaries/es.json")) as Dictionary);

test("MF-1017: una factura a medio pagar es «Parcial», no «Pendiente»", () => {
  const mf1017 = { status: "PARTIAL", total: 36000, paid: 13000, balance: 23000 };
  const e = etiquetaDeCobro(mf1017);
  assert.equal(es(e.labelKey), "Parcial");
  assert.equal(e.saldada, false);
});

test("la portada dice lo mismo que Facturación en los seis estados", () => {
  for (const status of Object.keys(INVOICE_STATUS_BADGES)) {
    assert.equal(etiquetaDeCobro({ status }).labelKey, invoiceStatusBadge(status).labelKey, status);
  }
  // Las palabras son las de Facturación, tal cual las trae el diccionario.
  assert.equal(es(etiquetaDeCobro({ status: "PAID" }).labelKey), "Pagado");
  assert.equal(es(etiquetaDeCobro({ status: "PENDING" }).labelKey), "Pendiente");
  assert.equal(es(etiquetaDeCobro({ status: "OVERDUE" }).labelKey), "Vencido");
  assert.equal(es(etiquetaDeCobro({ status: "DRAFT" }).labelKey), "Borrador");
});

test("solo la pagada lleva el punto verde", () => {
  for (const status of Object.keys(INVOICE_STATUS_BADGES)) {
    assert.equal(etiquetaDeCobro({ status }).saldada, status === "PAID", status);
  }
});

test("un estado que no existe cae en «Pendiente», igual que en Facturación", () => {
  assert.equal(etiquetaDeCobro({ status: "LO_QUE_SEA" }).labelKey, invoiceStatusBadge("LO_QUE_SEA").labelKey);
  assert.equal(etiquetaDeCobro({}).labelKey, INVOICE_STATUS_BADGES.PENDING.labelKey);
});

test("cada tono tiene su clase y la clase existe en rediseno.module.css", () => {
  const css = leer("components/dashboard/pacientes-rediseno/rediseno.module.css");
  for (const [tono, clase] of Object.entries(CLASE_ETIQUETA_COBRO)) {
    assert.match(css, new RegExp(`^\\.${clase}\\b`, "m"), `${tono} → .${clase} no existe`);
  }
});

test("la portada usa la función y ya no decide por el saldo", () => {
  const resumen = sinComentarios(leer("components/dashboard/pacientes-rediseno/resumen.tsx"));
  assert.match(resumen, /etiquetaDeCobro\(inv\)/);
  assert.doesNotMatch(resumen, /pacientesRediseno\.resumen\.(pagada|pendiente)/);
  assert.doesNotMatch(resumen, /inv\.balance/);
});

test("Facturación sigue decidiendo con invoiceStatusBadge", () => {
  const fichas = sinComentarios(leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx"));
  assert.match(fichas, /invoiceStatusBadge\(/);
});
