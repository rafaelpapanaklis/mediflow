// ws1-t4 #82 (decisión de Rafael, ws1-t10) — «Tu pago de este mes es $X (saldo total $Y)»
// en el aviso de cobro de una factura a plazos; la plantilla de Meta no se toca.
// Correr: npm run test:pago-del-mes
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPaymentNotice } from "../payment-notice";
import { pagoDelMesDeFactura } from "../pago-del-mes";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const base = { patient: { firstName: "Ana", lastName: "Ruiz" }, clinicName: "Clínica X", clinicPhone: "5511112222", invoiceNumber: "MF-1", balance: 30000, items: [{ description: "Ortodoncia" }] };

test("factura a plazos: el texto libre dice el pago del mes y el saldo total", () => {
  const n = buildPaymentNotice({ ...base, pagoDelMes: 6000 });
  assert.match(n.body, /Tu pago de este mes es de \$6,000\.00 MXN \(saldo total \$30,000\.00 MXN\) de tu nota MF-1/);
  assert.doesNotMatch(n.body, /Tienes un saldo pendiente/);
});

test("la plantilla aprobada por Meta NO cambia: sigue diciendo el saldo total", () => {
  const n = buildPaymentNotice({ ...base, pagoDelMes: 6000 });
  assert.equal(n.amount, "$30,000.00 MXN");
  assert.deepEqual(n.templateParams, ["Ana Ruiz", "Clínica X", "$30,000.00 MXN", "5511112222"]);
});

test("sin pago del mes (pago único) o si la cuota ya es todo el saldo: el texto de siempre", () => {
  assert.match(buildPaymentNotice({ ...base }).body, /Tienes un saldo pendiente de \$30,000\.00 MXN de tu nota MF-1/);
  assert.match(buildPaymentNotice({ ...base, pagoDelMes: null }).body, /Tienes un saldo pendiente/);
  assert.match(buildPaymentNotice({ ...base, pagoDelMes: 30000 }).body, /Tienes un saldo pendiente/);
  assert.match(buildPaymentNotice({ ...base, pagoDelMes: 0 }).body, /Tienes un saldo pendiente/);
});

test("pagoDelMesDeFactura nunca lanza: si la lectura falla, null (el aviso de siempre)", async () => {
  const db = { $queryRaw: async () => { throw new Error("boom"); } };
  assert.equal(await pagoDelMesDeFactura(db, { clinicId: "c", invoiceId: "i", total: 30000, paid: 0 }), null);
  assert.equal(await pagoDelMesDeFactura(db, { clinicId: "", invoiceId: "i", total: 30000, paid: 0 }), null);
});

test("la ruta y la tarjeta de Sabina usan el MISMO cálculo (la tarjeta enseña el texto exacto)", () => {
  assert.match(leer("app/api/invoices/[id]/send-whatsapp/route.ts"), /const pagoDelMes = esFactura \? null : await pagoDelMesDeFactura\(prisma,/);
  assert.match(leer("lib/sabina/dinero/avisar-saldo.ts"), /pagoDelMes: await pagoDelMesDeFactura\(db,/);
});
