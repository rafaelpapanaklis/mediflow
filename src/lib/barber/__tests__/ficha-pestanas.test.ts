// La ficha del cliente «A» (ws6-t3): pestañas, dirección y piezas puras.
//   npx tsx --test src/lib/barber/__tests__/ficha-pestanas.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FICHA_TABS,
  cancelInfoOf,
  fichaTabSearch,
  nextAppointmentOf,
  normalizeFichaTab,
  resolveFichaTab,
  stepFichaTab,
  ticketShortId,
  visibleFichaTabs,
} from "@/lib/barber/ficha-core";
import { CANCELLED_MARK } from "@/lib/barber/commissions";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const todas = [...FICHA_TABS];

test("las seis pestañas, en el orden del mockup A", () => {
  assert.deepEqual(todas, ["resumen", "corte", "pagos", "fotos", "historial", "membresia"]);
});

test("?tab= manda; #pagos y #cobros (las anclas de antes) siguen abriendo Pagos", () => {
  assert.equal(resolveFichaTab({ tab: "pagos" }, todas), "pagos");
  assert.equal(resolveFichaTab({ hash: "#pagos" }, todas), "pagos");
  assert.equal(resolveFichaTab({ hash: "#cobros" }, todas), "pagos");
  assert.equal(resolveFichaTab({ tab: "Fotos" }, todas), "fotos");
  assert.equal(resolveFichaTab({ tab: "corte", hash: "#pagos" }, todas), "corte");
  assert.equal(resolveFichaTab({ tab: "estrellas" }, todas), "historial");
});

test("una pestaña que no existe o que esta sesión no ve cae al Resumen", () => {
  assert.equal(resolveFichaTab({ tab: "nada" }, todas), "resumen");
  assert.equal(resolveFichaTab({}, todas), "resumen");
  const sinPagos = visibleFichaTabs({ canSeePayments: false, hasMembership: false, canSellMembership: false });
  assert.deepEqual(sinPagos, ["resumen", "corte", "fotos", "historial"]);
  assert.equal(resolveFichaTab({ tab: "pagos" }, sinPagos), "resumen");
  assert.equal(resolveFichaTab({ hash: "#pagos" }, sinPagos), "resumen");
});

test("Membresía solo si la tiene o se le puede vender", () => {
  assert.ok(visibleFichaTabs({ canSeePayments: true, hasMembership: true, canSellMembership: false }).includes("membresia"));
  assert.ok(visibleFichaTabs({ canSeePayments: true, hasMembership: false, canSellMembership: true }).includes("membresia"));
  assert.ok(!visibleFichaTabs({ canSeePayments: true, hasMembership: false, canSellMembership: false }).includes("membresia"));
});

test("la dirección conserva los demás parámetros y el Resumen no lleva ?tab=", () => {
  assert.equal(fichaTabSearch("", "pagos"), "?tab=pagos");
  assert.equal(fichaTabSearch("?ya=1&tab=corte", "pagos"), "?ya=1&tab=pagos");
  assert.equal(fichaTabSearch("?tab=pagos", "resumen"), "");
  assert.equal(fichaTabSearch("ya=1&tab=pagos", "resumen"), "?ya=1");
});

test("normalizar: mayúsculas, espacios y almohadilla", () => {
  assert.equal(normalizeFichaTab(" #Historial "), "historial");
  assert.equal(normalizeFichaTab(""), null);
  assert.equal(normalizeFichaTab(null), null);
});

test("flechas: siguiente y anterior dan la vuelta", () => {
  const t = ["resumen", "corte", "fotos"] as const;
  assert.equal(stepFichaTab(t, "fotos", 1), "resumen");
  assert.equal(stepFichaTab(t, "resumen", -1), "fotos");
  assert.equal(stepFichaTab(t, "corte", 1), "fotos");
});

test("próxima cita: la más cercana en el futuro, pendiente o confirmada", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const e = (id: string, at: string, status: string | null, kind = "appointment") => ({ id, at, status, kind });
  const entries = [
    e("lejana", "2026-12-20T15:00:00Z", "CONFIRMED"),
    e("cancelada", "2026-11-18T15:00:00Z", "CANCELLED"),
    e("pasada", "2026-11-10T15:00:00Z", "PENDING"),
    e("venta", "2026-11-17T15:00:00Z", null, "sale"),
    e("buena", "2026-12-05T19:30:00Z", "PENDING"),
  ];
  assert.equal(nextAppointmentOf(entries, now)?.id, "buena");
  assert.equal(nextAppointmentOf([e("x", "2026-11-01T00:00:00Z", "DONE")], now), null);
});

test("marca de cancelación: quién y por qué, aunque el motivo lleve « · »", () => {
  const notes =
    `${CANCELLED_MARK} 2026-11-15T20:10:00.000Z · Rafael Pérez · Se cobró dos veces · era prueba · ` +
    `Original: Corte y barba · subtotal 300.00 · propina 0.00 · total 300.00 (CASH)\nnota a mano`;
  assert.deepEqual(cancelInfoOf(notes, CANCELLED_MARK), {
    at: "2026-11-15T20:10:00.000Z",
    by: "Rafael Pérez",
    reason: "Se cobró dos veces · era prueba",
  });
  assert.equal(cancelInfoOf("nota normal", CANCELLED_MARK), null);
  assert.equal(cancelInfoOf(null, CANCELLED_MARK), null);
});

test("folio corto igual al del ticket impreso", () => {
  assert.equal(ticketShortId("cmabc123def3f9a2c"), "3F9A2C");
});

// ── Que la ficha siga haciendo lo que hacía (estático) ───────────────────

test("la ficha conserva cada función de antes", () => {
  const src = ["client-detail.tsx", "ficha-secciones.tsx"]
    .map((n) => readFileSync(join(RAIZ, "src/components/barber/clients", n), "utf8"))
    .join("\n");
  for (const pieza of [
    "<StarsPanel",
    "<LoyaltyCard",
    "<PreferencesPanel",
    "<PhotoUploader",
    "<VisitTimeline",
    "<ClientSales",
    "<ClientDrafts",
    "<ClientChargeBridge",
    "<EditClientModal",
    "<BlockModal",
    "<ChatClienteLink",
    "/barber/agenda?nueva=",
    'searchParams.get("ya")',
    "new.notSame",
    "<StarsHistoryList",
    "/barber/agenda?fecha=",
    "<SellMembershipModal",
    "toggleVisible",
    "removePhoto",
    "setBlocked",
  ]) {
    assert.ok(src.includes(pieza), `falta ${pieza}`);
  }
});

test("Pagos usa los MISMOS diálogos y rutas que Caja para cambiar método y cancelar", () => {
  const src = readFileSync(join(RAIZ, "src/components/barber/clients/client-sales.tsx"), "utf8");
  assert.match(src, /import \{[^}]*CancelSaleModal[^}]*\} from "@\/components\/barber\/cash\/session-modals"/);
  assert.match(src, /ChangeMethodModal/);
  assert.doesNotMatch(src, /\/api\/barber\/sales\/\$\{[^}]+\}\/(cancel|payment-method)/, "la ficha no llama a las rutas por su cuenta");
});

test("filtros de Pagos: lo válido pasa, lo raro cae a «todos»", async () => {
  const { parseClientSalesFilter, clientSalesFilterQuery, salesPeriodStart } = await import("@/lib/barber/ficha-core");
  const q = new URLSearchParams("estado=cancelled&periodo=90d&metodo=CARD");
  const f = parseClientSalesFilter((k) => q.get(k));
  assert.deepEqual(f, { status: "cancelled", period: "90d", method: "CARD" });
  assert.equal(clientSalesFilterQuery(f), "estado=cancelled&periodo=90d&metodo=CARD");
  const raro = new URLSearchParams("estado=borrado&periodo=siglo&metodo=BITCOIN");
  assert.deepEqual(parseClientSalesFilter((k) => raro.get(k)), { status: "all", period: "all", method: "all" });
  const now = new Date("2026-11-16T00:00:00Z");
  assert.equal(salesPeriodStart("30d", now)?.toISOString(), "2026-10-17T00:00:00.000Z");
  assert.equal(salesPeriodStart("all", now), null);
});

test("cabecera: el botón para escribirle dice «WhatsApp» y usa ChatClienteLink (Rafael, 16-nov)", () => {
  const src = readFileSync(join(RAIZ, "src/components/barber/clients/client-detail.tsx"), "utf8");
  const i = src.indexOf('data-accion="whatsapp"');
  assert.ok(i > 0, "falta el botón WhatsApp de la cabecera");
  const trozo = src.slice(src.lastIndexOf("<ChatClienteLink", i), src.indexOf("</ChatClienteLink>", i));
  assert.match(trozo, /<WhatsAppGlyph/);
  assert.match(trozo, /t\("detail\.whatsapp"\)/);
  assert.doesNotMatch(trozo, /detail\.message"/);
});

test("los diálogos que se abren dentro de la ficha no quedan bajo un container-type", () => {
  const css = readFileSync(join(RAIZ, "src/components/barber/clients/ficha.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /container-type/);
  const cobros = readFileSync(join(RAIZ, "src/components/barber/clients/client-sales.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // El único contenedor es la caja de notas «Por cobrar» (sin diálogos dentro).
  const bloques = cobros.split("}").filter((b) => /container-type/.test(b));
  assert.deepEqual(bloques.map((b) => b.split("{")[0].trim()), [".wrap", ".draftsBox"]);
});
