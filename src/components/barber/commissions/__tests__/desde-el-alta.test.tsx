/* ═══════════════════════════════════════════════════════════════════════
   Comisiones y el recibo cuando la renta o el sueldo son PROPORCIONALES
   desde el alta del barbero (decisión 3 del QA de cierre E, 16-nov-2026).
   Se pintan los componentes de verdad (react-dom/server).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/commissions/__tests__/desde-el-alta.test.tsx
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

const caja = (locale: "es" | "en") => ((getBarberDict(locale).barber as Dictionary).caja ?? {}) as Dictionary;

/** «QA-E Renta»: $500 al mes, alta el 16-nov → noviembre $250; produjo $180 + $20 de propina. */
function renta(extra: Partial<CommissionSummaryRow> = {}): CommissionSummaryRow {
  return {
    barberId: "r1", barberName: "QA-E Renta", nickname: null, isActive: true,
    commissionType: "CHAIR_RENT", commissionPct: null,
    chairRent: 250, chairRentMonthly: 500, chairRentApprox: true, hiredInPeriod: "2026-11-16",
    ticketCount: 1, servicesTotal: 180, productsTotal: 0, adjustmentsTotal: 0,
    produced: 180, tips: 20, commissionBase: 180, commissionTotal: 180, commissionPaid: 0,
    commissionPending: 180, tipsPaid: 0, tipsPending: 20, chairRentDiscounted: false,
    chairRentPending: 250, totalToPay: -50, paidTotal: 0, periodTotal: -50,
    salaryAmount: null, salaryPeriod: null, salaryPeriodTotal: null, salaryApprox: false, salaryPending: null, salaryPaid: null,
    grossToPay: -50, advances: 0, advancesSettled: 0,
    paidStatus: "PENDING", lastPaidAt: null, entryCount: 1,
    ...extra,
  } as CommissionSummaryRow;
}

function resumen(rows: CommissionSummaryRow[], periodKey = "2026-11"): CommissionSummary {
  return {
    periodKey,
    timezone: "America/Mexico_City",
    policy: {} as CommissionSummary["policy"],
    selfOnly: false,
    rows,
    totals: { produced: 180, tips: 20, commissionTotal: 180, commissionPending: 180, totalToPay: 0, paidTotal: 0 },
  };
}

async function tabla(locale: "es" | "en", summary: CommissionSummary): Promise<string> {
  const { ComisionesClient } = await import("../comisiones-client");
  return renderToStaticMarkup(createElement(ComisionesClient, { dict: caja(locale), locale, summary, maxPeriod: "2026-11", canManage: true, noBarberLinked: false }));
}
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("el mes de su alta: la renta sale proporcional y la fila dice desde qué día", async () => {
  const html = await tabla("es", resumen([renta()]));
  const t = texto(html);
  assert.match(t, /−\$250\.00/, "la renta del periodo, no los $500 de su ficha");
  assert.doesNotMatch(t, /−\$500\.00/);
  assert.match(t, /desde su alta \(16 nov\)/);
  assert.match(html, /Se dio de alta el 16 nov: la renta de silla y el sueldo de este mes cuentan desde ese día/, "el porqué, al pasar el cursor");
  assert.match(t, /−\$50\.00/, "180 + 20 − 250");
  assert.match(t, /Te deben de renta \$50\.00/);
  assert.match(texto(await tabla("en", resumen([renta()]))), /since they joined \(Nov 16\)/);
});

test("un mes anterior a su alta: sin renta (raya), nada que cobrarle", async () => {
  const fila = renta({ chairRent: 0, chairRentApprox: false, hiredInPeriod: null, chairRentPending: 0, ticketCount: 0, produced: 0, tips: 0, commissionBase: 0, commissionTotal: 0, commissionPending: 0, tipsPending: 0, totalToPay: 0, periodTotal: 0, grossToPay: 0, paidStatus: "EMPTY", entryCount: 0 });
  const html = await tabla("es", resumen([fila], "2026-10"));
  const t = texto(html);
  assert.doesNotMatch(t, /−\$0\.00|−\$500\.00|desde su alta/);
  assert.match(t, /Te deben de renta \$0\.00/, "antes decía $500 de un mes en que no existía");
  assert.doesNotMatch(html, /Registrar su pago/);
});

test("un barbero de siempre: renta completa y sin nota", async () => {
  const t = texto(await tabla("es", resumen([renta({ chairRent: 500, chairRentApprox: false, hiredInPeriod: null, chairRentPending: 500, totalToPay: -300, periodTotal: -300, grossToPay: -300 })])));
  assert.match(t, /−\$500\.00/);
  assert.doesNotMatch(t, /desde su alta/);
});

test("sueldo en el mes de su alta: «Sueldo del periodo $3,000 aprox. · desde su alta»", async () => {
  const fijo = renta({
    barberName: "Fijo nuevo", commissionType: "SALARY", chairRent: null, chairRentMonthly: null, chairRentApprox: false, chairRentPending: null,
    salaryAmount: 6000, salaryPeriod: "MONTHLY", salaryPeriodTotal: 3000, salaryApprox: true, salaryPending: 3000, salaryPaid: null,
    commissionTotal: 0, commissionPending: 0, totalToPay: 3020, periodTotal: 3020, grossToPay: 3020,
  });
  const t = texto(await tabla("es", resumen([fijo])));
  assert.match(t, /Sueldo del periodo \$3,000\.00 aprox\. · desde su alta \(16 nov\)/);
});

test("el recibo impreso dice que la renta es desde su alta", async () => {
  const { ReceiptPrint } = await import("../receipt-print");
  const html = renderToStaticMarkup(
    createElement(ReceiptPrint, { dict: caja("es"), locale: "es", shopName: "Barbería", periodKey: "2026-11", tz: "America/Mexico_City", row: renta(), entries: [], policyLabel: "Solo servicios" }),
  );
  const t = texto(html);
  assert.match(t, /Renta de silla · desde su alta \(16 nov\) −\$250\.00/);
});
