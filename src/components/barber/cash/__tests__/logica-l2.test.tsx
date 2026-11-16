/* ═══════════════════════════════════════════════════════════════════════
   Revisión de LÓGICA L2 (ws6-t3, 15-nov): Caja y Comisiones «como las usa
   una barbería», no solo «¿truena?».

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/cash/__tests__/logica-l2.test.tsx"

   Sin base de datos ni navegador: componentes puros pintados en node.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { PENDING_LOOKBACK_DAYS } from "@/lib/barber/cash";
import { ChangeMethodModal, CloseSessionModal } from "../session-modals";
import { SessionDetailModal } from "../session-detail";
import { TicketNewClient, newClientPrefill } from "../ticket-new-client";

function cajaDict(locale: "es" | "en"): Dictionary {
  return (getBarberDict(locale) as unknown as { barber: { caja: Dictionary } }).barber.caja;
}
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const TURNO = {
  session: {
    id: "s1", openedAt: "2026-11-15T15:00:00.000Z", closedAt: null, openedByName: "Rafa", closedByName: null,
    openingAmount: 500, expectedAmount: null, countedAmount: null, difference: null, notes: null,
    ticketCount: 3, cancelledCount: 0, salesTotal: 540, tipsTotal: 0,
  },
  byMethod: {
    CASH: { count: 3, subtotal: 540, tip: 0, total: 540 },
    CARD: { count: 0, subtotal: 0, tip: 0, total: 0 },
    SPEI: { count: 0, subtotal: 0, tip: 0, total: 0 },
    STRIPE: { count: 0, subtotal: 0, tip: 0, total: 0 },
  },
  cashTips: 0,
  expectedCash: 1040,
  sales: [],
} as unknown as Parameters<typeof CloseSessionModal>[0]["summary"];

test("cerrar turno con citas terminadas sin cobrar AVISA (es y en) y enlaza a la lista", () => {
  const noop = () => {};
  const con = texto(renderToStaticMarkup(<CloseSessionModal dict={cajaDict("es")} summary={TURNO} tz="America/Mexico_City" pendingAppointments={2} onClose={noop} onDone={noop} />));
  assert.match(con, /Hay 2 citas terminadas sin cobrar\./);
  assert.match(con, /Ver citas por cobrar/);
  const una = texto(renderToStaticMarkup(<CloseSessionModal dict={cajaDict("es")} summary={TURNO} tz="America/Mexico_City" pendingAppointments={1} onClose={noop} onDone={noop} />));
  assert.match(una, /Hay 1 cita terminada sin cobrar\./);
  const en = texto(renderToStaticMarkup(<CloseSessionModal dict={cajaDict("en")} summary={TURNO} tz="America/Mexico_City" pendingAppointments={3} onClose={noop} onDone={noop} />));
  assert.match(en, /3 finished appointments have not been charged\./);
  const sin = renderToStaticMarkup(<CloseSessionModal dict={cajaDict("es")} summary={TURNO} tz="America/Mexico_City" onClose={noop} onDone={noop} />);
  assert.doesNotMatch(sin, /data-aviso-citas-por-cobrar/, "sin citas pendientes no hay aviso");
});

test("las citas sin cobrar se siguen ofreciendo una semana (antes: solo ayer)", () => {
  assert.equal(PENDING_LOOKBACK_DAYS, 7);
});

test("ticket: buscar a alguien que no existe dice «nadie coincide» y ofrece darlo de alta", () => {
  const t = makeBarberT(cajaDict("es"));
  const html = texto(renderToStaticMarkup(<TicketNewClient t={t} query="Juan Pérez" onPicked={() => {}} />));
  assert.match(html, /Nadie coincide con «Juan Pérez»\./);
  assert.match(html, /Dar de alta/);
  const en = texto(renderToStaticMarkup(<TicketNewClient t={makeBarberT(cajaDict("en"))} query="Juan" onPicked={() => {}} />));
  assert.match(en, /Nobody matches “Juan”\./);
  assert.match(en, /Add client/);
});

test("lo tecleado pasa al alta: teléfono al teléfono, nombre al nombre", () => {
  assert.deepEqual(newClientPrefill("999 555 0301"), { name: "", phone: "999 555 0301" });
  assert.deepEqual(newClientPrefill("+52 (55) 1234-5678"), { name: "", phone: "+52 (55) 1234-5678" });
  assert.deepEqual(newClientPrefill("  Juan  "), { name: "Juan", phone: "" });
  assert.deepEqual(newClientPrefill("Juan 2"), { name: "Juan 2", phone: "" }, "un número corto dentro del nombre no es teléfono");
});

test("turnos anteriores: el detalle de un turno cerrado se abre con su fecha y avisa que solo se consulta", () => {
  const row = { ...TURNO.session, id: "s0", closedAt: "2026-11-14T22:00:00.000Z", openedAt: "2026-11-14T15:00:00.000Z" } as unknown as Parameters<typeof SessionDetailModal>[0]["row"];
  const html = texto(renderToStaticMarkup(<SessionDetailModal dict={cajaDict("es")} row={row} tz="America/Mexico_City" onClose={() => {}} />));
  assert.match(html, /Turno del 14 nov/);
  assert.match(html, /solo se consultan y se reimprimen/);
  assert.match(html, /Cargando/);
});

test("las claves nuevas existen en es y en", () => {
  const claves = [
    ["caja", "historyView"], ["caja", "historyDetailTitle"], ["caja", "historyDetailEmpty"], ["caja", "historyDetailClosed"], ["caja", "pendingOlder"],
    ["session", "apptsPendingHint"], ["session", "apptsPendingLink"],
    ["ticket", "clientNoMatch"], ["ticket", "newClient"], ["ticket", "newClientName"], ["ticket", "newClientPhone"], ["ticket", "newClientSave"], ["ticket", "newClientForbidden"],
    ["comisiones", "markOwed"], ["comisiones", "markOwedTitle"], ["comisiones", "markOwedBody"], ["comisiones", "markOwedConfirm"],
  ];
  for (const locale of ["es", "en"] as const) {
    const d = cajaDict(locale) as unknown as Record<string, Record<string, unknown>>;
    for (const [grupo, clave] of claves) {
      assert.equal(typeof d[grupo]?.[clave], "string", `${locale}: ${grupo}.${clave}`);
    }
    assert.equal(typeof (d.session?.apptsPending as Record<string, unknown>)?.other, "string", `${locale}: session.apptsPending.other`);
  }
});

test("comisiones: con renta mayor que lo producido el botón dice «Registrar su pago», no «Marcar pagado»", () => {
  const t = makeBarberT(cajaDict("es"));
  assert.equal(t("comisiones.markOwed"), "Registrar su pago");
  assert.match(t("comisiones.markOwedBody", { name: "Dos", amount: "$1,310.00", period: "noviembre 2026" }), /^Dos te debe \$1,310\.00 en noviembre 2026/);
});

test("ronda 2 · «Cambiar método de pago»: dice con qué se cobró y solo ofrece los OTROS métodos del mostrador", () => {
  const sale = { id: "v1", itemsSummary: "Corte de cabello", total: 180, paymentMethod: "CASH", methodChanges: [] } as unknown as Parameters<typeof ChangeMethodModal>[0]["sale"];
  const es = texto(renderToStaticMarkup(<ChangeMethodModal dict={cajaDict("es")} sale={sale} onClose={() => {}} onDone={() => {}} />));
  assert.match(es, /Cambiar método de pago/);
  assert.match(es, /Cobrado con Efectivo/);
  assert.match(es, /Cambiar a Tarjeta Transferencia \(SPEI\)/, "las opciones son los otros dos");
  assert.doesNotMatch(es, /Cambiar a Efectivo/);
  assert.match(es, /Después del corte, solo se puede cancelar/);
  const en = texto(renderToStaticMarkup(<ChangeMethodModal dict={cajaDict("en")} sale={sale} onClose={() => {}} onDone={() => {}} />));
  assert.match(en, /Change payment method/);
  assert.match(en, /After the cash count, it can only be cancelled/);
});
