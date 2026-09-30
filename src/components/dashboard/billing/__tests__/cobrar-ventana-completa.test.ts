// ws1-t4 — «Cobrar» SIEMPRE abre la ventana completa de la factura, y «Editar»
// abre el editor de la factura.
//
// Rafael: desde la agenda, «Cobrar» abría la ventana de cobro suelta
// (`PaymentModal`: «muy básico»); desde Facturación, la completa
// (`InvoiceDetailModal`). Siempre debe abrir la completa, con el pago ya
// abierto y el MISMO monto sugerido de antes. Y «Editar» de una factura solo
// abría el detalle: debe abrir el editor.
//
// Dos partes: la lógica pura (monto, cuándo abrir el cobro clásico, qué se
// edita) y candados de CABLEADO sobre cada camino, como `monto-cobro-h68`.
//
// Correr: npm run test:cobrar-ventana-completa

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  abrirCobroClasicoAlAbrir, montoDelCobroAlAbrir, nombreDelPacienteDeFactura,
} from "../cobrar-en-factura-core";
import { montoInicialDeCobro } from "../monto-inicial-cobro";
import {
  conceptosParaEditar, cuerpoDeEdicion, facturaEditableEnEditor,
} from "../../../billing/editar-factura";

const RAIZ = join(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ═══════════════════════════════════════════════════════════════════════════
// Lógica pura
// ═══════════════════════════════════════════════════════════════════════════

test("monto: manda el de quien abre si vale algo; sin él (o con 0), el cálculo de la factura", () => {
  assert.equal(montoDelCobroAlAbrir(2000, 38000), 2000, "la cuota vencida del caso");
  // ws1-t10: la fila aún sin condiciones manda 0; eso NO manda sobre lo que la ventana lee sola.
  assert.equal(montoDelCobroAlAbrir(0, 3000), 3000, "0 de quien abre = no supo: manda el enganche que calcula la ventana");
  assert.equal(montoDelCobroAlAbrir(0, 0), 0, "sin plan, ninguno sabe: sigue el saldo (montoInicialDeCobro)");
  assert.equal(montoDelCobroAlAbrir(undefined, 2000), 2000);
  assert.equal(montoDelCobroAlAbrir(null, 1500), 1500);
  assert.equal(montoDelCobroAlAbrir(Number.NaN, 1500), 1500, "un NaN no pisa el cálculo propio");
});

test("monto: el campo nace igual que en la ventana suelta (clampeado al saldo)", () => {
  // La captura de Rafael: PRUEBA-ORTO-0003, saldo $18,000, cuota 7 vencida $2,000.
  assert.equal(montoInicialDeCobro(montoDelCobroAlAbrir(2000, 0), 18000), 2000);
  // «Cobrar a los dos»: la mensualidad del hermano, nunca por encima del saldo.
  assert.equal(montoInicialDeCobro(montoDelCobroAlAbrir(2500, 0), 1200), 1200);
  // ws1-t10 (B): la factura del caso recién abierto (total $18,000, enganche $3,000 que vence hoy) con la
  // fila sin condiciones (0): nace en el enganche que calcula la ventana, no en el total.
  assert.equal(montoInicialDeCobro(montoDelCobroAlAbrir(0, 3000), 18000), 3000);
  // Sin plan a plazos: el saldo completo, como siempre.
  assert.equal(montoInicialDeCobro(montoDelCobroAlAbrir(0, 0), 950.5), 950.5);
});

test("sin diseño nuevo: el cobro clásico se abre encima SOLO con permiso y en una factura cobrable", () => {
  const base = { abrirCobro: true, rediseno: false, puedeCobrar: true, citaCanceladaConDinero: false, status: "PARTIAL" };
  assert.equal(abrirCobroClasicoAlAbrir(base), true);
  assert.equal(abrirCobroClasicoAlAbrir({ ...base, puedeCobrar: false }), false, "sin permiso de cobro no hay cobrar");
  assert.equal(abrirCobroClasicoAlAbrir({ ...base, rediseno: true }), false, "con el diseño nuevo el pago ya está dentro");
  assert.equal(abrirCobroClasicoAlAbrir({ ...base, abrirCobro: false }), false, "clic en la fila: solo el detalle");
  assert.equal(abrirCobroClasicoAlAbrir({ ...base, citaCanceladaConDinero: true }), false, "H15: cita cancelada con dinero");
  for (const status of ["PENDING", "PARTIAL", "OVERDUE"]) assert.equal(abrirCobroClasicoAlAbrir({ ...base, status }), true, status);
  for (const status of ["DRAFT", "PAID", "CANCELLED", "", null]) assert.equal(abrirCobroClasicoAlAbrir({ ...base, status }), false, String(status));
});

test("nombre del paciente de la factura", () => {
  assert.equal(nombreDelPacienteDeFactura({ patient: { firstName: "Camila", lastName: "Torres" } }), "Camila Torres");
  assert.equal(nombreDelPacienteDeFactura({ patient: null }), "");
  assert.equal(nombreDelPacienteDeFactura(null), "");
});

// ═══════════════════════════════════════════════════════════════════════════
// La ventana completa: permiso, caja cerrada, cobro abierto
// ═══════════════════════════════════════════════════════════════════════════

const DETALLE = "src/components/dashboard/billing/invoice-detail-modal.tsx";

test("ventana completa: sin permiso de cobro no hay «Registrar pago» ni sección de cobro", () => {
  const d = leer(DETALLE);
  assert.match(d, /const \[puedeCobrar, setPuedeCobrar\] = useState\(false\);/, "el permiso arranca en false");
  assert.match(d, /const cobrable = rediseno && puedeCobrar && !citaCanceladaConDinero/, "la sección de cobro exige el permiso");
  assert.match(d, /const botonRegistrarPago = !puedeCobrar \|\| citaCanceladaConDinero \|\| cobroPorMercadoPago \? null/);
  assert.match(d, /abrirCobroClasicoAlAbrir\(\{ abrirCobro, rediseno, puedeCobrar, citaCanceladaConDinero, status: invoice\.status \}\)/);
});

test("ventana completa: el cobro usa el freno de caja cerrada (dentro y en la clásica)", () => {
  assert.match(leer("src/components/dashboard/factura-un-popup/use-cobro.ts"), /useFrenoCajaCerrada\(abierta, method === "cash"\)/);
  assert.match(leer("src/components/dashboard/factura-un-popup/seccion-cobro.tsx"), /<AvisoCajaCerrada/);
  assert.match(leer("src/components/dashboard/billing/payment-modal.tsx"), /useFrenoCajaCerrada\(open, method === "cash"\)/);
});

test("ventana completa: el monto de quien abre llega al cobro de dentro y al clásico", () => {
  const d = leer(DETALLE);
  assert.match(d, /const montoSugerido = montoDelCobroAlAbrir\(\s*montoSugeridoDeQuienAbre,/);
  assert.match(d, /const cobro = useCobro\(\{[\s\S]*?montoSugerido,\s*\}\);/);
  assert.match(d, /<PaymentModal[\s\S]*?montoSugerido=\{montoSugerido\}/);
  // El cobro encadenado de hermanos: tras pagar, `onCobrado` en vez de cerrar.
  assert.match(d, /if \(onCobrado\) onCobrado\(\); else onClose\(\);/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Cada camino de «Cobrar»
// ═══════════════════════════════════════════════════════════════════════════

function ts(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "__tests__" && n !== "node_modules" && !n.startsWith("vista-previa")) ts(p, acc); }
    else if (/\.tsx$/.test(n)) acc.push(p);
  }
  return acc;
}

test("nadie monta la ventana de cobro suelta salvo la propia ventana completa (su camino sin diseño nuevo)", () => {
  const con = ts(join(RAIZ, "src"))
    .filter((f) => /<PaymentModal\b/.test(sinComentarios(readFileSync(f, "utf8"))))
    .map((f) => f.slice(RAIZ.length + 1));
  assert.deepEqual(con, [DETALLE]);
});

const CAMINOS_ENVOLTORIO: { nombre: string; archivo: string; monto: RegExp }[] = [
  {
    nombre: "recuadro de cobranza de ortodoncia (agenda y ficha)",
    archivo: "src/components/specialties/orthodontics/cobranza/ResumenCobranza.tsx",
    monto: /montoSugerido=\{montoSugerido\}/,
  },
  {
    nombre: "mensualidades de Caja / Cobranza de ortodoncia («Cobrar a los dos»)",
    archivo: "src/components/specialties/orthodontics/cobranza/ListaMensualidades.tsx",
    monto: /montoSugerido=\{cobrandoCola\[0\]\.monto\}/,
  },
];

for (const c of CAMINOS_ENVOLTORIO) {
  test(`«${c.nombre}» abre la ventana completa con el monto de siempre`, () => {
    const src = leer(c.archivo);
    assert.match(src, /<CobrarEnFactura\b/);
    assert.match(src, c.monto);
    assert.match(src, /clinicTaxMode=\{/, "sin el régimen fiscal, el CFDI de la ventana se precargaría mal");
  });
}

test("Sección F del caso: «Cobrar» (lo vencido o la cuota) y «Cobrar» de cada control", () => {
  const src = leer("src/components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.equal((src.match(/<CobrarEnFactura\b/g) ?? []).length, 2);
  assert.match(src, /invoiceId=\{controlACobrar\.invoiceId\}[\s\S]*?montoSugerido=\{controlACobrar\.balance\}/);
  assert.match(src, /invoiceId=\{idFacturaACobrar\}[\s\S]*?montoSugerido=\{montoCobrarSugerido\}/);
});

test("el envoltorio abre la ventana completa con el pago abierto y refresca al cerrar", () => {
  const src = leer("src/components/dashboard/billing/cobrar-en-factura.tsx");
  assert.match(src, /fetch\(`\/api\/invoices\/\$\{encodeURIComponent\(invoiceId\)\}`\)/, "la factura sale del GET con clinicId de sesión");
  assert.match(src, /<InvoiceDetailModal[\s\S]*?abrirCobro[\s\S]*?montoSugerido=\{montoSugerido\}/);
  assert.match(src, /onClose=\{\(\) => \{ onClose\(\); onRefrescar\(\); \}\}/, "al cerrar, la pantalla de origen se refresca");
});

test("Caja / Facturación: «Registrar pago» de la fila abre la completa con el pago abierto", () => {
  const src = leer("src/app/dashboard/billing/billing-client.tsx");
  assert.match(src, /abrirCobro=\{cobroMontoSugerido !== null\}/);
  assert.match(src, /onAbrir=\{\(inv\) => \{ setCobroMontoSugerido\(null\); setDetailInvoice\(inv\); \}\}/, "clic en la ficha: sin cobro");
});

test("ficha del paciente: «Cobrar», «Cobrar ahora» y la fila abren la completa con el pago abierto", () => {
  const src = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(src, /setCobroMontoSugerido\(montoSugeridoDeCobro\(condicionesFinal \?\? null, inv\.total, inv\.paid, todayLocalISO\(\)\)\);\s*setInvoiceDetailAction\(null\);\s*setInvoiceDetailOpen\(inv\);/);
  assert.match(src, /abrirCobro=\{cobroMontoSugerido !== null\}/);
  assert.match(src, /onClose=\{\(\) => \{ setInvoiceDetailOpen\(null\); setInvoiceDetailAction\(null\); setCobroMontoSugerido\(null\); \}\}/);
});

test("agenda (vieja y nueva): «Cobrar» abre la completa con el pago abierto", () => {
  assert.match(leer("src/components/dashboard/agenda/agenda-detail-panel.tsx"), /<InvoiceDetailModal[\s\S]*?abrirCobro\s/);
  assert.match(leer("src/components/dashboard/agenda-nueva/panel-cita.tsx"), /<InvoiceDetailModal[\s\S]*?abrirCobro\s/);
});

test("sin permiso de cobro (billing.charge) los botones de cobro de ortodoncia no salen", () => {
  // ws1-t4 (revisión final, fallo 1): la factura y el monto salen de `cobroPrincipalDelCaso`, como en la Sección F.
  assert.match(leer("src/components/specialties/orthodontics/cobranza/ResumenCobranza.tsx"), /\{panel\.puedeCobrar && puedeOfrecerCobro \? \(/);
  const f = leer("src/components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.equal((f.match(/\{panel\.puedeCobrar \? \(/g) ?? []).length, 2, "«Cobrar» y «Cobrar» del control");
  assert.match(leer("src/components/specialties/orthodontics/cobranza/ListaMensualidades.tsx"), /\{puedeCobrar && \(\s*<ButtonNew/);
  for (const a of ["src/app/actions/orthodontics/cobro/cargarPanelDeCobro.ts", "src/app/actions/orthodontics/recepcion/listarMensualidadesPorCobrar.ts"]) {
    assert.match(leer(a), /puedeCobrar: hasPermission\(|const puedeCobrar = hasPermission\(/, a);
    assert.match(leer(a), /"billing\.charge"\)/, a);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// «Editar» abre el editor
// ═══════════════════════════════════════════════════════════════════════════

test("qué se edita (decisión de Rafael): todo lo que no esté timbrado ni cancelado, con o sin pagos", () => {
  assert.equal(facturaEditableEnEditor({ status: "DRAFT", paid: 0 }), true);
  for (const status of ["PENDING", "PARTIAL", "PAID", "OVERDUE"]) {
    assert.equal(facturaEditableEnEditor({ status, paid: 500 }), true, `${status} con pagos`);
  }
  assert.equal(facturaEditableEnEditor({ status: "PARTIAL", paid: 500, cfdiUuid: "X" }), false, "timbrada");
  assert.equal(facturaEditableEnEditor({ status: "CANCELLED", paid: 0 }), false, "cancelada");
  assert.equal(facturaEditableEnEditor(null), false);
});

test("el editor carga los conceptos guardados y conserva sus campos extra", () => {
  const c = conceptosParaEditar([
    { code: "01010101", description: "Resina", toothNumber: 16, surface: "O", quantity: 2, unitPrice: 800, total: 1600 },
    { description: "Limpieza", quantity: 1, total: 500 },
    { description: "  ", quantity: 1, unitPrice: 10 },
  ]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { name: "Resina", quantity: 2, unitPrice: 800, discount: 0, extra: { code: "01010101", toothNumber: 16, surface: "O" } });
  assert.equal(c[1].unitPrice, 500, "factura vieja sin unitPrice: importe / cantidad");
  assert.deepEqual(conceptosParaEditar(null), []);
});

test("el cuerpo del PATCH: conceptos (con sus extra), descuento y notas", () => {
  const b = cuerpoDeEdicion({
    lineas: [
      { name: " Resina ", quantity: 2, unitPrice: 800, discount: 100, lineTotal: 1500, extra: { code: "01010101", toothNumber: 16 } },
      { name: "Limpieza", quantity: 1, unitPrice: 500, discount: 0, lineTotal: 500 },
    ],
    descuento: 200.004,
    notas: "  ",
  });
  assert.deepEqual(b, {
    items: [
      { code: "01010101", toothNumber: 16, description: "Resina", quantity: 2, unitPrice: 800, discount: 100, total: 1500 },
      { description: "Limpieza", quantity: 1, unitPrice: 500, total: 500 },
    ],
    discount: 200,
    notes: null,
  });
});

test("editor: al editar guarda por PATCH y no ofrece lo que ese PATCH no guarda", () => {
  const m = leer("src/components/billing/invoice-editor-modal.tsx");
  assert.match(m, /fetch\(`\/api\/invoices\/\$\{encodeURIComponent\(editar\.id\)\}`, \{\s*method: "PATCH"/);
  assert.match(m, /if \(editando\) \{ await guardarEdicion\(\); return; \}/, "editar nunca crea otra factura");
  assert.match(m, /disabled=\{editando\}/, "los impuestos no se cambian al editar");
  assert.match(m, /\{!editando && \(\s*<div className=\{rediseno \? c\.campo : undefined\}>\s*<label[^>]*>\{t\("billing\.invoiceEditor\.doctor"\)\}/);
  assert.match(m, /\{!editando && \(\s*<div className=\{rediseno \? c\.campo : undefined\}>\s*<label[^>]*>\{t\("billing\.invoiceEditor\.dueDate"\)\}/);
});

test("«Editar» (tarjeta de Caja y del expediente, y la ventana completa) abre el editor; lo demás «Ver factura»", () => {
  const ficha = leer("src/components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
  assert.match(ficha, /onEditar=\{onEditar && puedeEditar && facturaEditableEnEditor\(inv\) \? \(\) => onEditar\(inv\) : null\}/);
  const caja = leer("src/app/dashboard/billing/billing-client.tsx");
  assert.match(caja, /onEditar=\{\(inv\) => setEditando\(inv\)\}\s*puedeEditar=\{puedeEditarFacturas\}/);
  assert.match(caja, /<InvoiceEditorModal[\s\S]*?editar=\{editando\}/);
  assert.match(leer("src/app/dashboard/caja/page.tsx"), /puedeEditarFacturas: hasPermission\([^)]*\)?[^\n]*"billing\.edit"\)/);
  const exp = leer("src/components/dashboard/expediente-rediseno/facturacion.tsx");
  assert.match(exp, /onEditar=\{onEditar\}\s*puedeEditar=\{permisosCobro\?\.editar !== false\}/);
  const pac = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(pac, /onEditar=\{\(inv\) => setEditandoFactura\(inv\)\}/);
  assert.match(pac, /<InvoiceEditorModal[\s\S]*?editar=\{editandoFactura\}/);
  assert.match(leer("src/app/dashboard/patients/[id]/page.tsx"), /editar: hasPermission\([^\n]*"billing\.edit"\)/);
  const d = leer(DETALLE);
  // En borrador (junto a «Editar precio») y en pendiente/parcial/pagada.
  assert.equal((d.match(/onEditar && puedeEditar && facturaEditableEnEditor\(\{ \.\.\.invoice, cfdiUuid: effectiveUuid \}\) && \(/g) ?? []).length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// Revisión panel.108 (fallo 3): «Cobrar» que solo navegaba
// ═══════════════════════════════════════════════════════════════════════════

import { accionDeCobrarCabecera, cobroPrincipalDelCaso, montoDelCobroPrincipal } from "../../../../lib/orthodontics/cobro/cobro-principal";

test("cobro principal del caso: factura y monto (la regla de «Cobrar · $X»)", () => {
  const plazos = {
    billingMode: "PRECIO_TOTAL",
    invoice: { id: "inv-caso", balance: 18000 },
    cobranza: { vencidas: [{ falta: 2000 }], cuotaDeHoy: { falta: 2000 } },
  };
  assert.deepEqual(cobroPrincipalDelCaso(plazos), { invoiceId: "inv-caso", montoSugerido: 2000 });
  assert.equal(montoDelCobroPrincipal({ ...plazos, cobranza: { vencidas: [{ falta: 2000 }, { falta: 1500 }] } }), 3500, "TODO lo vencido");
  assert.equal(montoDelCobroPrincipal({ ...plazos, cobranza: { vencidas: [], cuotaDeHoy: { falta: 1000 } } }), 1000, "si no, la cuota de hoy");
  assert.equal(montoDelCobroPrincipal({ ...plazos, cobranza: null }), 0, "sin plan: el saldo (0 = que lo decida la ventana)");
  assert.equal(cobroPrincipalDelCaso({ ...plazos, invoice: null }), null, "sin factura no hay a qué cobrar");
  // Pago por control: el primer control que se debe; la colocación solo si aún debe.
  const porControl = { billingMode: "PAGO_POR_CONTROL", invoice: { id: "coloc", balance: 0 }, cobranza: null };
  assert.deepEqual(cobroPrincipalDelCaso({ ...porControl, controlesPorCobrar: [{ invoiceId: "ctl-1", balance: 900 }, { invoiceId: "ctl-2", balance: 900 }] }), { invoiceId: "ctl-1", montoSugerido: 900 });
  assert.equal(cobroPrincipalDelCaso({ ...porControl, controlesPorCobrar: [] }), null, "colocación pagada: nada");
  assert.deepEqual(cobroPrincipalDelCaso({ ...porControl, invoice: { id: "coloc", balance: 5000 }, controlesPorCobrar: [] }), { invoiceId: "coloc", montoSugerido: 0 });
});

test("la Sección F y la cabecera de Ortodoncia usan la MISMA regla", () => {
  const f = leer("src/components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.match(f, /const cobroPrincipal = cobroPrincipalDelCaso\(panel\);/);
  assert.match(f, /const montoCobrarSugerido = montoDelCobroPrincipal\(panel\);/);
  const c = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(c, /const cobroDeCabecera = panelListo\?\.puedeCobrar \? cobroPrincipalDelCaso\(panelListo\) : null;/);
  assert.match(c, /onCollect=\{onCollectCabecera\}/);
  assert.match(c, /const onCollectCabecera = !irAFacturacion \|\| accionCobrar === "oculto" \? undefined : pulsarCobrarCabecera;/, "sin permiso de cobro no hay «Cobrar» en la cabecera");
  assert.match(c, /<CobrarEnFactura\s+invoiceId=\{cobrandoDesdeCabecera\.invoiceId\}\s+montoSugerido=\{cobrandoDesdeCabecera\.montoSugerido\}/);
});

test("`?charge=1` (barra del paciente, fin de consulta, paleta) abre el cobro en vez de solo caer en la ficha", () => {
  for (const [archivo, patron] of [
    ["src/components/dashboard/patient-context-bar.tsx", /\?charge=1/],
    ["src/components/dashboard/patient-context-end-modal.tsx", /\?charge=1/],
    ["src/lib/command-palette/actions.ts", /\?charge=1/],
  ] as const) assert.match(leer(archivo), patron, archivo);
  const pac = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(pac, /const cobroPedidoPorUrl = searchParams\.get\("charge"\) === "1";/);
  assert.match(pac, /if \(permisosCobro\?\.cobrar === false\) \{ openBillingTab\(\); return; \}\s*openChargeShortcut\(\);/);
  assert.match(pac, /window\.history\.replaceState\(null, ""/, "el parámetro se quita para que un refresh no vuelva a abrirlo");
});

// ═══════════════════════════════════════════════════════════════════════════
// Editar con pagos (decisión de Rafael, 29-sep-2026)
// ═══════════════════════════════════════════════════════════════════════════

import {
  avisoDePlan, decidirEdicion, estadoTrasEditar, motivoParaNoEditar, CODIGO_PLAN_SE_RECALCULA,
} from "../../../../lib/invoices/editar-factura-core";
import { condicionesPorDefecto, type CondicionesPago } from "../../../../lib/quotes/condiciones-pago";

const plazos: CondicionesPago = { ...condicionesPorDefecto(), modo: "plazos", enganche: 8000, numPagos: 15, primerPago: "2026-02-27" };

test("(a) nunca timbrada ni cancelada", () => {
  assert.match(motivoParaNoEditar({ status: "PARTIAL", paid: 1, total: 2, cfdiUuid: "UUID" }) ?? "", /timbrada/);
  assert.match(motivoParaNoEditar({ status: "CANCELLED", paid: 0, total: 2 }) ?? "", /cancelada/);
  assert.equal(motivoParaNoEditar({ status: "PAID", paid: 2, total: 2 }), null);
  const d = decidirEdicion({ factura: { status: "PARTIAL", paid: 100, total: 500, cfdiUuid: "U" }, totalNuevo: 600, condiciones: null, planAvisado: true });
  assert.equal(d.ok, false);
});

test("(b) el total nunca por debajo de lo pagado (saldo a favor incluido), con mensaje claro", () => {
  const f = { status: "PARTIAL", paid: 20000, total: 38000 };
  const d = decidirEdicion({ factura: f, totalNuevo: 19999.99, condiciones: null, planAvisado: false });
  assert.equal(d.ok, false);
  if ("error" in d) {
    assert.equal(d.httpStatus, 400);
    assert.equal(d.codigo, "TOTAL_BAJO_LO_PAGADO");
    assert.match(d.error, /no puede quedar por debajo de lo ya pagado \(\$20,000\.00, incluido el saldo a favor aplicado\)/);
  }
  // Justo lo pagado: queda PAGADA (y se marca liquidada para fijar paidAt).
  const igual = decidirEdicion({ factura: f, totalNuevo: 20000, condiciones: null, planAvisado: false });
  assert.deepEqual(igual, { ok: true, status: "PAID", balance: 0, reabre: false, liquida: true });
  // Una PAGADA a la que se le sube el total se reabre como parcial.
  assert.deepEqual(
    decidirEdicion({ factura: { status: "PAID", paid: 1000, total: 1000 }, totalNuevo: 1200, condiciones: null, planAvisado: false }),
    { ok: true, status: "PARTIAL", balance: 200, reabre: true, liquida: false },
  );
  // Un borrador sigue borrador.
  assert.equal(estadoTrasEditar("DRAFT", 0, 900).status, "DRAFT");
  assert.equal(estadoTrasEditar("PENDING", 0, 900).status, "PENDING");
});

test("(c) con plan a plazos, cambiar el total avisa (409) y dice cuánto queda cada mensualidad", () => {
  const f = { status: "PARTIAL", paid: 20000, total: 38000 };
  const sinAviso = decidirEdicion({ factura: f, totalNuevo: 41000, condiciones: plazos, planAvisado: false });
  assert.equal(sinAviso.ok, false);
  if ("error" in sinAviso) {
    assert.equal(sinAviso.httpStatus, 409);
    assert.equal(sinAviso.codigo, CODIGO_PLAN_SE_RECALCULA);
    assert.match(sinAviso.error, /a plazos \(enganche de \$8,000\.00 \+ 15 pagos\)/);
    assert.match(sinAviso.error, /de \$2,000\.00 a \$2,200\.00; el enganche no cambia/);
  }
  const avisado = decidirEdicion({ factura: f, totalNuevo: 41000, condiciones: plazos, planAvisado: true });
  assert.equal(avisado.ok, true);
  // Mismo total (solo notas o un concepto que suma igual): nada que avisar.
  assert.equal(avisoDePlan(plazos, 38000, 38000), null);
  assert.equal(avisoDePlan({ ...plazos, modo: "unico" }, 38000, 41000), null, "sin plazos no hay plan");
  // Un total que ya no da para el plan acordado: se dice, no se esconde.
  const roto = avisoDePlan(plazos, 38000, 8000);
  assert.equal(roto?.descuadre, "engancheCubreTodo");
  assert.match(roto?.texto ?? "", /ajusta la forma de pago/);
});

test("el PATCH corre la regla y la repite en el MISMO UPDATE; (d) deja rastro antes/después", () => {
  const ruta = leer("src/app/api/invoices/[id]/route.ts");
  assert.match(ruta, /const no = motivoParaNoEditar\(invoice\);/);
  assert.match(ruta, /const decision = decidirEdicion\(\{[\s\S]*?planAvisado: body\.planAvisado === true,/);
  assert.match(ruta, /cfdiUuid: null,\s*status: invoice\.status,\s*NOT: \{ status: "CANCELLED" as const \},\s*paid: \{ equals: invoice\.paid, lte: updateData\.total \},/);
  assert.doesNotMatch(ruta, /Solo se pueden editar facturas en borrador/);
  assert.match(ruta, /patientId: invoice\.patientId,\s*texto: body\.items/, "movimiento del paciente con texto");
  assert.match(ruta, /items: invoice\.items, subtotal: invoice\.subtotal, discount: invoice\.discount, balance: invoice\.balance, paid: invoice\.paid/, "el antes completo");
  assert.match(ruta, /if \(body\.items\) \{\s*await cerrarLinksDeFactura/, "los links de pago del saldo viejo se cierran");
});

test("el editor dice lo mismo antes de mandar: piso de lo pagado y aviso del plan", () => {
  const m = leer("src/components/billing/invoice-editor-modal.tsx");
  assert.match(m, /const avisoPlan = editar \? avisoDePlan\(condicionesEdicion, Number\(editar\.total \?\? 0\), grandTotal\) : null;/);
  assert.match(m, /disabled=\{saving \|\| bajoLoPagado\}/);
  assert.match(m, /\.\.\.\(avisoPlan \|\| avisoPlanServidor \? \{ planAvisado: true \} : \{\}\)/);
  assert.match(m, /res\.status === 409 && out\?\.code === CODIGO_PLAN_SE_RECALCULA/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Segunda pasada panel.108 (fallo A): «Cobrar» de la cabecera antes de que cargue
// ═══════════════════════════════════════════════════════════════════════════

test("«Cobrar» de la cabecera: cargando espera, error reintenta, nunca cae en Facturación por llegar temprano", () => {
  assert.equal(accionDeCobrarCabecera("cargando", false), "esperar");
  assert.equal(accionDeCobrarCabecera("error", false), "reintentar");
  assert.equal(accionDeCobrarCabecera({ puedeCobrar: true }, true), "abrir");
  assert.equal(accionDeCobrarCabecera({ puedeCobrar: true }, false), "facturacion", "sin factura que cobrar: a crearla");
  assert.equal(accionDeCobrarCabecera({ puedeCobrar: false }, true), "oculto");
  assert.equal(accionDeCobrarCabecera(null, false), "facturacion", "sin caso");
});

test("la cabecera espera la carga, dice que carga y abre sola al llegar", () => {
  const c = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(c, /else if \(accionCobrar === "esperar"\) setCobroPendiente\(true\);/);
  assert.match(c, /else if \(accionCobrar === "reintentar"\) \{ setCobroPendiente\(true\); recargarPanelDeCobro\(\); \}/);
  assert.match(c, /if \(!cobroPendiente \|\| panelDeCobro === "cargando"\) return;\s*setCobroPendiente\(false\);\s*if \(accionCobrar === "abrir"\) abrirCobroDeCabecera\(\);/);
  assert.match(c, /collectCargando=\{cobroPendiente \|\| abriendoVentanaDeCobro\}/);
  assert.match(c, /onLista=\{\(\) => setAbriendoVentanaDeCobro\(false\)\}/);
  // El cobro del caso se pide al entrar a la pestaña, no al abrir la sección «Cobro».
  assert.match(c, /useEffect\(\(\) => \{ recargarPanelDeCobro\(\); \}, \[recargarPanelDeCobro\]\);/);
  const h = leer("src/components/specialties/orthodontics/redesign/PatientHeaderG16.tsx");
  assert.match(h, /disabled=\{props\.collectCargando\}/);
  assert.match(h, /\{props\.collectCargando \? "Cargando cobro…" : "Cobrar"\}/);
  assert.match(leer("src/components/dashboard/billing/cobrar-en-factura.tsx"), /setFactura\(d\); onLista\?\.\(\);/);
});
