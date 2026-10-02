// ws1-t4 (8c, ticket 3 de BEVADENT) — el aviso de saldo distingue «pago por realizar»
// (vence el …) de «saldo vencido», con el criterio único de lib/invoices/due-date, y elige
// la plantilla de Meta que dice lo mismo SOLO si ya está aprobada (si no, dc_aviso_saldo,
// como hoy). Todas fallan con el código viejo: no existían estadoDeCobro,
// fechaDeVencimientoHumana, `cobro`, `plantillaPreferida` ni kindDePlantilla.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estadoDeCobro, fechaDeVencimientoHumana } from "@/lib/invoices/due-date";
import { buildPaymentNotice } from "@/lib/invoices/payment-notice";
import { catalogEntryFor, checkCatalogEntry, DEFAULT_CATALOG_KINDS } from "@/lib/whatsapp/templates-catalog";
import { kindDePlantilla } from "@/lib/whatsapp/send-mode";
import { esAvisoDeCobro } from "@/lib/whatsapp/aviso-cobro-tope";

const TZ = "America/Mexico_City";
// 00:00 del 15-oct-2026 en México (así guarda parseInvoiceDueDate «2026-10-15»).
const VENCE_15 = new Date("2026-10-15T06:00:00.000Z");
const HOY_14 = new Date("2026-10-14T06:00:00.000Z");
const HOY_16 = new Date("2026-10-16T06:00:00.000Z");

test("estadoDeCobro: por pagar hasta el día de vencimiento, vencido desde el siguiente", () => {
  const f = { status: "PENDING", balance: 300, dueDate: VENCE_15 };
  assert.equal(estadoDeCobro(f, HOY_14), "por_pagar");
  assert.equal(estadoDeCobro(f, VENCE_15), "por_pagar");
  assert.equal(estadoDeCobro(f, HOY_16), "vencido");
  // Sin fecha nunca vence: es «por pagar».
  assert.equal(estadoDeCobro({ status: "PARTIAL", balance: 100, dueDate: null }, HOY_16), "por_pagar");
  // Nada que cobrar.
  assert.equal(estadoDeCobro({ status: "PAID", balance: 0, dueDate: VENCE_15 }, HOY_16), null);
  assert.equal(estadoDeCobro({ status: "DRAFT", balance: 300, dueDate: VENCE_15 }, HOY_16), null);
  assert.equal(estadoDeCobro({ status: "CANCELLED", balance: 300, dueDate: VENCE_15 }, HOY_16), null);
  // Un OVERDUE escrito a mano no decide nada: manda la fecha.
  assert.equal(estadoDeCobro({ status: "OVERDUE", balance: 300, dueDate: VENCE_15 }, HOY_14), "por_pagar");
});

test("fechaDeVencimientoHumana: el día en la zona de la clínica (no el anterior de UTC) y el año solo si cambia", () => {
  assert.equal(fechaDeVencimientoHumana(VENCE_15, TZ, HOY_14), "15 de octubre");
  assert.equal(fechaDeVencimientoHumana(new Date("2027-01-05T06:00:00.000Z"), TZ, HOY_14), "5 de enero de 2027");
  assert.equal(fechaDeVencimientoHumana(null, TZ), null);
  assert.equal(fechaDeVencimientoHumana("no-es-fecha", TZ), null);
});

const base = {
  patient: { firstName: "Ana", lastName: "Ruiz" },
  clinicName: "Clínica Sonrisa",
  clinicPhone: "555 123 4567",
  invoiceNumber: "MF-0249",
  balance: 300,
  items: [{ description: "Limpieza" }],
};

test("texto libre: «pago por realizar … Vence el …» para una nota sin vencer", () => {
  const n = buildPaymentNotice({ ...base, cobro: { estado: "por_pagar", vence: "15 de octubre" } });
  assert.match(n.body, /Tienes un pago por realizar de \$300\.00 MXN de tu nota MF-0249 \(Limpieza\)\. Vence el 15 de octubre\./);
  assert.doesNotMatch(n.body, /saldo pendiente|vencid/);
  assert.equal(n.plantillaPreferida, "payment_due");
  // Mismos cuatro datos que dc_aviso_saldo: el respaldo no cambia nada.
  assert.deepEqual(n.templateParams, ["Ana Ruiz", "Clínica Sonrisa", "$300.00 MXN", "555 123 4567"]);
});

test("texto libre: «saldo vencido … Venció el …» para una nota vencida; al responsable, «Hay»", () => {
  const n = buildPaymentNotice({ ...base, cobro: { estado: "vencido", vence: "15 de octubre" } });
  assert.match(n.body, /Tienes un saldo vencido de \$300\.00 MXN de tu nota MF-0249 \(Limpieza\)\. Venció el 15 de octubre\./);
  assert.equal(n.plantillaPreferida, "payment_overdue");
  const r = buildPaymentNotice({ ...base, aNombreDe: "Luis Ruiz", cobro: { estado: "vencido", vence: null } });
  assert.match(r.body, /Hay un saldo vencido de \$300\.00 MXN de la nota MF-0249 de Luis Ruiz \(Limpieza\)\. Puedes/);
});

test("sin `cobro` el texto de siempre, y con plazos manda la cuota del mes (sin plantilla nueva)", () => {
  const viejo = buildPaymentNotice(base);
  assert.match(viejo.body, /Tienes un saldo pendiente de \$300\.00 MXN/);
  assert.equal(viejo.plantillaPreferida, null);
  const plazos = buildPaymentNotice({ ...base, balance: 3000, pagoDelMes: 500, cobro: { estado: "vencido", vence: "1 de octubre" } });
  assert.match(plazos.body, /Tu pago de este mes es de \$500\.00 MXN \(saldo total \$3,000\.00 MXN\)/);
  assert.doesNotMatch(plazos.body, /Venció/);
  assert.equal(plazos.plantillaPreferida, null);
});

test("catálogo: dc_pago_por_realizar y dc_saldo_vencido son válidas, de fábrica y con los datos de dc_aviso_saldo", () => {
  const saldo = catalogEntryFor("payment_notice")!;
  for (const kind of ["payment_due", "payment_overdue"] as const) {
    const e = catalogEntryFor(kind);
    assert.ok(e, kind);
    assert.equal(checkCatalogEntry(e!), null);
    assert.equal(e!.category, "UTILITY");
    assert.deepEqual(e!.variableKeys, saldo.variableKeys);
    assert.ok(DEFAULT_CATALOG_KINDS.includes(kind));
  }
  assert.match(catalogEntryFor("payment_due")!.body, /pago por realizar/);
  assert.match(catalogEntryFor("payment_overdue")!.body, /saldo vencido/);
  // dc_aviso_saldo NO cambia: sigue siendo el respaldo aprobado.
  assert.match(saldo.body, /Tienes un saldo pendiente de \{\{3\}\}/);
});

test("kindDePlantilla: la nueva solo si está aprobada; en revisión, rechazada o sin dar de alta, dc_aviso_saldo", () => {
  const aprobada = { name: "dc_pago_por_realizar", lang: "es_MX", status: "APPROVED" as const };
  assert.equal(kindDePlantilla("payment_notice", "payment_due", { payment_due: aprobada }), "payment_due");
  // Sin estado = registrada a mano = aprobada (mismo criterio que decideSendMode).
  assert.equal(kindDePlantilla("payment_notice", "payment_overdue", { payment_overdue: { name: "dc_saldo_vencido", lang: "es_MX" } }), "payment_overdue");
  assert.equal(kindDePlantilla("payment_notice", "payment_due", { payment_due: { ...aprobada, status: "PENDING" } }), "payment_notice");
  assert.equal(kindDePlantilla("payment_notice", "payment_due", { payment_due: { ...aprobada, status: "REJECTED" } }), "payment_notice");
  assert.equal(kindDePlantilla("payment_notice", "payment_due", {}), "payment_notice");
  assert.equal(kindDePlantilla("payment_notice", null, { payment_due: aprobada }), "payment_notice");
  // Una preferida con OTROS datos nunca se usa con los parámetros de la de siempre.
  assert.equal(kindDePlantilla("payment_notice", "invoice_ready", { invoice_ready: { name: "dc_factura_lista", lang: "es_MX" } }), "payment_notice");
});

test("cableado: la ruta y Sabina calculan el estado y el envío se registra como payment_notice (cuenta para el tope)", () => {
  const raiz = process.cwd();
  const ruta = readFileSync(join(raiz, "src/app/api/invoices/[id]/send-whatsapp/route.ts"), "utf8");
  assert.match(ruta, /estadoDeCobro\(invoice, startOfTodayInTz/);
  assert.match(ruta, /dueDate: true/);
  assert.match(ruta, /plantillaPreferida,/);
  assert.match(ruta, /kind: esFactura \? "invoice_ready" : "payment_notice"/);
  const sabina = readFileSync(join(raiz, "src/lib/sabina/dinero/avisar-saldo.ts"), "utf8");
  assert.match(sabina, /kindDePlantilla\("payment_notice", aviso\.plantillaPreferida/);
  const envio = readFileSync(join(raiz, "src/lib/whatsapp/send-and-log.ts"), "utf8");
  assert.match(envio, /kindDePlantilla\(args\.kind, args\.plantillaPreferida/);
  assert.match(envio, /renderTemplateBody\(specForKind\(kindPlantilla\)/);
  assert.ok(esAvisoDeCobro("payment_notice"));
});
