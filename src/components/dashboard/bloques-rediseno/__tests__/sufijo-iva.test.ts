/**
 * La tarjeta de cada plan dice su IVA con el mismo formato (ws1-t9, QA de
 * Chrome del 20-oct: la tarjeta «Clínica» salía con «MXN/mes» pelado al lado
 * de dos «+ IVA»).
 *
 * Run: npx tsx --test src/components/dashboard/bloques-rediseno/__tests__/sufijo-iva.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sufijoIvaTarjeta } from "../sufijo-iva";
import { exencionDeIva, ivaAplica } from "@/lib/billing/iva-cobro";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("con IVA: « + IVA»; sin IVA: « · <texto>», nunca vacío", () => {
  assert.equal(sufijoIvaTarjeta(true, "sin IVA"), " + IVA");
  assert.equal(sufijoIvaTarjeta(false, "sin IVA"), " · sin IVA");
});

test("clínica exenta en Clínica: las tres tarjetas llevan marca fiscal y solo la suya va sin IVA", () => {
  const exencion = exencionDeIva({ createdAt: "2026-09-01T12:00:00Z", plan: "CLINIC", tuvoTarjeta: false });
  const sufijos = ["BASIC", "PRO", "CLINIC"].map((plan) =>
    sufijoIvaTarjeta(ivaAplica({ metodo: "spei", plan, exencion }), "sin IVA"),
  );
  assert.deepEqual(sufijos, [" + IVA", " + IVA", " · sin IVA"]);
});

test("clínica nueva: las tres tarjetas dicen « + IVA»", () => {
  const exencion = exencionDeIva({ createdAt: "2026-10-01T12:00:00Z", plan: "CLINIC", tuvoTarjeta: false });
  for (const plan of ["BASIC", "PRO", "CLINIC"]) {
    assert.equal(sufijoIvaTarjeta(ivaAplica({ metodo: "spei", plan, exencion }), "sin IVA"), " + IVA");
  }
});

test("las dos tarjetas (rediseño y clásica) pasan por sufijoIvaTarjeta", () => {
  const rediseno = leer("components/dashboard/bloques-rediseno/suscripcion.tsx");
  const clasica = leer("components/dashboard/subscription-tab.tsx");
  assert.match(rediseno, /\{m\.sufijoIntervalo\}\{sufijoIvaTarjeta\(m\.ivaDe\(plan\.id\), t\("shell\.subscriptionTab\.sinIvaCorto"\)\)\}/);
  assert.match(clasica, /\{perIntervalSuffix\}\{sufijoIvaTarjeta\(sufijoIva\(plan\.id\) !== "", t\("shell\.subscriptionTab\.sinIvaCorto"\)\)\}/);
  assert.ok(!/ivaDe\(plan\.id\) \? " \+ IVA" : ""/.test(rediseno), "volvió el sufijo vacío en la tarjeta del rediseño");
});

test("el texto existe en es y en", () => {
  const es = JSON.parse(leer("i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("i18n/dictionaries/en.json"));
  assert.equal(es.shell.subscriptionTab.sinIvaCorto, "sin IVA");
  assert.equal(en.shell.subscriptionTab.sinIvaCorto, "no VAT");
});
