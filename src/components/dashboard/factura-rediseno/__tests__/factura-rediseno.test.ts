/**
 * CANDADOS DEL REDISEÑO DEL DETALLE DE FACTURA Y SU FAMILIA (ws1-t3).
 *
 * Run: npx tsx --test src/components/dashboard/factura-rediseno/__tests__/factura-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO, y eso se ve en el archivo.
 *
 *  - Ni una letra de máquina en la carpeta nueva; las cifras van con
 *    `tabular-nums` sobre Instrument Sans.
 *  - La hoja no inventa tokens ni trae hex: lee `--m2-*` (los del menú) y los
 *    semánticos de globals; toda regla cuelga de `.raiz` o de `.calendario`.
 *  - El camino viejo sigue vivo: cada modal tiene `rediseno = false` por
 *    defecto y toda `font-mono` de los modales queda en la rama VIEJA de un
 *    `cx("vieja", nueva)`, nunca en la nueva.
 *  - Quien monta los modales pasa el interruptor: Caja → BillingClient → los
 *    tres modales; la Agenda nueva; el expediente. Y sale del interruptor
 *    compartido, no de uno propio.
 *  - La lógica no se tocó: las llamadas al servidor de reembolso, timbrado,
 *    cancelar, editar precio, marcar pagada y eliminar borrador siguen ahí.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "factura-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const HOJA = "components/dashboard/factura-rediseno/factura-rediseno.module.css";

const MODALES = [
  "components/dashboard/billing/invoice-detail-modal.tsx",
  "components/dashboard/billing/payment-modal.tsx",
  "components/billing/invoice-editor-modal.tsx",
];

// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 3, "la carpeta tiene la hoja, la raíz y la confirmación");
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
  const css = leer(HOJA);
  assert.match(css, /\.raiz,\s*\.calendario\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s, "la raíz pone tabular-nums");
  assert.match(css, /\.raiz \.cifra\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s, "las cifras llevan tabular-nums");
  assert.match(css, /\.raiz \.cifra\s*\{[^}]*text-align:\s*right/s, "las cifras se alinean a la derecha, en columna");
});

// ═══════════════════════════════════════════════════════════════════════════
// En los modales, toda letra de máquina vive SOLO en la rama vieja de cx()
// ═══════════════════════════════════════════════════════════════════════════
test("los modales solo piden letra de máquina en la rama vieja de cx(\"…\")", () => {
  for (const rel of MODALES) {
    const texto = leer(rel);
    const total = (texto.match(LETRA_DE_MAQUINA) ? texto.match(new RegExp(LETRA_DE_MAQUINA.source, "g")) ?? [] : []).length;
    // Cada una está en el PRIMER argumento (la cadena de siempre) de cx(…), o
    // en la rama `rediseno ? undefined : "…"` (también la de siempre).
    const enRamaVieja = [
      ...texto.matchAll(/cx\(\s*"[^"]*"/g),
      ...texto.matchAll(/rediseno \? undefined : "[^"]*"/g),
    ].filter((m) => LETRA_DE_MAQUINA.test(m[0])).length;
    assert.equal(total, enRamaVieja, `${rel}: hay letra de máquina fuera de la rama vieja de cx()`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos ni hex: la hoja LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("la hoja no declara tokens --m2-* ni trae hex sueltos", () => {
  const css = leer(HOJA);
  assert.doesNotMatch(css, /--m2-[a-z0-9-]+\s*:/, "declara un token --m2-*: esos son del menú (clases.ts), solo se leen");
  // Un hex solo puede aparecer como RESPALDO dentro de un var(--x, #hex).
  const sinRespaldos = css.replace(/var\(--[a-z0-9-]+,\s*[^)]*\)/g, "");
  assert.doesNotMatch(sinRespaldos, /#[0-9a-f]{3,8}\b/i, "un color en hex fuera de un respaldo var(--x, #hex)");
  assert.ok((css.match(/var\(--m2-/g) ?? []).length >= 80, "consume los tokens --m2- del menú");
  const raiz = leer("components/dashboard/factura-rediseno/raiz.ts");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.match(raiz, /CLASES_FACTURA_REDISENO = \[CLASES_MENU, s\.raiz\]/);
  assert.match(raiz, /CLASES_CALENDARIO_REDISENO = \[CLASES_MENU, s\.calendario\]/);
});

test("toda regla de la hoja cuelga de .raiz o de .calendario", () => {
  const css = leer(HOJA).replace(/\/\*[\s\S]*?\*\//g, "");
  const selectores = [...css.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map((m) => m[2].trim());
  assert.ok(selectores.length > 60, "la hoja tiene reglas");
  for (const sel of selectores) {
    // Los @keyframes traen `to` como selector: se dejan pasar.
    if (/^(from|to|\d+%)$/.test(sel)) continue;
    const ok = sel.split(",").every((parte) => /\.(raiz|calendario)\b/.test(parte));
    assert.ok(ok, `regla fuera de .raiz / .calendario: «${sel}»`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo: `rediseno` es opcional y falso por defecto
// ═══════════════════════════════════════════════════════════════════════════
test("cada modal tiene `rediseno = false` por defecto y viste con CLASES_FACTURA_REDISENO", () => {
  for (const rel of MODALES) {
    const texto = leer(rel);
    assert.match(texto, /rediseno\?: boolean;/, `${rel}: la prop es opcional`);
    assert.match(texto, /rediseno = false \}/, `${rel}: por defecto apagado`);
    assert.match(texto, /CLASES_FACTURA_REDISENO/, `${rel}: monta la raíz del rediseño`);
  }
  // Las cadenas de clases de siempre siguen ahí, tal cual, como rama vieja.
  const detalle = leer(MODALES[0]);
  assert.match(detalle, /cx\("max-w-lg bg-card text-foreground border border-border"/);
  assert.equal((detalle.match(/cx\("max-w-md bg-card text-foreground border border-border"/g) ?? []).length, 5, "los 5 subdiálogos");
  const editor = leer(MODALES[2]);
  assert.match(editor, /: "max-w-2xl"\}/, "Nueva factura conserva su ancho de siempre");
  // La confirmación global sigue para el camino viejo.
  assert.match(detalle, /if \(rediseno\) \{ setConfirmacion\("mark-paid"\); return; \}/);
  assert.match(detalle, /if \(rediseno\) \{ setConfirmacion\("delete-draft"\); return; \}/);
  assert.equal((detalle.match(/await confirmDialog\(/g) ?? []).length, 2, "useConfirm sigue en las dos preguntas del camino viejo");
  assert.match(detalle, /\{rediseno && \(\s*<ConfirmacionFactura/, "la confirmación nueva solo se monta con el interruptor");
});

// ═══════════════════════════════════════════════════════════════════════════
// Quien monta los modales pasa el interruptor, y es el compartido
// ═══════════════════════════════════════════════════════════════════════════
test("Caja → BillingClient → modales, Agenda nueva y expediente pasan `rediseno`", () => {
  const caja = leer("app/dashboard/caja/caja-client.tsx");
  assert.match(caja, /<BillingClient[\s\S]*?rediseno=\{rediseno\}[\s\S]*?\/>/, "Caja le pasa el interruptor a la pestaña Facturas");
  const cajaPage = leer("app/dashboard/caja/page.tsx");
  assert.match(cajaPage, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "Caja usa el interruptor compartido");

  const billing = leer("app/dashboard/billing/billing-client.tsx");
  assert.match(billing, /rediseno = false \}: Props/);
  for (const modal of ["InvoiceEditorModal", "InvoiceDetailModal", "PaymentModal"]) {
    assert.match(billing, new RegExp(`<${modal}\\s+rediseno=\\{rediseno\\}`), `BillingClient pasa rediseno a ${modal}`);
  }

  const panel = leer("components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /<InvoiceDetailModal\s+rediseno\s/, "la Agenda nueva (solo existe con el interruptor) lo enciende");

  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  for (const modal of ["InvoiceEditorModal", "InvoiceDetailModal", "PaymentModal"]) {
    assert.match(ficha, new RegExp(`<${modal}\\s+rediseno=\\{rediseno\\}`), `el expediente pasa rediseno a ${modal}`);
  }

  // El detalle le pasa el interruptor a su propio PaymentModal.
  const detalle = leer(MODALES[0]);
  assert.match(detalle, /<PaymentModal\s+rediseno=\{rediseno\}/);
  // Y el cobro viste también su calendario (portal a <body>).
  const pago = leer(MODALES[1]);
  assert.match(pago, /popoverClassName=\{rediseno \? CLASES_CALENDARIO_REDISENO : undefined\}/);
  const dateField = leer("components/ui/date-field.tsx");
  assert.match(dateField, /className=\{popoverClassName \? `df-pop \$\{popoverClassName\}` : "df-pop"\}/, "sin la prop, el popover lleva df-pop a secas");
});

// ═══════════════════════════════════════════════════════════════════════════
// Esto es ropa: las llamadas al servidor siguen siendo las mismas
// ═══════════════════════════════════════════════════════════════════════════
test("las acciones que tocan dinero y SAT siguen cableadas igual", () => {
  const detalle = leer(MODALES[0]);
  for (const llamada of [
    'callApi("/mark-paid", "POST", {}, t("clinical.invoiceDetail.markPaidSuccess"))',
    'callApi("", "DELETE", undefined, t("clinical.invoiceDetail.draftDeleted"))',
    'callApi("/refund", "POST", { amount, reason: refundReason.trim() || undefined }, t("clinical.invoiceDetail.refundSuccess"))',
    'callApi("/edit-price", "POST", { total }, t("clinical.invoiceDetail.priceUpdated"))',
    'callApi("/edit-price", "POST", { discount }, t("clinical.invoiceDetail.discountApplied"))',
    'callApi("/cancel", "POST", { reason: cancelReason.trim() || undefined }, t("clinical.invoiceDetail.cancelSuccess"))',
    'fetch(`/api/invoices/${invoice.id}/confirm`, { method: "POST" })',
    'fetch("/api/cfdi", {',
    "confirmUnpaidPue: pueOk === true ? true : undefined,",
    "taxMode:     fiscal.impuestos,",
  ]) {
    assert.ok(detalle.includes(llamada), `se perdió: ${llamada}`);
  }
  // Cada llamada de dinero aparece UNA vez: no se duplicó ninguna al vestir.
  assert.equal((detalle.match(/callApi\("\/mark-paid"/g) ?? []).length, 1);
  assert.equal((detalle.match(/callApi\("", "DELETE"/g) ?? []).length, 1);
  assert.equal((detalle.match(/callApi\("\/refund"/g) ?? []).length, 1);
  assert.equal((detalle.match(/callApi\("\/cancel"/g) ?? []).length, 1);
  assert.equal((detalle.match(/fetch\("\/api\/cfdi", \{/g) ?? []).length, 1);

  const pago = leer(MODALES[1]);
  assert.ok(pago.includes("paidAt: paidAtInstant(paidAt)?.toISOString(),"), "el cobro manda la misma fecha");
  assert.ok(pago.includes("const isOverpay = amountNum > invoice.balance + 0.001;"), "la validación del sobrepago no cambió");

  const editor = leer(MODALES[2]);
  assert.ok(editor.includes("const bd = cfdiTotalBreakdown(lineas, totals.discountAmount, taxMode, taxIncluded);"), "el IVA se sigue calculando igual");
  assert.ok(editor.includes('const res = await fetch("/api/invoices", {'), "Nueva factura sigue creando por el mismo endpoint");
});
