/**
 * La tarjeta del MRR del Dashboard (planes + módulos) pinta con `mrrModulos`
 * ausente, nulo, vacío o con datos, y el total es planes + módulos. El
 * Dashboard pasó a sumar módulos el 28-sep; esto cubre que la tarjeta no
 * dependa de que el dato exista.
 *
 * Run: node --import tsx --test src/components/admin/portada/__tests__/tarjeta-mrr.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_react-global";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaMrr } from "../portada-vista";
import { EMPTY_MRR, type AdminMrr } from "@/lib/admin/mrr-core";
import { MRR_MODULOS_VACIO, type MrrModulos } from "@/lib/admin/modulos-core";

const MRR: AdminMrr = {
  total: 3000,
  clinics: 2,
  includedBranches: 1,
  byPlan: [{ plan: "PRO", clinics: 2, listPrice: 1500, total: 3000, negotiated: 0, conserved: 0 } as AdminMrr["byPlan"][number]],
};
const MODULOS: MrrModulos = {
  total: 900,
  clinicasPagando: 1,
  porModulo: [{ moduleKey: "orthodontics", moduleName: "Ortodoncia", clinicas: 2, pagando: 1, cortesia: 1, total: 900 } as MrrModulos["porModulo"][number]],
};

const pinta = (mrrModulos: MrrModulos | null | undefined, mrr: AdminMrr = MRR) =>
  renderToStaticMarkup(createElement(TarjetaMrr, { negocio: { mrr, mrrModulos, mrrPotencial: mrr.total + (mrrModulos?.total ?? 0) } }));

const total = (html: string) => html.match(/data-mrr-total[^>]*>([^<]*)</)?.[1] ?? "";

test("sin mrrModulos (undefined o null) la tarjeta sale con solo los planes", () => {
  for (const m of [undefined, null]) {
    const html = pinta(m);
    assert.match(total(html), /3,000/);
    assert.ok(!html.includes("módulos $"), "no debe hablar de módulos si no se midieron");
    assert.ok(html.includes("PRO"), "el chip del plan se pinta");
  }
});

test("con módulos en cero no cambia el total ni añade el desglose", () => {
  const html = pinta(MRR_MODULOS_VACIO);
  assert.match(total(html), /3,000/);
  assert.ok(!html.includes("módulos $"));
});

test("con módulos el total suma planes + módulos y cada módulo sale como chip", () => {
  const html = pinta(MODULOS);
  assert.match(total(html), /3,900/);
  assert.ok(html.includes("planes $3,000"));
  assert.ok(html.includes("módulos $900"));
  assert.ok(html.includes("Ortodoncia"));
});

test("sin clínicas que paguen (EMPTY_MRR) sigue pintando y lo dice", () => {
  const html = pinta(MRR_MODULOS_VACIO, EMPTY_MRR);
  assert.match(total(html), /\$0/);
  assert.ok(html.includes("Ninguna clínica activa."));
});
