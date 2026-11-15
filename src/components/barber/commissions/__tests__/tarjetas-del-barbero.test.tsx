/* ═══════════════════════════════════════════════════════════════════════
   COMISIONES vistas por el BARBERO (C-M1, ronda 10 de la revisión).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/commissions/__tests__/tarjetas-del-barbero.test.tsx

   Con summary.selfOnly la pantalla es SUYA: «A pagarte» y «Debes de renta»
   (no «Por pagar a barberos» ni «Te deben de renta», que son del dueño), y la
   tarjeta de renta no sale si no debe nada. El dueño la ve igual que antes.
   Se pinta el componente de verdad (react-dom/server).
   ═══════════════════════════════════════════════════════════════════════ */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Dictionary } from "@/i18n/t";
import type { CommissionSummary, CommissionSummaryRow } from "@/lib/barber/commissions";
import { getBarberDict } from "@/i18n/dictionaries/barber";

// El componente usa useRouter y trae su hoja de estilos: fuera de Next se doblan.
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

function fila(totalToPay: number, extra: Partial<CommissionSummaryRow> = {}): CommissionSummaryRow {
  return {
    barberId: "b1", barberName: "Uno", nickname: null, isActive: true,
    commissionType: "COMMISSION", commissionPct: 50, chairRent: null,
    ticketCount: 1, servicesTotal: 180, productsTotal: 0, adjustmentsTotal: 0,
    produced: 180, tips: 0, commissionBase: 180, commissionTotal: 90, commissionPaid: 0,
    commissionPending: 90, tipsPaid: 0, tipsPending: 0, chairRentDiscounted: false,
    chairRentPending: null, totalToPay, paidTotal: 0, periodTotal: totalToPay,
    paidStatus: "PENDING", lastPaidAt: null, entryCount: 1,
    ...extra,
  } as CommissionSummaryRow;
}

function resumen(selfOnly: boolean, rows: CommissionSummaryRow[]): CommissionSummary {
  return {
    periodKey: "2026-11",
    timezone: "America/Mexico_City",
    policy: {} as CommissionSummary["policy"],
    selfOnly,
    rows,
    totals: { produced: 180, tips: 0, commissionTotal: 90, commissionPending: 90, totalToPay: 0, paidTotal: 0 },
  };
}

async function pinta(locale: "es" | "en", summary: CommissionSummary): Promise<string> {
  const { ComisionesClient } = await import("../comisiones-client");
  const dict = ((getBarberDict(locale).barber as Dictionary).caja ?? {}) as Dictionary;
  return renderToStaticMarkup(
    createElement(ComisionesClient, { dict, locale, summary, maxPeriod: "2026-11", canManage: false, noBarberLinked: false }),
  );
}

test("el Barbero con comisión: «A pagarte» y SIN tarjeta de renta (no debe nada)", async () => {
  const html = await pinta("es", resumen(true, [fila(90)]));
  assert.match(html, /A pagarte/);
  assert.doesNotMatch(html, /Por pagar a barberos/);
  assert.doesNotMatch(html, /Te deben de renta/);
  assert.doesNotMatch(html, /Debes de renta/, "renta en 0: la tarjeta no sale");
  assert.doesNotMatch(html, /bcaja-kpis--5/, "con cuatro tarjetas, rejilla de cuatro");
});

test("el Barbero de renta de silla que debe renta: «Debes de renta», no «Te deben»", async () => {
  const html = await pinta("es", resumen(true, [fila(-1310, { commissionType: "CHAIR_RENT", chairRent: 1500, chairRentPending: 1500 })]));
  assert.match(html, /A pagarte/);
  assert.match(html, /Debes de renta/);
  assert.match(html, /1,310/);
  assert.doesNotMatch(html, /Te deben de renta/);
  assert.match(html, /bcaja-kpis--5/);
});

test("en inglés: «To pay you» y «You owe in rent»", async () => {
  const html = await pinta("en", resumen(true, [fila(-200, { commissionType: "CHAIR_RENT", chairRent: 500, chairRentPending: 500 })]));
  assert.match(html, /To pay you/);
  assert.match(html, /You owe in rent/);
  assert.doesNotMatch(html, /Owed to you in rent/);
});

test("el dueño (sin selfOnly) lo ve como antes: las dos cifras siempre, aunque la renta sea 0", async () => {
  const html = await pinta("es", resumen(false, [fila(90), fila(0, { barberId: "b2", barberName: "Dos" })]));
  assert.match(html, /Por pagar a barberos/);
  assert.match(html, /Te deben de renta/);
  assert.doesNotMatch(html, /A pagarte|Debes de renta/);
  assert.match(html, /bcaja-kpis--5/);
});
