// ws1-t4 (8d, ticket 3 de BEVADENT) — «Cobrar hoy»: concepto, importe, pago recibido,
// saldo que queda y comprobante opcional en un paso, con las rutas de siempre.
// Fallan con el código viejo: no existían lib/invoices/cobrar-hoy ni la hoja, y «Cobrar»
// de una cita sin nota terminaba en «Esta cita todavía no tiene factura».

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  conceptoDeLaCita,
  cuerpoNotaCobroHoy,
  pagoTrasCrear,
  pendientesPrevios,
  resumenCobroHoy,
} from "@/lib/invoices/cobrar-hoy";
import { invoiceSchema } from "@/lib/validations";
import { computeInvoiceTotal, sumInvoiceItems } from "@/lib/invoice-totals";

const limpieza = { nombre: "Limpieza", importe: 700 };
const resina = { nombre: "Resina", importe: 1500 };

test("resumen en vivo: total, paga hoy y lo que queda", () => {
  assert.deepEqual(resumenCobroHoy({ conceptos: [limpieza, resina], pago: 1000 }), { total: 2200, pago: 1000, saldoQueda: 1200, falta: null });
  // Paga todo → queda en 0.
  assert.equal(resumenCobroHoy({ conceptos: [limpieza], pago: 700 }).saldoQueda, 0);
  // Sin pago es válido: se crea el cargo y queda todo por cobrar.
  assert.deepEqual(resumenCobroHoy({ conceptos: [limpieza], pago: "" }), { total: 700, pago: 0, saldoQueda: 700, falta: null });
  // La clínica con IVA: el precio YA lo incluye (default de «Nueva factura»), el total no cambia.
  assert.equal(resumenCobroHoy({ conceptos: [limpieza], pago: 0, clinicTaxMode: "iva16" }).total, 700);
});

test("lo que impide guardar, en orden", () => {
  assert.equal(resumenCobroHoy({ conceptos: [], pago: 0 }).falta, "sin_conceptos");
  assert.equal(resumenCobroHoy({ conceptos: [{ nombre: "  ", importe: 100 }], pago: 0 }).falta, "concepto_sin_nombre");
  assert.equal(resumenCobroHoy({ conceptos: [{ nombre: "Resina", importe: NaN }], pago: 0 }).falta, "importe_invalido");
  assert.equal(resumenCobroHoy({ conceptos: [{ nombre: "Revisión", importe: 0 }], pago: 0 }).falta, "total_cero");
  assert.equal(resumenCobroHoy({ conceptos: [limpieza], pago: -5 }).falta, "pago_invalido");
  assert.equal(resumenCobroHoy({ conceptos: [limpieza], pago: "abc" }).falta, "pago_invalido");
  assert.equal(resumenCobroHoy({ conceptos: [limpieza], pago: 701 }).falta, "pago_mayor");
});

test("la nota viaja con el MISMO contrato de POST /api/invoices y su total es el que guardará el servidor", () => {
  const cuerpo = cuerpoNotaCobroHoy({ patientId: "p1", appointmentId: "a1", conceptos: [limpieza, resina], clinicTaxMode: "iva16" });
  const valido = invoiceSchema.parse(cuerpo);
  assert.equal(valido.appointmentId, "a1");
  assert.equal(cuerpo.discount, 0);
  assert.equal(sumInvoiceItems(valido.items), 2200);
  const { total } = computeInvoiceTotal(valido.items, cuerpo.discount, cuerpo.taxRate, cuerpo.taxIncluded);
  assert.equal(total, resumenCobroHoy({ conceptos: [limpieza, resina], pago: 0, clinicTaxMode: "iva16" }).total);
  // Desde la ficha (sin cita) no manda appointmentId.
  assert.ok(!("appointmentId" in cuerpoNotaCobroHoy({ patientId: "p1", conceptos: [limpieza] })));
});

test("el anticipo que la nota toma al nacer recorta el pago: nunca se cobra de más", () => {
  assert.deepEqual(pagoTrasCrear(700, 700), { monto: 700, recortado: false });
  assert.deepEqual(pagoTrasCrear(700, 200), { monto: 200, recortado: true });
  assert.deepEqual(pagoTrasCrear(0, 700), { monto: 0, recortado: false });
});

test("desde la cita: el procedimiento del tarifario con ese nombre (sin acentos ni mayúsculas), o el motivo sin precio", () => {
  const catalogo = [{ id: "pr1", name: "Limpieza dental", basePrice: 700 }, { id: "pr2", name: "Resina", basePrice: 1500 }];
  assert.deepEqual(conceptoDeLaCita("limpieza  DENTAL", catalogo), { nombre: "Limpieza dental", importe: 700, procedureId: "pr1" });
  const libre = conceptoDeLaCita("Valoración de ortodoncia", catalogo)!;
  assert.equal(libre.nombre, "Valoración de ortodoncia");
  assert.ok(Number.isNaN(libre.importe)); // la recepción escribe el precio; no se adivina
  assert.equal(conceptoDeLaCita("  ", catalogo), null);
  assert.equal(conceptoDeLaCita(null, catalogo), null);
});

test("notas anteriores por cobrar: se cuentan para enlazarlas, sin pagadas ni canceladas", () => {
  assert.deepEqual(
    pendientesPrevios([
      { status: "PENDING", balance: 300 },
      { status: "PARTIAL", balance: 200.5 },
      { status: "PAID", balance: 0 },
      { status: "CANCELLED", balance: 900 },
      { status: "OVERDUE", balance: 100 },
    ]),
    { cuantas: 3, saldo: 600.5 },
  );
});

const raiz = process.cwd();
const leer = (p: string) => readFileSync(join(raiz, p), "utf8");

test("la hoja usa las rutas de siempre, en orden, y no manda avisos de cobro", () => {
  const hoja = leer("src/components/dashboard/cobrar-hoy/cobrar-hoy.tsx");
  assert.match(hoja, /^"use client";/);
  const crear = hoja.indexOf('fetch("/api/invoices", {');
  const pagar = hoja.indexOf("fetch(`/api/invoices/${actual.id}`, {");
  const recibo = hoja.indexOf("fetch(`/api/invoices/${actual.id}/send-receipt`");
  assert.ok(crear > 0 && pagar > crear && recibo > pagar, "crear → pagar → comprobante");
  // Mismo cuerpo que «Registrar pago» (useCobro / PaymentModal).
  assert.match(hoja, /amount: monto,\s*method: metodo,\s*paidAt: paidAtInstant\(todayLocalISO\(\)\)\?\.toISOString\(\),/);
  // Ni aviso de saldo ni nota por WhatsApp: el tope de un aviso de cobro al día no se toca.
  assert.doesNotMatch(hoja, /send-whatsapp/);
  // El comprobante nace apagado y solo sale si hubo pago.
  assert.match(hoja, /const \[comprobante, setComprobante\] = useState\(false\);/);
  assert.match(hoja, /if \(comprobante && cobrado > 0\)/);
  // Reintento: la nota creada se recuerda y no se crea otra.
  assert.match(hoja, /let actual = nota;\s*if \(!actual\) \{/);
  // Caja cerrada: el freno de siempre, ANTES de crear.
  assert.ok(hoja.indexOf("freno.frenar()") < crear);
  // Sin colores escritos a mano.
  assert.doesNotMatch(hoja, /#[0-9a-fA-F]{3,6}\b/);
});

test("cableado: la cita sin nota abre la hoja; la ficha la ofrece y ?charge=1 la usa", () => {
  const panel = leer("src/components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /if \(!esCitaOrtoConHoja\(dto\.reason \?\? null\)\) \{\s*setCobrarHoy\(\{ id: dto\.id, motivo: dto\.reason \?\? null \}\);/);
  assert.doesNotMatch(panel, /"Esta cita todavía no tiene factura\."/);
  assert.match(panel, /<CobrarHoy[\s\S]*?cita=\{cobrarHoy\}/);
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /onCobrarHoy=\{canViewBilling \? \(\) => setCobrarHoyAbierto\(true\) : undefined\}/);
  assert.match(ficha, /if \(borradorDeHoy\) \{ void openDirectPayment\(borradorDeHoy\); return; \}\s*if \(canViewBilling\) \{ setCobrarHoyAbierto\(true\); return; \}/);
  assert.match(ficha, /pendientes=\{pendientesPrevios\(invoices\)\}/);
  const tarjeta = leer("src/components/dashboard/patient-detail/side-cards.tsx");
  assert.match(tarjeta, /\{onCobrarHoy && puedeCobrar && \(/);
});

test("textos es/en: las mismas llaves de cobrarHoy", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).cobrarHoy;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).cobrarHoy;
  assert.ok(es && en);
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  const hoja = leer("src/components/dashboard/cobrar-hoy/cobrar-hoy.tsx");
  for (const m of Array.from(hoja.matchAll(/"cobrarHoy\.([a-zA-Z]+)"/g))) assert.ok(es[m[1]] && en[m[1]], m[1]);
});
