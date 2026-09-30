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
  // ws1-t4 (revisión final): la MISMA regla que la Sección F y la cabecera (`montoDelCobroPrincipal`:
  // lo vencido, si no la cuota de hoy; en «Pago por control», el control que se debe).
  assert.match(src, /const cobro = cobroPrincipalDelCaso\(panel\);\s*const montoSugerido = cobro\?\.montoSugerido \?\? 0;/);
  // ws1-t4: ya no la ventana suelta, la completa — con el MISMO monto.
  assert.match(src, /<CobrarEnFactura[\s\S]*?montoSugerido=\{montoSugerido\}/);
});

test("fila de factura (Caja y expediente): FichasFactura manda las condiciones ya cargadas a onCobrar", () => {
  const src = leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
  assert.match(src, /onCobrar: \(inv: F, condiciones: CondicionesPago \| null\) => void;/);
  assert.match(src, /onCobrar=\{\(\) => onCobrar\(inv, extras\.condiciones\[inv\.id\] \?\? inv\.condicionesPago \?\? null\)\}/);
});

test("Facturación general (Caja): calcula montoSugerido con las condiciones de la fila y con la tabla vieja", () => {
  const src = leer("app/dashboard/billing/billing-client.tsx");
  // ws1-t4: los dos caminos abren la ventana COMPLETA con el pago abierto y
  // el monto calculado ANTES de abrirla.
  assert.match(src, /onCobrar=\{\(inv, condiciones\) => abrirCobroDeFila\(inv, condiciones\)\}/);
  assert.match(src, /async function openPaymentForRow\(e: React\.MouseEvent, inv: any\) \{/, "la tabla vieja (sin menu-dos-niveles) espera las condiciones ANTES de abrir el modal");
  assert.match(src, /\.then\(\(d\) => d\?\.condiciones\?\.\[inv\.id\] \?\? null\)/);
  assert.match(src, /setCobroMontoSugerido\(montoSugeridoDeCobro\(condiciones, inv\.total, inv\.paid, todayLocalISO\(\)\)\);\s*setDetailInvoice\(inv\);/, "lo calcula ANTES de abrir la ventana");
  assert.match(src, /<InvoiceDetailModal[\s\S]*?abrirCobro=\{cobroMontoSugerido !== null\}[\s\S]*?montoSugerido=\{cobroMontoSugerido \?\? undefined\}/);
});

test("Facturación del expediente (fila de factura del paciente): openDirectPayment calcula y propaga montoSugerido", () => {
  const src = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(src, /const openDirectPayment = async \(inv: any, condiciones\?: CondicionesPago \| null\) => \{/);
  assert.match(src, /setCobroMontoSugerido\(montoSugeridoDeCobro\(condicionesFinal \?\? null, inv\.total, inv\.paid, todayLocalISO\(\)\)\);/);
  assert.match(src, /onCobrar=\{\(inv, condiciones\) => \{ void openDirectPayment\(inv, condiciones\); \}\}/);
  // ws1-t4: la ventana completa, con el pago abierto y ESE monto.
  assert.match(src, /<InvoiceDetailModal[\s\S]*?abrirCobro=\{cobroMontoSugerido !== null\}[\s\S]*?montoSugerido=\{cobroMontoSugerido \?\? undefined\}/);
  // Sin condiciones (el atajo "Cobrar ahora" de HeroCard/SideCards) se leen
  // con la misma ruta de solo lectura que ya usa la ficha de factura — nunca
  // se abre el modal a ciegas con el saldo completo por no tener el dato.
  assert.match(src, /fetch\(`\/api\/invoices\/condiciones\?ids=\$\{encodeURIComponent\(inv\.id\)\}`\)/);
});

// ws1-t4 #69 — «Marcar pagada» liquidaba de un clic una factura a plazos entera.
test("detalle de factura: «Marcar pagada» no se ofrece en una factura a plazos", () => {
  const src = leer("components/dashboard/billing/invoice-detail-modal.tsx");
  // Sigue sin ofrecerse en un plan a plazos (`!esPlanAPlazos`); además (anticipos) solo con permiso de cobrar y sin la
  // cita cancelada con dinero pendiente. Las tres condiciones tienen que estar, y en ese orden.
  assert.match(src, /\{puedeCobrar && !citaCanceladaConDinero && !esPlanAPlazos\(condicionesPago\) && \(\s*<ButtonNew[\s\S]{0,120}onClick=\{handleMarkPaid\}/);
});

// ws1-t4 #78/#79 — la ficha de finanzas no promete lo que no hace.
test("ficha de finanzas: el descuento se llama «acordado» y el recargo se cobra con «Cobrar extra»", () => {
  const src = leer("components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.doesNotMatch(src, /Descuento aplicado/);
  assert.doesNotMatch(src, /súmalo al monto/);
  assert.match(src, /Descuento acordado/);
  assert.match(src, /cóbralo con «Cobrar extra»/);
});

// ws1-t4 #85 — «Cobrar» visible sin permiso de cobrar.
test("Cobranza de ortodoncia: el botón de cobrar depende de billing.charge, no de billing.view", () => {
  const src = leer("app/dashboard/orthodontics/cobranza/page.tsx");
  assert.match(src, /const puedeCobrar = hasPermission\([\s\S]*?"billing\.charge"/);
});
