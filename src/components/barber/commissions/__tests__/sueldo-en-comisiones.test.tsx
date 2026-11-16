/* ═══════════════════════════════════════════════════════════════════════
   SUELDO DEL PERIODO en Comisiones y en el recibo impreso (ws6-t6).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/commissions/__tests__/sueldo-en-comisiones.test.tsx

   Se pintan los componentes de verdad (react-dom/server) con la fila que
   manda el servidor: «Sueldo del periodo $9,000» en la fila; «aprox.» cuando
   se prorrateó; nada de sueldo para quien cobra a comisión aunque tenga uno
   guardado; y en el recibo, su renglón con «$3,000 semanal». es y en.
   ═══════════════════════════════════════════════════════════════════════ */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Dictionary } from "@/i18n/t";
import type { CommissionSummary, CommissionSummaryRow } from "@/lib/barber/commissions";
import { getBarberDict } from "@/i18n/dictionaries/barber";

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request.endsWith(".css")) return {};
  if (request === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }) };
  return originalLoad.call(this, request, ...rest);
};
after(() => {
  M._load = originalLoad;
});

function fila(extra: Partial<CommissionSummaryRow> = {}): CommissionSummaryRow {
  return {
    barberId: "b1", barberName: "Fijo", nickname: null, isActive: true,
    commissionType: "SALARY", commissionPct: null, chairRent: null,
    ticketCount: 0, servicesTotal: 0, productsTotal: 0, adjustmentsTotal: 0,
    produced: 0, tips: 50, commissionBase: 0, commissionTotal: 0, commissionPaid: 0,
    commissionPending: 0, tipsPaid: 0, tipsPending: 50, chairRentDiscounted: false,
    chairRentPending: null,
    salaryAmount: 9000, salaryPeriod: "MONTHLY", salaryPeriodTotal: 9000, salaryApprox: false,
    salaryPending: 9000, salaryPaid: null,
    totalToPay: 9050, paidTotal: 0, periodTotal: 9050,
    paidStatus: "PENDING", lastPaidAt: null, entryCount: 0,
    ...extra,
  };
}

const caja = (locale: "es" | "en") => ((getBarberDict(locale).barber as Dictionary).caja ?? {}) as Dictionary;

async function tabla(locale: "es" | "en", rows: CommissionSummaryRow[]): Promise<string> {
  const { ComisionesClient } = await import("../comisiones-client");
  const summary: CommissionSummary = {
    periodKey: "2026-11",
    timezone: "America/Mexico_City",
    policy: { base: "SERVICES" },
    selfOnly: false,
    rows,
    totals: { produced: 0, tips: 50, commissionTotal: 0, commissionPending: 0, totalToPay: 9050, paidTotal: 0 },
  };
  return renderToStaticMarkup(
    createElement(ComisionesClient, { dict: caja(locale), locale, summary, maxPeriod: "2026-11", canManage: true, noBarberLinked: false }),
  );
}

async function recibo(locale: "es" | "en", row: CommissionSummaryRow): Promise<string> {
  const { ReceiptPrint } = await import("../receipt-print");
  return renderToStaticMarkup(
    createElement(ReceiptPrint, {
      dict: caja(locale), locale, shopName: "Barbería", periodKey: "2026-11", tz: "America/Mexico_City",
      row, entries: [], policyLabel: "Solo servicios",
    }),
  );
}

test("la fila dice «Sueldo del periodo $9,000» y «A pagar» lo trae sumado", async () => {
  const html = await tabla("es", [fila()]);
  assert.match(html, /Sueldo del periodo \$9,000\.00/);
  assert.match(html, /9,050/);
  assert.doesNotMatch(html, /aprox\./);
  assert.match(html, /Marcar pagado/, "sin tickets también se puede pagar el sueldo");
});

test("semanal prorrateado: «aprox.»", async () => {
  const html = await tabla("es", [fila({ salaryAmount: 3000, salaryPeriod: "WEEKLY", salaryPeriodTotal: 12857.14, salaryApprox: true })]);
  assert.match(html, /Sueldo del periodo \$12,857\.14 aprox\./);
});

test("a comisión con un sueldo guardado: no sale el sueldo del periodo", async () => {
  const html = await tabla("es", [fila({ commissionType: "COMMISSION", commissionPct: 50, salaryPeriodTotal: null, salaryPending: null, totalToPay: 0, tips: 0, tipsPending: 0, paidStatus: "EMPTY" })]);
  assert.doesNotMatch(html, /Sueldo del periodo/);
});

test("filas viejas sin los campos de sueldo (SQL sin pegar) se pintan como antes", async () => {
  const vieja = fila();
  for (const k of ["salaryAmount", "salaryPeriod", "salaryPeriodTotal", "salaryApprox", "salaryPending", "salaryPaid"] as const) {
    delete (vieja as Partial<CommissionSummaryRow>)[k];
  }
  const html = await tabla("es", [{ ...vieja, totalToPay: 50 }]);
  assert.doesNotMatch(html, /Sueldo del periodo/);
});

test("en inglés: «Salary for the period» y «approx.»", async () => {
  const html = await tabla("en", [fila({ salaryApprox: true })]);
  assert.match(html, /Salary for the period/);
  assert.match(html, /approx\./);
});

test("recibo impreso: renglón del sueldo con «$3,000 semanal» y aprox.", async () => {
  const html = await recibo("es", fila({ salaryAmount: 3000, salaryPeriod: "WEEKLY", salaryPeriodTotal: 12857.14, salaryApprox: true }));
  assert.match(html, /Sueldo del periodo \(\$3,000 semanal, aprox\.\)/);
  assert.match(html, /12,857\.14/);
});

test("recibo sin monto capturado: la nota de sueldo fijo de siempre", async () => {
  const html = await recibo("es", fila({ salaryAmount: null, salaryPeriod: null, salaryPeriodTotal: null, salaryPending: null }));
  assert.doesNotMatch(html, /Sueldo del periodo/);
});
