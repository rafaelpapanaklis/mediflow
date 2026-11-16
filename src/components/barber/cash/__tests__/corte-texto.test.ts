// Caja completa (ws6-t1), punto 3: el texto del corte (impreso y WhatsApp).
//   npx tsx --test src/components/barber/cash/__tests__/corte-texto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { cajaResumen } from "@/lib/barber/caja-resumen";
import { parseCashCount } from "@/lib/barber/caja-movimientos-core";
import { corteDiffLabel, corteWhatsappText, denominationLabel, waMeLink, type CorteSummary } from "../corte-core";

function tOf(locale: "es" | "en") {
  const dict = (getBarberDict(locale) as unknown as { barber: { caja: Dictionary } }).barber.caja;
  return makeBarberT(dict);
}

/** El día de prueba del dueño (reporte ws6-t1), ya cerrado contando $270. */
function dia(): CorteSummary {
  const resumen = cajaResumen({
    openingAmount: 500,
    tickets: [
      { paymentMethod: "CASH", subtotal: 800, tip: 50, total: 850, cancelled: false, kind: "sale", barberId: "b1", barberName: "Juan" },
      { paymentMethod: "CARD", subtotal: 270, tip: 30, total: 300, cancelled: false, kind: "sale", barberId: "b2", barberName: "Pepe" },
      { paymentMethod: "SPEI", subtotal: 180, tip: 0, total: 180, cancelled: false, kind: "sale", barberId: "b1", barberName: "Juan" },
    ],
    movements: [
      { type: "EXPENSE", method: "CASH", amount: 80, category: "SUPPLIES", barberId: null, payoutKind: null },
      { type: "BARBER_PAYOUT", method: "CASH", amount: 200, category: null, barberId: "b2", barberName: "Pepe", payoutKind: "ADVANCE" },
      { type: "WITHDRAWAL", method: "CASH", amount: 1000, category: null, barberId: null, payoutKind: null },
      { type: "DEPOSIT", method: "CASH", amount: 200, category: null, barberId: null, payoutKind: null },
    ],
  });
  return {
    resumen,
    expectedCash: resumen.expectedCash,
    session: {
      id: "s1",
      openedAt: "2026-11-16T15:12:00.000Z",
      closedAt: "2026-11-17T02:05:00.000Z",
      openingAmount: 500,
      countedAmount: 270,
      expectedAmount: 270,
      difference: 0,
      notes: null,
      openedByUserId: "u1",
      openedByName: "Juan Pérez",
      closedByUserId: "u1",
      closedByName: "Juan Pérez",
      ticketCount: 3,
      cancelledCount: 0,
      salesTotal: 1250,
      tipsTotal: 80,
      cashTotal: 850,
      countedBreakdown: { "200": 1, "50": 1, "20": 1 },
      leftForNext: 200,
    },
  };
}

test("«Cuadra», «Sobran $X», «Faltan $X» (es y en)", () => {
  const es = tOf("es");
  const en = tOf("en");
  assert.equal(corteDiffLabel(es, 0), "Cuadra");
  assert.equal(corteDiffLabel(es, 2000), "Sobran $20.00");
  assert.equal(corteDiffLabel(es, -50), "Faltan $0.50");
  assert.equal(corteDiffLabel(en, -2000), "$20.00 short");
});

test("el texto de WhatsApp trae el esperado desglosado y cuadra con el día de prueba", () => {
  const text = corteWhatsappText(dia(), { shopName: "Barbería Centro", tz: "America/Mexico_City", t: tOf("es"), categoryLabel: (c) => (c === "SUPPLIES" ? "Insumos" : c) });
  const orden = [
    "*Corte de caja · Barbería Centro*",
    "Fondo inicial: $500.00",
    "+ Efectivo cobrado en el turno: $850.00",
    "+ Entradas de efectivo: $200.00",
    "− Gastos pagados en efectivo: $80.00",
    "− Retiros: $1,000.00",
    "− Pagos a barberos en efectivo: $200.00",
    "= Esperado en efectivo: $270.00",
    "Contado: $270.00",
    "Diferencia: Cuadra",
    "Fondo para mañana: $200.00",
    "*Cobrado (con propinas): $1,330.00*",
    "Efectivo: $850.00 · Tarjeta: $300.00 · Transferencia (SPEI): $180.00",
    "Tickets: 3 · Ticket promedio: $416.67",
    "*Gastos: $80.00*",
    "Insumos: $80.00",
  ];
  let desde = 0;
  for (const trozo of orden) {
    const i = text.indexOf(trozo, desde);
    assert.ok(i >= 0, `falta «${trozo}» (o fuera de orden) en:\n${text}`);
    desde = i + trozo.length;
  }
  assert.doesNotMatch(text, /\b(corte|session|cards|caja)\.[a-zA-Z]/, "ninguna llave sin traducir");
  assert.doesNotMatch(text, /Anticipos devueltos/, "sin devoluciones no sale la fila");
});

test("wa.me solo abre WhatsApp con el texto (sin número ni API)", () => {
  const link = waMeLink("Corte · $270.00\nCuadra");
  assert.equal(link, "https://wa.me/?text=Corte%20%C2%B7%20%24270.00%0ACuadra");
});

test("denominaciones: el conteo suma en centavos exactos y la moneda de $20 se distingue del billete", () => {
  assert.deepEqual(parseCashCount({ "1000": 1, "20": 2, "20c": 3, "0.5": 3 }), { count: { "1000": 1, "20": 2, "20c": 3, "0.5": 3 }, cents: 100000 + 4000 + 6000 + 150 });
  assert.equal(parseCashCount({ "7": 1 }), null);
  assert.equal(parseCashCount({ "10": 1.5 }), null);
  assert.equal(parseCashCount({ "10": "abc" }), null);
  assert.deepEqual(parseCashCount({ "10": "" }), { count: {}, cents: 0 });
  assert.equal(denominationLabel(tOf("es"), "20c"), "$20 moneda");
  assert.equal(denominationLabel(tOf("es"), "0.5"), "$0.50");
  assert.equal(denominationLabel(tOf("es"), "500"), "$500");
});
