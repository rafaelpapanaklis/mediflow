/**
 * CANDADOS DE «UNA FACTURA SE COBRA EN UNA VENTANA» (ws1-t2).
 *
 * Run: npx tsx --test src/components/dashboard/factura-un-popup/__tests__/factura-un-popup.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts` y
 * `factura-rediseno.test.ts`: lo que se vigila es CABLEADO.
 *
 *  - Esto es una MUDANZA del formulario de cobro, no un cobro nuevo: el POST
 *    de `use-cobro.ts` es, letra por letra, el de `billing/payment-modal.tsx`,
 *    con la misma validación y los mismos valores iniciales.
 *  - Los seis métodos salen de la MISMA lista que la ventana de cobro.
 *  - El camino viejo sigue vivo: sin interruptor, el detalle abre PaymentModal
 *    y los diálogos de siempre; la sección nueva solo se monta con `cobrable`.
 *  - Lo que no se toca no se tocó: editar precio, eliminar borrador, imprimir
 *    y timbrar siguen cableados igual.
 *  - Ni letra de máquina, ni tokens propios, ni hex sueltos en la carpeta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "factura-un-popup");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const DETALLE = "components/dashboard/billing/invoice-detail-modal.tsx";
const VENTANA_DE_COBRO = "components/dashboard/billing/payment-modal.tsx";
const HOOK = "components/dashboard/factura-un-popup/use-cobro.ts";
const SECCION = "components/dashboard/factura-un-popup/seccion-cobro.tsx";
const HOJA = "components/dashboard/factura-un-popup/un-popup.module.css";

// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

const sinEspacios = (s: string) => s.replace(/\s+/g, " ").trim();

/** Desde `desde` hasta la llave/paréntesis que cierra el primer `{` o `(` que se abra. */
function bloque(texto: string, desde: string): string {
  const i = texto.indexOf(desde);
  assert.ok(i >= 0, `no está «${desde}»`);
  let hondo = 0;
  for (let j = i; j < texto.length; j++) {
    const ch = texto[j];
    if (ch === "(" || ch === "{") hondo++;
    if (ch === ")" || ch === "}") { hondo--; if (hondo === 0) return texto.slice(i, j + 1); }
  }
  throw new Error(`«${desde}» no cierra`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Mudanza, no cobro nuevo: el mismo POST, con los mismos datos
// ═══════════════════════════════════════════════════════════════════════════
test("el POST del cobro es, letra por letra, el de la ventana de cobro", () => {
  const viejo = leer(VENTANA_DE_COBRO);
  const nuevo = leer(HOOK);
  const postViejo = sinEspacios(bloque(viejo, "fetch(`/api/invoices/${invoice.id}`, {"));
  const postNuevo = sinEspacios(bloque(nuevo, "fetch(`/api/invoices/${invoice.id}`, {"));
  assert.equal(postNuevo, postViejo, "el cuerpo del cobro cambió en uno de los dos archivos y no en el otro");
  // Y lleva lo que tiene que llevar (si alguien lo quita de LOS DOS, también cae).
  for (const campo of [
    'method: "POST"',
    "amount: amountNum,",
    "method,",
    "paidAt: paidAtInstant(paidAt)?.toISOString(),",
    "reference: reference.trim() || undefined,",
    "notes: notes.trim() || undefined,",
  ]) {
    assert.ok(postNuevo.includes(campo), `el cobro ya no manda: ${campo}`);
  }
  assert.equal((nuevo.match(/fetch\(/g) ?? []).length, 2, "el hook llama al servidor dos veces: confirmar el borrador y cobrar");
});

test("misma validación y mismos valores iniciales que la ventana de cobro", () => {
  const viejo = leer(VENTANA_DE_COBRO);
  const nuevo = leer(HOOK);
  for (const linea of [
    "const amountNum = Number(amount);",
    "const isInvalid = !amountNum || amountNum <= 0 || isOverpay;",
    'setMethod("cash");',
    "setPaidAt(todayLocalISO());",
    'setReference("");',
    'setNotes("");',
    'toast.success(t("clinical.paymentModal.registerSuccess"));',
    'throw new Error(body.error ?? t("clinical.paymentModal.registerError"));',
    'toast.error(err.message ?? t("clinical.paymentModal.registerErrorGeneric"));',
  ]) {
    assert.ok(viejo.includes(linea), `la ventana de cobro ya no tiene: ${linea}`);
    assert.ok(nuevo.includes(linea), `el cobro en el detalle no tiene: ${linea}`);
  }
  // El tope del sobrepago es el mismo número, con el saldo de la factura.
  assert.ok(viejo.includes("const isOverpay = amountNum > invoice.balance + 0.001;"));
  assert.ok(nuevo.includes("const isOverpay = amountNum > balance + 0.001;"));
  assert.ok(nuevo.includes("const balance = factura?.balance ?? 0;"));
  assert.ok(nuevo.includes("setAmount(String(balance ?? 0));"), "el monto arranca en el saldo");
});

test("un borrador se confirma ANTES de cobrar, con la misma llamada, y no dos veces", () => {
  const nuevo = leer(HOOK);
  const confirmar = nuevo.indexOf("fetch(`/api/invoices/${invoice.id}/confirm`, { method: \"POST\" })");
  const cobrar = nuevo.indexOf("fetch(`/api/invoices/${invoice.id}`, {");
  assert.ok(confirmar > 0 && cobrar > confirmar, "primero confirma, luego cobra (el orden de hoy)");
  assert.match(nuevo, /if \(confirmarAntes && confirmadaRef\.current !== invoice\.id\)/, "solo borradores, y solo la primera vez");
  assert.match(nuevo, /confirmadaRef\.current = invoice\.id;/);
  assert.ok(nuevo.includes('throw new Error(err.error ?? t("clinical.invoiceDetail.confirmError"));'), "el mismo mensaje si no se puede confirmar");
  const detalle = leer(DETALLE);
  assert.match(detalle, /confirmarAntes: invoice\?\.status === "DRAFT",/);
  // El camino viejo conserva su propio confirmar-y-abrir.
  assert.ok(detalle.includes("async function handleConfirmAndPay()"));
  assert.ok(detalle.includes("onClick={handleConfirmAndPay}"));
});

test("los seis métodos, la fecha, la referencia y las notas siguen ahí", () => {
  const viejo = leer(VENTANA_DE_COBRO);
  for (const m of ["cash", "debit", "credit", "transfer", "check", "other"]) {
    assert.match(viejo, new RegExp(`\\{ value: "${m}",`), `falta el método ${m} en la lista compartida`);
  }
  assert.match(viejo, /export const METHODS:/, "la lista se exporta para no copiarla");
  const seccion = leer(SECCION);
  assert.match(seccion, /import \{ METHODS \} from "@\/components\/dashboard\/billing\/payment-modal";/);
  assert.match(seccion, /METHODS\.map\(/);
  assert.doesNotMatch(seccion, /value: "cash"/, "la sección no trae su propia lista de métodos");
  for (const pieza of [
    "cobro.setAmount(e.target.value)",
    "cobro.setMethod(m.value)",
    "cobro.setPaidAt(e.target.value)",
    "cobro.setReference(e.target.value)",
    "cobro.setNotes(e.target.value)",
    "<DateField max={todayLocalISO()}",
    'popoverClassName={CLASES_CALENDARIO_REDISENO}',
    't("clinical.paymentModal.refTransfer")',
    't("clinical.paymentModal.refCheck")',
    't("clinical.paymentModal.refAuthorization")',
    't("clinical.paymentModal.overpayWarning"',
  ]) {
    assert.ok(seccion.includes(pieza), `la sección perdió: ${pieza}`);
  }
});

test("la sección NO repite Factura, Paciente, Total, Pagado ni Saldo", () => {
  const seccion = leer(SECCION);
  for (const clave of [
    "clinical.paymentModal.invoice",
    "clinical.paymentModal.patient",
    "clinical.paymentModal.paid",
    "clinical.paymentModal.pendingBalance",
    '"common.total"',
  ]) {
    assert.ok(!seccion.includes(clave), `la sección vuelve a pintar ${clave}, que ya está en el detalle`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// El detalle: una ventana con el interruptor, las dos de siempre sin él
// ═══════════════════════════════════════════════════════════════════════════
test("con el interruptor, el cobro sale desplegado dentro del detalle y el pie registra el pago", () => {
  const d = leer(DETALLE);
  assert.match(d, /const cobrable = rediseno && !!invoice && \["DRAFT", "PENDING", "PARTIAL", "OVERDUE"\]\.includes\(invoice\.status\);/,
    "cobrable = interruptor + los mismos estados que hoy enseñan «Cobrar»");
  assert.match(d, /\{cobrable && \(\s*<SeccionCobro/, "la sección solo se monta con `cobrable`");
  assert.match(d, /alCobrar: handlePaymentSuccess,/, "al cobrar corre lo mismo que corría la segunda ventana");
  assert.match(d, /alOcupar: setBusy,/, "mientras cobra, el resto de botones del detalle se bloquea");
  assert.equal((d.match(/\{rediseno \? botonRegistrarPago : \(/g) ?? []).length, 2, "borrador y pendiente: el botón del pie cambia solo con el interruptor");
  assert.match(d, /onClick=\{cobro\.submit\}/);
  assert.match(d, /onOpenAutoFocus=\{cobrable \? enfocarMontoAlAbrir : undefined\}/, "el foco cae en el monto, como en la ventana de cobro");
  // El descuento en línea usa el estado y la llamada DEL DETALLE.
  assert.match(d, /alAplicar=\{handleDiscount\}/);
  assert.match(d, /valor=\{discountAmt\}/);
  assert.equal((d.match(/callApi\("\/edit-price", "POST", \{ discount \}/g) ?? []).length, 1, "el descuento sigue teniendo UNA llamada");
  assert.match(d, /const descuentoPendiente = admiteDescuento && Number\(discountAmt \|\| 0\) !== \(invoice\.discount \?\? 0\);/);
  assert.match(d, /disabled=\{busy \|\| cobro\.saving \|\| cobro\.isInvalid \|\| descuentoPendiente\}/, "no se cobra con un descuento escrito y sin aplicar");
});

test("sin el interruptor, todo lo de siempre sigue cableado", () => {
  const d = leer(DETALLE);
  // Los dos botones que abren la segunda ventana.
  assert.ok(d.includes('onClick={handleConfirmAndPay} disabled={busy}>\n                  {t("clinical.invoiceDetail.chargeNow", { amount: fmtMXNdec(invoice.total) })}'));
  assert.ok(d.includes('onClick={() => setPaymentOpen(true)} disabled={busy}>\n                  {t("clinical.invoiceDetail.collectPayment", { amount: fmtMXNdec(invoice.balance) })}'));
  // Los dos botones que abren el diálogo del descuento, ahora solo sin interruptor.
  assert.equal((d.match(/\{!rediseno && \(\s*<ButtonNew variant="secondary" icon=\{<Tag size=\{14\} aria-hidden \/>\} onClick=\{\(\) => openSub\("discount"\)\}/g) ?? []).length, 2);
  // PaymentModal y el diálogo del descuento siguen montados.
  assert.match(d, /<PaymentModal\s+rediseno=\{rediseno\}\s+open=\{paymentOpen\}/);
  assert.match(d, /<Dialog open=\{sub === "discount"\}/);
  // `cobrable` exige el interruptor: sin él no hay ni ropa ni sección ni foco.
  assert.match(d, /const ropaUnPopup = cobrable \? CLASES_UN_POPUP : "";/);
  assert.match(d, /const ropaCuerpo {2}= cobrable \? CLASE_CUERPO_CON_COBRO : "";/);
  // La cadena de clases de siempre, intacta, como rama vieja de cx().
  assert.ok(d.includes('cx("max-w-lg bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${ropaUnPopup}`)'));
  assert.ok(d.includes('cx("px-6 py-4 space-y-4 flex-1 overflow-y-auto min-h-0", `${c.cuerpo} ${ropaCuerpo}`)'));
});

test("lo que no se toca no se tocó: editar precio, eliminar borrador, imprimir y timbrar", () => {
  const d = leer(DETALLE);
  for (const pieza of [
    'callApi("/edit-price", "POST", { total }, t("clinical.invoiceDetail.priceUpdated"))',
    'callApi("", "DELETE", undefined, t("clinical.invoiceDetail.draftDeleted"))',
    'onClick={() => openSub("edit-price")} disabled={busy}>',
    "onClick={handleDeleteDraft} disabled={busy}>",
    "onClick={() => window.open(`/api/invoices/${invoice.id}/print`, \"_blank\")}>",
    'fetch("/api/cfdi", {',
    "onClick={openCfdiForm} disabled={busy}>",
    // H-9 (ws1-t6): el botón además se apaga cuando el CFDI YA se timbró pero
    // no se pudo guardar; las dos condiciones de siempre siguen ahí.
    "onClick={handleStampCfdi} disabled={busy || cfdiImpideReintento(cfdiBlockCode) || (invoice.balance > 0 && !pueOk)}>",
  ]) {
    assert.ok(d.includes(pieza), `se perdió: ${pieza}`);
  }
  assert.equal((d.match(/openSub\("edit-price"\)/g) ?? []).length, 2, "«Editar precio» sale donde salía: borrador y pendiente sin pagos");
});

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje visual: se LEE del menú; ni letra de máquina ni colores propios
// ═══════════════════════════════════════════════════════════════════════════
test("sin letra de máquina en la carpeta; las cifras con tabular-nums", () => {
  assert.ok(archivosNuevos.length >= 4, "hoja, raíz, hook y sección");
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`);
  }
  const css = leer(HOJA);
  assert.match(css, /\.unPopup \.cobro\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(css, /\.unPopup \.cifraEnTexto\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
});

test("la hoja no declara variables ni trae hex sueltos, y todo cuelga de .unPopup", () => {
  const css = leer(HOJA);
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declaraciones = sinComentarios.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  // Un hex solo puede aparecer como RESPALDO dentro de un var(--x, #hex).
  const sinRespaldos = sinComentarios.replace(/var\(--[a-z0-9-]+,\s*[^)]*\)/g, "");
  assert.doesNotMatch(sinRespaldos, /#[0-9a-f]{3,8}\b/i, "un color en hex fuera de un respaldo var(--x, #hex)");
  assert.ok((css.match(/var\(--m2-/g) ?? []).length >= 6, "lee los tokens --m2- del menú");
  const selectores = [...sinComentarios.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map((m) => m[2].trim());
  assert.ok(selectores.length >= 8, "la hoja tiene reglas");
  for (const sel of selectores) {
    assert.ok(sel.split(",").every((parte) => /^\.unPopup\b/.test(parte.trim())), `regla fuera de .unPopup: «${sel}»`);
  }
  // Nada se esconde por ancho: la hoja apila, no oculta.
  assert.doesNotMatch(sinComentarios, /display:\s*none|visibility:\s*hidden/, "la hoja no esconde nada");
});

test("la ropa va al lado de la raíz del rediseño, que es quien monta los tokens", () => {
  const raiz = leer("components/dashboard/factura-un-popup/raiz.ts");
  assert.match(raiz, /CLASES_UN_POPUP = \[u\.unPopup, u\.conCobro\]/);
  for (const a of archivosNuevos.filter((x) => /\.tsx?$/.test(x.nombre))) {
    assert.doesNotMatch(a.texto, /menu-dos-niveles\/clases/, `${a.nombre}: los tokens ya los monta CLASES_FACTURA_REDISENO; aquí no se vuelve a montar nada del menú`);
  }
});
