// ws1-t10 (H68) — «Cuatro de seis "Cobrar" proponen todo el saldo».
//
// Candado de CABLEADO (como `factura-un-popup.test.ts` y la prueba de
// «montaje» de `plan-de-pagos.test.ts`): lee el código fuente de los cuatro
// sitios que abrían `PaymentModal`/el cobro inline SIN `montoSugerido` (el
// campo nacía en el saldo COMPLETO del tratamiento en vez de la mensualidad
// o lo vencido) y comprueba que ahora sí lo calculan y lo pasan.
//
// La ARITMÉTICA de `montoSugeridoDeCobro` la prueba
// `src/lib/invoices/__tests__/plan-de-pagos.test.ts`; aquí solo se vigila que
// cada pantalla la llame antes de abrir el cobro.
//
// Correr: npm run test:monto-cobro-h68

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("recuadro de ortodoncia (ficha y panel de la cita): ResumenCobranza pasa montoSugerido", () => {
  const src = leer("components/specialties/orthodontics/cobranza/ResumenCobranza.tsx");
  assert.match(src, /const montoSugerido = panel\.cobranza\.vencidas\.reduce\(\(acc, q\) => acc \+ q\.falta, 0\) \|\| cuota\?\.falta \|\| 0;/);
  assert.match(src, /<PaymentModal[\s\S]*?montoSugerido=\{montoSugerido\}/);
});

test("fila de factura (Caja y expediente): FichasFactura manda las condiciones ya cargadas a onCobrar", () => {
  const src = leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
  assert.match(src, /onCobrar: \(inv: F, condiciones: CondicionesPago \| null\) => void;/);
  assert.match(src, /onCobrar=\{\(\) => onCobrar\(inv, extras\.condiciones\[inv\.id\] \?\? inv\.condicionesPago \?\? null\)\}/);
});

test("Facturación general (Caja): calcula montoSugerido con las condiciones de la fila y con la tabla vieja", () => {
  const src = leer("app/dashboard/billing/billing-client.tsx");
  assert.match(src, /onCobrar=\{\(inv, condiciones\) => \{\s*setPaymentMontoSugerido\(montoSugeridoDeCobro\(condiciones, inv\.total, inv\.paid, todayLocalISO\(\)\)\);/);
  assert.match(src, /async function openPaymentForRow\(e: React\.MouseEvent, inv: any\) \{/, "la tabla vieja (sin menu-dos-niveles) espera las condiciones ANTES de abrir el modal");
  assert.match(src, /\.then\(\(d\) => d\?\.condiciones\?\.\[inv\.id\] \?\? null\)/);
  assert.match(src, /setPaymentMontoSugerido\(montoSugeridoDeCobro\(condiciones, inv\.total, inv\.paid, todayLocalISO\(\)\)\);\s*setPaymentInvoice/, "también lo calcula, ANTES de abrir el modal (PaymentModal no reacciona a montoSugerido tras abrirse)");
  assert.match(src, /<PaymentModal[\s\S]*?montoSugerido=\{paymentMontoSugerido\}/);
});

test("Facturación del expediente (fila de factura del paciente): openDirectPayment calcula y propaga montoSugerido", () => {
  const src = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(src, /const openDirectPayment = async \(inv: any, condiciones\?: CondicionesPago \| null\) => \{/);
  assert.match(src, /setDirectPayMontoSugerido\(montoSugeridoDeCobro\(condicionesFinal \?\? null, inv\.total, inv\.paid, todayLocalISO\(\)\)\);/);
  assert.match(src, /onCobrar=\{\(inv, condiciones\) => \{ void openDirectPayment\(inv, condiciones\); \}\}/);
  assert.match(src, /<PaymentModal[\s\S]*?montoSugerido=\{directPayMontoSugerido\}/);
  // Sin condiciones (el atajo "Cobrar ahora" de HeroCard/SideCards) se leen
  // con la misma ruta de solo lectura que ya usa la ficha de factura — nunca
  // se abre el modal a ciegas con el saldo completo por no tener el dato.
  assert.match(src, /fetch\(`\/api\/invoices\/condiciones\?ids=\$\{encodeURIComponent\(inv\.id\)\}`\)/);
});

// ws1-t4 #69 — «Marcar pagada» liquidaba de un clic una factura a plazos entera.
test("detalle de factura: «Marcar pagada» no se ofrece en una factura a plazos", () => {
  const src = leer("components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(src, /\{!esPlanAPlazos\(condicionesPago\) && \(\s*<ButtonNew[\s\S]{0,120}onClick=\{handleMarkPaid\}/);
});
