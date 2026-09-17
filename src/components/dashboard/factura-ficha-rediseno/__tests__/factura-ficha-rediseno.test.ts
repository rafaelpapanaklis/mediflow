/**
 * CANDADOS DE «FACTURACIÓN SE QUEDA CON LO BUENO DE PRESUPUESTOS» (ws1-t1).
 *
 * Run: npx tsx --test src/components/dashboard/factura-ficha-rediseno/__tests__/factura-ficha-rediseno.test.ts
 *
 * Dos clases de prueba, como en `hoy-rediseno.test.ts`:
 *  · de CABLEADO, leyendo el código fuente: que la carpeta no invente tokens ni
 *    letra de máquina, que el camino viejo siga vivo y que nada de lo nuevo
 *    toque dinero;
 *  · de COMPORTAMIENTO, sobre las piezas puras: la frase del trato, qué se
 *    puede enviar, con qué nace un duplicado y el correo que sale al paciente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  borradorDesdeFactura, fraseDeFactura, resumenConceptos,
  sePuedeEnviarPorCorreo, sePuedeEnviarPorWhatsApp,
} from "../datos";
import { buildCorreoFactura, escaparHtml } from "@/lib/invoices/correo-factura";
import { condicionesPorDefecto, frasePlan, type CondicionesPago } from "@/lib/quotes/condiciones-pago";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "factura-ficha-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));
const HOJA = archivosNuevos.find((a) => a.nombre === "ficha.module.css")!.texto;

// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

const PLAZOS: CondicionesPago = {
  ...condicionesPorDefecto(),
  modo: "plazos", metodo: "transfer", enganche: 3500, numPagos: 6,
  // El enganche se paga el 16 de septiembre; la primera mensualidad, un mes después.
  frecuencia: "MONTHLY", primerPago: "2026-09-16",
};

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje visual: Instrument Sans, tabular-nums, tokens LEÍDOS
// ═══════════════════════════════════════════════════════════════════════════
test("sin letra de máquina en la carpeta nueva", () => {
  assert.ok(archivosNuevos.length >= 5, "hoja, ficha, forma de pago, datos y extras");
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina; las cifras van con tabular-nums`);
  }
  assert.match(HOJA, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

test("la hoja no declara tokens propios ni trae hex sueltos", () => {
  const declaraciones = HOJA.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(HOJA, /var\(--m2-/, "lee los tokens del menú");
  // Un hex solo puede aparecer como RESPALDO dentro de un var(--x, #hex).
  const sinRespaldos = HOJA.replace(/var\(--[a-z0-9-]+,\s*[^)]*\)/g, "");
  assert.doesNotMatch(sinRespaldos, /#[0-9a-f]{3,8}\b/i, "un color en hex fuera de un respaldo var(--x, #hex)");
  // Y ni un hex en los .ts/.tsx de la carpeta.
  for (const a of archivosNuevos.filter((x) => !x.nombre.endsWith(".css"))) {
    assert.doesNotMatch(a.texto, /#[0-9a-f]{6}\b/i, `${a.nombre} trae un color escrito a mano`);
  }
  assert.match(leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx"), /CLASES_MENU/, "la lista monta CLASES_MENU (menu-dos-niveles/clases.ts)");
});

test("nada se esconde por ancho: la hoja no tiene ni un display:none ni un @media", () => {
  assert.doesNotMatch(HOJA, /display:\s*none/, "algo se esconde");
  assert.doesNotMatch(HOJA, /@media|@container/, "el diseño envuelve; no cambia de contenido por ancho");
  assert.match(HOJA, /\.ficha\s*\{[^}]*flex-wrap:\s*wrap/s, "la ficha envuelve");
  assert.match(HOJA, /\.fichaAcciones\s*\{[^}]*flex-wrap:\s*wrap/s, "las acciones envuelven");
});

// ═══════════════════════════════════════════════════════════════════════════
// La bandera: el camino viejo sigue vivo, y lo nuevo solo sale encendida
// ═══════════════════════════════════════════════════════════════════════════
test("Caja: la tabla de siempre sigue detrás de `rediseno ? … :` y las fichas solo con la bandera", () => {
  const caja = leer("app/dashboard/billing/billing-client.tsx");
  assert.match(caja, /\{rediseno \? \(\s*<FichasFactura/, "las fichas no están detrás del interruptor");
  assert.match(caja, /\) : \(\s*<CardNew noPad>/, "la tabla de siempre dejó de ser el camino apagado");
  for (const pieza of ['<table className="table-new">', "<InvoiceCfdiBadge", "openPaymentForRow(e, inv)", 'className="mono"']) {
    assert.ok(caja.includes(pieza), `la tabla de siempre perdió ${pieza}`);
  }
});

test("Caja conserva SUS reglas de la tabla: un borrador no se cobra desde la lista", () => {
  const caja = leer("app/dashboard/billing/billing-client.tsx");
  // La regla de la tabla de siempre…
  assert.ok(caja.includes('const canPay  = !["PAID", "CANCELLED"].includes(inv.status) && !isDraft;'), "cambió canPay: actualiza este candado");
  // …es la que reciben las fichas (la ficha sola usaría isChargeableInvoice, que incluye DRAFT).
  assert.match(caja, /puedeCobrar=\{\(inv\) => !\["PAID", "CANCELLED"\]\.includes\(inv\.status\) && inv\.status !== "DRAFT"\}/, "Caja ofrece cobrar un borrador");
  assert.match(caja, /puedeTimbrar=\{\(\) => true\}/, "Caja dejó de ofrecer Timbrar como la tabla");
});

test("mientras guarda el trato o envía, el popup no se cierra (solo diseño nuevo)", () => {
  const modal = leer("components/billing/invoice-editor-modal.tsx");
  assert.match(modal, /if \(!o && !ocupado\.current\) onClose\(\)/, "Esc o clic fuera cierran a media operación");
  assert.match(modal, /if \(rediseno && out\?\.id && \(hayCondiciones\(cond\) \|\| envio\)\) \{ ocupado\.current = true;/, "`ocupado` se enciende sin bandera");
  assert.equal((modal.match(/ocupado\.current = true/g) ?? []).length, 1, "`ocupado` solo se enciende en un sitio, detrás de `rediseno`");
  assert.equal((modal.match(/ocupado\.current = false/g) ?? []).length, 2, "`ocupado` se apaga al terminar Y si algo lanza");
});

test("sin motivo del servidor no se afirma que NO se envió", () => {
  const ficha = leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
  assert.match(ficha, /r\.error \?\? t\("facturaFicha\.envioSinConfirmar"\)/);
  const modal = leer("components/billing/invoice-editor-modal.tsx");
  assert.match(modal, /r\.error \? `\$\{t\("facturaFicha\.creadaSinEnviar"\)\} \$\{r\.error\}` : t\("facturaFicha\.creadaEnvioSinConfirmar"\)/);
});

test("expediente: BillingTab sigue siendo el camino apagado", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.ok(ficha.includes('{tab === "facturacion" && canViewBilling && !rediseno && ('), "facturación vieja");
  assert.ok(/!rediseno && \(\s*<BillingTab/.test(ficha), "el viejo sigue montando BillingTab");
  assert.ok(!leer("components/dashboard/patient-detail/billing-tab.tsx").includes("factura-ficha-rediseno"), "la pestaña de siempre no conoce las fichas");
});

test("Nueva factura: lo de Presupuestos solo se monta y solo se llama con `rediseno`", () => {
  const modal = leer("components/billing/invoice-editor-modal.tsx");
  assert.match(modal, /\{rediseno && <FormaDePagoFactura /, "la forma de pago sale sin bandera");
  assert.match(modal, /\{rediseno && \(\s*<EnvioFactura/, "el envío sale sin bandera");
  assert.match(modal, /\{rediseno && <FraseDelTrato /, "la frase del pie sale sin bandera");
  assert.match(modal, /if \(rediseno && out\?\.id && hayCondiciones\(cond\)\)/, "guardar el trato no está detrás de la bandera");
  assert.match(modal, /if \(rediseno && out\?\.id && envio\)/, "enviar al paciente no está detrás de la bandera");
  assert.match(modal, /useContactoDePaciente\(effectivePatientId, rediseno\)/, "el contacto se pide también con la bandera apagada");
});

// ═══════════════════════════════════════════════════════════════════════════
// Esto es ropa: nada de lo nuevo toca cobro, reembolso, timbrado ni cancelación
// ═══════════════════════════════════════════════════════════════════════════
test("el payload de POST /api/invoices no cambió: el trato NO viaja en él", () => {
  const modal = leer("components/billing/invoice-editor-modal.tsx");
  const payload = modal.slice(modal.indexOf("const payload: any = {"), modal.indexOf('const res = await fetch("/api/invoices"'));
  assert.ok(payload.length > 100, "no se encontró el payload");
  for (const prohibido of ["paymentMethod", "condiciones", "cond.", "envio"]) {
    assert.ok(!payload.includes(prohibido), `el payload de crear factura ahora lleva ${prohibido}`);
  }
  // Y la ruta de crear no se enteró de nada.
  const crear = leer("app/api/invoices/route.ts");
  assert.ok(!crear.includes("condiciones") && !crear.includes("payment_terms"), "POST /api/invoices conoce las condiciones");
});

test("las rutas nuevas no escriben dinero ni estado de la factura", () => {
  for (const rel of [
    "app/api/invoices/condiciones/route.ts",
    "app/api/invoices/[id]/condiciones/route.ts",
    "app/api/invoices/[id]/send-email/route.ts",
    "lib/invoices/condiciones-pago-db.ts",
  ]) {
    const texto = leer(rel);
    assert.doesNotMatch(texto, /prisma\.(invoice|payment|paymentPlan)\.(update|updateMany|create|delete|deleteMany|upsert)\b/, `${rel} escribe en facturas o pagos`);
    assert.doesNotMatch(texto, /UPDATE\s+"invoices"|INSERT\s+INTO\s+"(invoices|payments)"/i, `${rel} escribe en facturas o pagos por SQL`);
    assert.match(texto, /clinicId/, `${rel} no aísla por clínica`);
  }
  // Las tres rutas: sesión, permiso y visibilidad del paciente.
  for (const rel of ["app/api/invoices/condiciones/route.ts", "app/api/invoices/[id]/condiciones/route.ts", "app/api/invoices/[id]/send-email/route.ts"]) {
    const texto = leer(rel);
    assert.match(texto, /getAuthContext\(\)/, `${rel} sin sesión`);
    assert.match(texto, /denyIfMissingPermission\(ctx, "billing\./, `${rel} sin permiso`);
    assert.match(texto, /assertPatientVisible|relatedPatientVisibilityAnd/, `${rel} sin visibilidad de paciente`);
    assert.match(texto, /if \(!ctx\.clinicId\)/, `${rel}: clinicId undefined no filtra nada, hay que cortar antes`);
  }
});

test("la pieza de WhatsApp se REAPROVECHA: misma ruta que el detalle de factura", () => {
  const extras = leer("components/dashboard/factura-ficha-rediseno/extras.ts");
  assert.match(extras, /whatsapp: "send-whatsapp"/, "la ficha no usa /api/invoices/[id]/send-whatsapp");
  assert.ok(leer("components/dashboard/billing/invoice-detail-modal.tsx").includes("/send-whatsapp"), "el detalle ya no usa esa ruta: actualiza este candado");
});

test("enviar nunca falla en silencio", () => {
  const correo = leer("app/api/invoices/[id]/send-email/route.ts");
  assert.match(correo, /if \(!correo\)[\s\S]*?status: 409/, "sin correo tiene que ser un 409 con motivo");
  assert.match(correo, /if \(!delivered\)[\s\S]*?status: 502/, "un correo que no salió no puede contestar ok");
  const ficha = leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
  assert.match(ficha, /disabled=\{enviando !== null \|\| sinTelefono \|\| esperando\}/, "WhatsApp sin teléfono no se deshabilita");
  assert.match(ficha, /disabled=\{enviando !== null \|\| sinCorreo \|\| esperando\}/, "correo sin correo no se deshabilita");
  // El motivo va ESCRITO (un `title` no existe en un iPad).
  assert.match(ficha, /\{sinTelefono && <p className=\{s\.motivo\}>/, "falta el motivo de WhatsApp");
  assert.match(ficha, /\{sinCorreo && <p className=\{s\.motivo\}>/, "falta el motivo de correo");
  assert.ok(!/title=\{t\("facturaFicha\.sin/.test(ficha), "el motivo no puede vivir solo en un title");
  const popup = leer("components/dashboard/factura-ficha-rediseno/forma-de-pago.tsx");
  assert.match(popup, /disabled=\{sinCorreo\}/, "la opción de correo no se deshabilita en el popup");
  assert.match(popup, /disabled=\{sinTelefono\}/, "la opción de WhatsApp no se deshabilita en el popup");
});

test("los estados que ofrece la ficha son los que aceptan las rutas", () => {
  const wa = leer("app/api/invoices/[id]/send-whatsapp/route.ts");
  assert.match(wa, /CHARGEABLE_INVOICE_STATUSES\.filter\(\(s\) => s !== "DRAFT"\)/, "la ruta de WhatsApp cambió sus estados: revisa sePuedeEnviarPorWhatsApp");
  for (const [estado, porWa, porCorreo] of [
    ["DRAFT", false, false], ["PENDING", true, true], ["PARTIAL", true, true],
    ["OVERDUE", true, true], ["PAID", false, true], ["CANCELLED", false, false],
  ] as const) {
    assert.equal(sePuedeEnviarPorWhatsApp(estado), porWa, `WhatsApp ${estado}`);
    assert.equal(sePuedeEnviarPorCorreo(estado), porCorreo, `correo ${estado}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La ficha enseña lo que enseñaba la tabla, y la fila de acciones que pidió Rafael
// ═══════════════════════════════════════════════════════════════════════════
test("la ficha conserva lo que la tabla enseñaba sin clic, con las mismas reglas", () => {
  const ficha = leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
  for (const k of [
    "patients.billing.colPaid", "patients.billing.colBalance",
    "billing.billingClient.cfdiInvoiced", "billing.billingClient.cfdiStamp", "billing.billingClient.satNotConfigured",
    "quotes.card.pdf", "quotes.card.edit", "quotes.card.sendWhatsApp", "quotes.card.duplicate", "facturaFicha.enviarCorreo",
  ]) assert.ok(ficha.includes(`"${k}"`), `la ficha perdió ${k}`);
  for (const fn of ["invoiceStatusBadge", "isVoidedInvoice", "isChargeableInvoice", "fmtMXNdec", "formatDate(inv.createdAt)", "inv.invoiceNumber", "fraseDeFactura"]) {
    assert.ok(ficha.includes(fn), `la ficha no usa ${fn}`);
  }
  assert.ok(ficha.includes("/api/invoices/${inv.id}/print"), "el PDF no es el comprobante de siempre");
  assert.match(ficha, /<article[^>]*onClick=\{onAbrir\}/, "tocar la ficha ya no abre el detalle");
});

test("las claves nuevas existen en los dos idiomas", () => {
  const usadas = new Set<string>();
  for (const a of [...archivosNuevos, { nombre: "modal", texto: leer("components/billing/invoice-editor-modal.tsx") }]) {
    for (const m of a.texto.matchAll(/"facturaFicha\.([a-zA-Z]+)"/g)) usadas.add(m[1]);
  }
  assert.ok(usadas.size >= 15, "se esperaban las claves de la ficha y del popup");
  for (const idioma of ["es", "en"]) {
    const dic = JSON.parse(leer(`i18n/dictionaries/${idioma}.json`)).facturaFicha ?? {};
    for (const k of usadas) assert.equal(typeof dic[k], "string", `${idioma}.json no tiene facturaFicha.${k}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Comportamiento de las piezas puras
// ═══════════════════════════════════════════════════════════════════════════
test("la frase de la ficha es LA de Presupuestos", () => {
  assert.equal(fraseDeFactura(14000, PLAZOS), frasePlan(14000, PLAZOS));
  assert.equal(
    fraseDeFactura(14000, PLAZOS),
    "Enganche de $3,500.00 y 6 pagos mensuales de $1,750.00, el primero el 16 de octubre de 2026",
  );
  assert.equal(fraseDeFactura(500, { ...condicionesPorDefecto(), metodo: "cash" }), "Un solo pago · Efectivo");
  assert.equal(
    fraseDeFactura(500, { ...condicionesPorDefecto(), metodo: "credit", difiereConSuBanco: true }),
    "Un solo pago · Tarjeta crédito · lo difiere con su banco",
  );
  // Una factura de antes de esto se pinta SIN línea, no con una inventada.
  assert.equal(fraseDeFactura(500, null), null);
  assert.equal(fraseDeFactura(500, condicionesPorDefecto()), null);
});

test("resumenConceptos", () => {
  assert.deepEqual(resumenConceptos([{ description: "Limpieza" }]), { texto: "Limpieza", cuantos: 1 });
  assert.deepEqual(
    resumenConceptos([{ description: "Limpieza" }, { description: "Resina" }, { description: "Corona" }, { name: "Rx" }]),
    { texto: "Limpieza, Resina y 2 más", cuantos: 4 },
  );
  assert.deepEqual(resumenConceptos(null), { texto: "", cuantos: 0 });
});

test("duplicar copia conceptos y trato, y NADA de dinero cobrado", () => {
  const b = borradorDesdeFactura({
    id: "x", invoiceNumber: "F-0007", status: "PAID", total: 1800, paid: 1800, balance: 0,
    createdAt: "2026-09-01T00:00:00.000Z", cfdiUuid: "uuid", dueDate: "2026-09-10T06:00:00.000Z",
    discount: 200, notes: "nota", doctorId: "doc1", taxRate: 0, taxIncluded: true,
    items: [
      { description: " Resina ", quantity: 2, unitPrice: 900, discount: 0, total: 1800 },
      { description: "Vieja sin precio", quantity: 2, total: 400 },
      { description: "   ", quantity: 1, unitPrice: 10 },
    ],
  }, PLAZOS);
  assert.deepEqual(b.items, [
    { name: "Resina", quantity: 2, unitPrice: 900, discount: 0 },
    { name: "Vieja sin precio", quantity: 2, unitPrice: 200, discount: 0 },
  ]);
  assert.equal(b.descuento, 200);
  assert.equal(b.doctorId, "doc1");
  assert.equal(b.taxRate, 0);
  assert.equal(b.condiciones?.modo, "plazos");
  assert.equal(b.condiciones?.primerPago, null, "el primer pago de la original ya pasó");
  for (const k of ["paid", "balance", "status", "cfdiUuid", "dueDate", "invoiceNumber", "id"]) {
    assert.ok(!(k in (b as unknown as Record<string, unknown>)), `el duplicado arrastra ${k}`);
  }
});

test("el correo escapa lo que escribe una persona y cuenta el trato", () => {
  assert.equal(escaparHtml(`<b>"a"&'b'</b>`), "&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/b&gt;");
  const c = buildCorreoFactura({
    patient: { firstName: "<script>Ana", lastName: "García" },
    clinicName: "Dental & Co",
    clinicPhone: "999 123 4567",
    invoiceNumber: "F-0001",
    total: 14000, paid: 0, balance: 14000,
    items: [{ description: "Ortodoncia <img src=x>", quantity: 1, unitPrice: 14000 }],
    condiciones: PLAZOS,
  });
  assert.ok(!c.html.includes("<script>") && !c.html.includes("<img"), "HTML sin escapar en el correo");
  assert.ok(c.html.includes("Dental &amp; Co"));
  assert.ok(c.text.includes("Enganche de $3,500.00 y 6 pagos mensuales de $1,750.00"), "el correo no cuenta el trato");
  assert.ok(c.text.includes("Total: $14,000.00") && c.text.includes("Saldo: $14,000.00"));
  assert.ok(c.text.includes("no es un comprobante fiscal (CFDI)"), "el correo no aclara que no es CFDI");
  assert.ok(c.text.includes("Puedes pagar en la clínica o llamarnos al 999 123 4567"), "con saldo, dice cómo pagar");
  // Sin colores copiados a mano: un correo no puede leer los tokens del panel.
  assert.doesNotMatch(c.html, /#[0-9a-f]{3,8}\b/i);
  // Sin condiciones no se inventa una frase.
  const sin = buildCorreoFactura({ patient: null, clinicName: "X", invoiceNumber: "F-2", total: 1, paid: 0, balance: 1, items: [], condiciones: null });
  assert.ok(!sin.text.includes("Forma de pago acordada"));
  // A una factura ya pagada no se le invita a pagar, y un concepto viejo con
  // `unitPrice: null` sale por su `total`, no por $0.00.
  const pagada = buildCorreoFactura({ patient: { firstName: "Ana" }, clinicName: "X", clinicPhone: "999", invoiceNumber: "F-3", total: 400, paid: 400, balance: 0, items: [{ description: "Vieja", quantity: 2, unitPrice: null, total: 400 }] });
  assert.ok(!pagada.text.includes("Puedes pagar"), "el correo de una pagada invita a pagar");
  assert.ok(pagada.text.includes("Tu nota está pagada"));
  assert.ok(pagada.text.includes("2 × Vieja — $400.00"), "unitPrice null tiene que caer a total");
});
