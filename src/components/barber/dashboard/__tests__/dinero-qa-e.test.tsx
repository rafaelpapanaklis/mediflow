/* ═══════════════════════════════════════════════════════════════════════
   «Ingresos y gastos» de Reportes pintado de verdad (react-dom/server) —
   decisiones 1 y 2 del QA de cierre E (16-nov-2026).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/dashboard/__tests__/dinero-qa-e.test.tsx

   D1 · lo entregado enseña «en caja / fuera de caja».
   D2 · sin «Ver comisiones» (profit y barberCost en null) no se pintan la
        Ganancia, «− Comisiones y sueldos» ni lo entregado por tipo.
   ═══════════════════════════════════════════════════════════════════════ */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { cajaResumen } from "@/lib/barber/caja-resumen";
import { dineroDe, pagosPartidos, type CostoBarberos } from "@/lib/barber/caja-dinero";
import type { ReportCashFlow } from "@/lib/barber/stats";

// La tarjeta trae hojas de estilo: fuera de Next se doblan.
const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request.endsWith(".css")) return {};
  return originalLoad.call(this, request, ...rest);
};
after(() => {
  M._load = originalLoad;
});

const movimientos = [
  { type: "BARBER_PAYOUT" as const, method: "CASH" as const, sessionId: "t1", amount: 52, category: null, barberId: "c2", barberName: "QA-E Comi2", payoutKind: "COMMISSION" as const, voidedAt: null },
  { type: "BARBER_PAYOUT" as const, method: "OTHER" as const, sessionId: null, amount: 71.5, category: null, barberId: "c2", barberName: "QA-E Comi2", payoutKind: "COMMISSION" as const, voidedAt: null },
  { type: "EXPENSE" as const, method: "CASH" as const, sessionId: "t1", amount: 30, category: "SUPPLIES", barberId: null, barberName: null, payoutKind: null, voidedAt: null },
];
const tickets = [{ paymentMethod: "CASH" as const, subtotal: 220, tip: 35.5, total: 255.5, cancelled: false, kind: "sale" as const, barberId: "c2", barberName: "QA-E Comi2" }];
const costo: CostoBarberos = { commission: 88, salary: 200, chairRent: 0, total: 288, approx: true };

function tarjeta(conComisiones: boolean, locale: "es" | "en" = "es"): string {
  const resumen = cajaResumen({ openingAmount: 0, tickets: tickets as never, movements: movimientos });
  const current = dineroDe(resumen, new Map(), conComisiones ? costo : null, false, pagosPartidos(movimientos));
  const cf: ReportCashFlow = {
    current,
    previous: { income: 0, expenses: 0, payouts: 0, profit: conComisiones ? 10 : null },
    vsPrevProfitPct: conComisiones ? -50 : null,
    vsPrevExpensesPct: null,
    barberFiltered: false,
  };
  const T = getBarberT(locale);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CashFlowCard } = require("../cash-flow-card") as typeof import("../cash-flow-card");
  return renderToStaticMarkup(
    createElement(CashFlowCard, {
      cf,
      locale,
      csvHref: "/x.csv",
      t: (key: string, vars?: Record<string, string | number>) => T(`barber.reportes.${key}`, vars),
      categoryLabels: { SUPPLIES: "Insumos" },
    }),
  );
}
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

test("D1: «Entregado a barberos» enseña cuánto salió del cajón y cuánto fuera de caja", () => {
  const t = texto(tarjeta(true));
  assert.match(t, /Entregado a barberos: \$123\.50/);
  assert.match(t, /en caja \$52\.00 · fuera de caja \$71\.50/);
  assert.match(t, /Comisiones \$123\.50/, "por tipo, lo mismo: un solo total");
  assert.match(texto(tarjeta(true, "en")), /from the register \$52\.00 · outside the register \$71\.50/);
});

test("D2: con «Ver comisiones» la tarjeta es la de siempre: Ganancia y «− Comisiones y sueldos»", () => {
  const html = tarjeta(true);
  const t = texto(html);
  assert.match(html, /data-ganancia/);
  assert.match(html, /data-comisiones-y-sueldos/);
  assert.match(t, /Ganancia · Ingresos − gastos − lo que les toca a los barberos/);
  assert.match(t, /−\$98\.00/, "220 − 30 − 288");
  assert.match(t, /comisión \$88\.00 · sueldo \$200\.00/);
});

test("D2: sin «Ver comisiones» no se pintan la Ganancia, lo que les toca ni lo entregado por tipo", () => {
  const html = tarjeta(false);
  const t = texto(html);
  assert.doesNotMatch(html, /data-ganancia|data-comisiones-y-sueldos/);
  assert.doesNotMatch(t, /Ganancia|Comisiones y sueldos|sueldo|comisión|periodo anterior|por tipo/i);
  assert.doesNotMatch(t, /NaN|null|undefined/, "nada roto por los null");
  // Lo que es de «Ver caja» sigue ahí.
  assert.match(t, /Ingresos \$220\.00/);
  assert.match(t, /− Gastos/);
  assert.match(t, /Entregado a barberos: \$123\.50/);
  assert.match(t, /en caja \$52\.00 · fuera de caja \$71\.50/);
  assert.match(t, /Efectivo neto del periodo/);
});

test("D2: Inicio y Reportes condicionan los renglones a la marca del servidor, no a un rol escrito a mano", () => {
  const dir = path.resolve(__dirname, "..");
  const inicio = readFileSync(path.join(dir, "inicio-view.tsx"), "utf8");
  assert.equal(inicio.match(/!m\.noProfit && \(/g)?.length, 2, "«Te queda hoy» y «Comisiones y sueldos de hoy»");
  const reportes = readFileSync(path.join(dir, "reportes-view.tsx"), "utf8");
  assert.match(reportes, /const paidCols = Boolean\(s\.cashFlow\) && s\.can\.commissions;/);
});

test("D1: «Pagado» por barbero lleva su desglose en dos renglones y la tarjeta ocupa todo el ancho para que quepa", () => {
  const dir = path.resolve(__dirname, "..");
  const reportes = readFileSync(path.join(dir, "reportes-view.tsx"), "utf8");
  assert.match(reportes, /t\("money\.paidDrawerLine", \{ amount: fmtMoney\(b\.paidDrawer \?\? 0\) \}\)/);
  assert.match(reportes, /t\("money\.paidOutsideLine", \{ amount: fmtMoney\(b\.paidOutside \?\? 0\) \}\)/);
  assert.match(reportes, /\(b\.paidOut \?\? 0\) > 0 && \(/, "sin pagos no hay desglose");
  assert.match(reportes, /className=\{paidCols \? "bdash-card--wide" : undefined\}/);
  const css = readFileSync(path.join(dir, "dashboard.css"), "utf8");
  assert.match(css, /\.bdash-grid > \.bdash-card--wide \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.bdash-paid-split > span \{ display: block; white-space: nowrap; \}/);
});
