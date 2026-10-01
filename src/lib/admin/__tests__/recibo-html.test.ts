// A2 (auditoría 30-sep-2026): el recibo HTML que abre el admin de plataforma no
// puede ejecutar nada que venga de los datos de la clínica.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderReciboHtml, type ReciboPago } from "../recibo-html";

const SCRIPT = '</div><script>fetch("/api/admin/clinics")</script>';
const IMG = '"><img src=x onerror=alert(1)>';

function pago(over: Partial<ReciboPago> = {}, clinic: Partial<ReciboPago["clinic"]> = {}): ReciboPago {
  return {
    id: "cl_abcdef123456",
    status: "paid",
    currency: "MXN",
    amount: 1499,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    periodStart: new Date("2026-09-01T12:00:00Z"),
    periodEnd: new Date("2026-10-01T12:00:00Z"),
    method: "stripe",
    reference: "pi_123",
    clinic: { name: "Clínica Sonrisa", email: "a@b.mx", city: "CDMX", address: "Calle 1", taxId: "ABC010101AB1", ...clinic },
    ...over,
  };
}

/** Cuenta los <script …> del HTML (los que de verdad se parsearían como etiqueta). */
const scripts = (html: string) => (html.match(/<script\b/gi) ?? []).length;

test("recibo normal: nombre, RFC y monto salen; un solo script (el de imprimir) con nonce", () => {
  const html = renderReciboHtml(pago(), "NONCE123");
  assert.match(html, /Clínica Sonrisa/);
  assert.match(html, /RFC: ABC010101AB1/);
  assert.match(html, /1,499\.00/);
  assert.equal(scripts(html), 1);
  assert.match(html, /<script nonce="NONCE123">/);
  assert.doesNotMatch(html, /onclick=/i);
});

test("nombre, correo, ciudad, dirección y RFC hostiles salen como texto, no como etiquetas", () => {
  const html = renderReciboHtml(
    pago({}, { name: SCRIPT, email: IMG, city: SCRIPT, address: IMG, taxId: SCRIPT }),
    "N",
  );
  assert.equal(scripts(html), 1, "solo el script legítimo del botón");
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /fetch\("\/api\/admin/); // las comillas quedan como &quot;
  assert.match(html, /&lt;script&gt;fetch\(&quot;\/api\/admin\/clinics&quot;\)&lt;\/script&gt;/);
});

test("método, referencia, folio y estado hostiles también se escapan", () => {
  const html = renderReciboHtml(
    pago({ id: SCRIPT, status: SCRIPT, method: SCRIPT, reference: IMG }),
    "N",
  );
  assert.equal(scripts(html), 1);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<\/div><script>fetch/);
});

test("moneda inválida no tumba el recibo", () => {
  assert.doesNotThrow(() => renderReciboHtml(pago({ currency: "<script>" }), "N"));
});

test("la ruta manda el mismo nonce en la CSP y no admite scripts en línea sin él", () => {
  const ruta = readFileSync("src/app/api/admin/payments/[id]/receipt/route.ts", "utf8");
  assert.match(ruta, /script-src 'nonce-\$\{nonce\}'/);
  assert.match(ruta, /renderReciboHtml\(payment, nonce\)/);
  assert.doesNotMatch(ruta, /script-src[^`]*unsafe-inline/);
});
