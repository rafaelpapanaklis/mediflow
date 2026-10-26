/**
 * v4 (nota 3 del gerente; revisión t5 N2/N3): lo que se le dice al paciente es lo que debe DE VERDAD, y
 * los tres mensajes dicen lo MISMO. En ortodoncia «Precio total a plazos», «debes» es lo vencido y el
 * saldo total del tratamiento va como dato aparte (decisión de Rafael, 26-oct-2026).
 *
 * Run: npm run test:plan-por-cobrar
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { textoDelSaldo, type ResumenSaldo } from "@/lib/whatsapp/bot/saldo-core";
import { buildPaymentNotice } from "@/lib/invoices/payment-notice";
import { buildCorreoFactura, lineaAunNoLoDebes } from "@/lib/invoices/correo-factura";

const fmt = { importe: (n: number) => `$${n}`, fecha: (iso: string) => iso };
const resumen = (extra: Partial<ResumenSaldo>): ResumenSaldo => ({
  vencimiento: "2026-11-10", importeCuota: 2000, numeroCuota: 4, esEnganche: false, totalCuotas: 10,
  pendiente: 24000, tieneVencidas: true, vencido: 8000, ...extra,
});

test("bot «¿cuánto debo?»: «Debes» es lo vencido; la próxima cuota y el saldo total, aparte", () => {
  const t = textoDelSaldo(resumen({}), fmt);
  assert.match(t, /^Debes \*\$8000\* de pagos atrasados/);
  assert.match(t, /mensualidad 4 de 10\* es de \*\$2000\* y vence el \*2026-11-10\*/);
  assert.match(t, /Tu saldo total es de \*\$24000\*/);
  assert.doesNotMatch(t, /Te queda pendiente/, "ya no se presenta el total como lo que debe");
  assert.doesNotMatch(t, /tratamiento|procedimiento/i, "lo mínimo: sin datos clínicos");
});

test("bot: al corriente, no debe nada (y no se inventa una deuda)", () => {
  const t = textoDelSaldo(resumen({ vencido: 0, tieneVencidas: false }), fmt);
  assert.match(t, /^Por ahora no debes nada/);
  assert.match(t, /Tu saldo total es de \*\$24000\*/);
});

test("bot: todo vencido y ninguna cuota por vencer — se dice lo vencido, sin inventar una próxima mensualidad", () => {
  const t = textoDelSaldo(resumen({ vencimiento: null, importeCuota: 0, vencido: 6000, pendiente: 6000 }), fmt);
  assert.match(t, /^Debes \*\$6000\*/);
  assert.doesNotMatch(t, /mensualidad/);
});

test("aviso de la nota (ortodoncia «Precio total»): «tienes un saldo vencido de $8,000», y el total aparte; la plantilla lleva lo vencido", () => {
  const a = buildPaymentNotice({
    patient: { firstName: "Ana", lastName: "López" }, clinicName: "Clínica", clinicPhone: "5550000000", invoiceNumber: "F-1",
    balance: 8000, saldoTotalDelTratamiento: 24000, items: [{ description: "Ortodoncia", quantity: 1, unitPrice: 24000 }],
    pagoDelMes: null,
  });
  assert.match(a.body, /Tienes un saldo vencido de \$8,000\.00 MXN \(saldo total del tratamiento \$24,000\.00 MXN\)/);
  assert.equal(a.templateParams[2], a.amount);
  assert.match(a.amount, /8,000/);
  // Sin el dato aparte, el aviso de siempre.
  const siempre = buildPaymentNotice({ patient: { firstName: "Ana" }, clinicName: "C", clinicPhone: "1", invoiceNumber: "F-2", balance: 500, items: [] });
  assert.doesNotMatch(siempre.body, /tratamiento/);
});

test("correo de la nota: la misma línea que el portal («de esto, $X aún no lo debes»)", () => {
  const c = buildCorreoFactura({
    patient: { firstName: "Ana" }, clinicName: "Clínica", invoiceNumber: "F-1", total: 2050.5, paid: 0, balance: 2050.5,
    items: [{ description: "Resina", quantity: 1, unitPrice: 1250.5 }, { description: "Limpieza", quantity: 1, unitPrice: 800 }],
    aunNoSeDebe: 2050.5,
  });
  const linea = lineaAunNoLoDebes(2050.5, 2050.5)!;
  assert.ok(c.text.includes(linea), "en el texto");
  assert.ok(c.html.includes("aún no lo debes"), "y en el HTML");
  assert.match(linea, /\$2,050\.50/);
  // Sin nada pendiente de hacer, el correo de siempre (sin la línea).
  const siempre = buildCorreoFactura({ patient: null, clinicName: "C", invoiceNumber: "F-2", total: 100, paid: 0, balance: 100, items: [] });
  assert.doesNotMatch(siempre.text, /aún no lo debes/);
  assert.equal(lineaAunNoLoDebes(100, 0), null);
  assert.equal(lineaAunNoLoDebes(100, 300), lineaAunNoLoDebes(100, 100), "nunca más que el saldo");
});
