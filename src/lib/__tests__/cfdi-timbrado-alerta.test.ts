/**
 * Hallazgo 19 (segunda mitad) · que la divergencia DEJE DE SER INVISIBLE.
 *
 * Run: npm run test:cfdi-timbrado-alerta
 *
 * `cfdi-dinero.test.ts` ya fija la PREDICCIÓN: `expectedCfdiTotal` calcula el IVA
 * por concepto, como el SAT. Esto es lo otro: el HECHO. Después de timbrar,
 * Facturapi devuelve `result.total` —el importe que de verdad quedó ante el
 * SAT— y hasta ahora se guardaba en `CfdiRecord.total` sin compararlo con nada.
 *
 * La comparación que había reutilizaba la tolerancia de la guarda PREVIA
 * (`0.01 + 0.01 × nº líneas`), y esa tolerancia está calibrada justo para
 * absorber la divergencia entre el criterio agregado y el criterio por concepto.
 * Resultado: el caso COMÚN —el 34.1% de las facturas con IVA agregado, hasta 2¢
 * con 8 conceptos— quedaba por debajo del umbral y no dejaba rastro en ninguna
 * parte. Detectar solo lo que la tolerancia ya perdonaba no detecta nada.
 *
 * Lo que se prueba aquí: toda diferencia real (≥1¢) deja CONSTANCIA, y solo la
 * que excede el redondeo genera AVISO para un humano. Y por FUENTE, que
 * `cfdi/route.ts` está cableado así — sin eso la prueba pasaría con el helper
 * correcto y la ruta sin arreglar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cfdiStampedCheck,
  computeInvoiceTotal,
  expectedCfdiTotal,
} from "../invoice-totals";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ── Los números del hallazgo, sacados de los helpers de verdad ──────────────
// 8 conceptos de $333.33 con IVA agregado: el caso descrito en la auditoría.
const ocho = Array.from({ length: 8 }, (_, i) => ({
  description: `Resina ${i + 1}`, quantity: 1, unitPrice: 333.33,
}));
/** Lo que Facturapi timbra: IVA por concepto. */
const TIMBRADO = expectedCfdiTotal(ocho, 0, "iva16", false);
/** Lo que se guarda en `invoice.total`: IVA sobre la base agregada. */
const GUARDADO = computeInvoiceTotal(333.33 * 8, 0, 16, false).total;
/** La misma tolerancia que arma `cfdi/route.ts` en modo IVA agregado. */
const TOL = 0.01 + 0.01 * ocho.length;

test("el caso del hallazgo es real: 2¢ de diferencia, y la tolerancia son 9¢", () => {
  assert.equal(TIMBRADO, 3093.28); // lo que ve el SAT
  assert.equal(GUARDADO, 3093.30); // lo que ve la clínica
  assert.equal(Math.round(Math.abs(TIMBRADO - GUARDADO) * 100) / 100, 0.02);
  assert.equal(TOL, 0.09);

  // ESTA es la regla que había: `diff > tolerance`. Con estos números dice que
  // no pasa nada — por eso el 34.1% no dejaba rastro en ninguna parte.
  const reglaVieja = 0.02 > TOL;
  assert.equal(reglaVieja, false, "la regla vieja no ve el caso común: por eso se cambió");
});

// ── CONSTANCIA: toda diferencia real queda registrada ──────────────────────

test("la divergencia de criterio deja constancia, aunque esté dentro de la tolerancia", () => {
  const r = cfdiStampedCheck(TIMBRADO, GUARDADO, TOL);
  assert.equal(r.level, "rounding");     // ← NO es "match": hay constancia
  assert.notEqual(r.level, "match");
  assert.equal(r.stampedTotal, 3093.28);
  assert.equal(r.diff, 0.02);
});

test("cuadrar de verdad no genera ruido", () => {
  const r = cfdiStampedCheck(3093.30, 3093.30, TOL);
  assert.equal(r.level, "match");
  assert.equal(r.diff, 0);
});

test("el ruido de punto flotante no es una divergencia", () => {
  // 0.1 + 0.2 = 0.30000000000000004; sin round2 en la resta esto sería un falso
  // positivo en cada timbrado.
  const r = cfdiStampedCheck(1000.3, 1000 + 0.1 + 0.2, 0.01);
  assert.equal(r.level, "match");
  assert.equal(r.diff, 0);
});

test("un centavo ya es constancia, también en modo exento (tolerancia 0.01)", () => {
  const r = cfdiStampedCheck(1000.01, 1000, 0.01);
  assert.equal(r.level, "rounding");
  assert.equal(r.diff, 0.01);
});

test("si el SAT no devuelve un total legible, tampoco se puede afirmar que cuadre", () => {
  for (const raw of [undefined, null, NaN, "", "abc", 0, -5]) {
    const r = cfdiStampedCheck(raw, 3093.30, TOL);
    assert.equal(r.level, "unknown", `total ${String(raw)} tiene que quedar como "unknown"`);
    assert.equal(r.stampedTotal, null);
    assert.equal(r.diff, null);
  }
});

// ── AVISO: solo lo que un humano tiene que mirar ───────────────────────────

test("una diferencia que el redondeo no explica sí es para avisar", () => {
  // El caso F-000155 en su forma post-timbrado: el CFDI salió por otro monto.
  const r = cfdiStampedCheck(3052.00, GUARDADO, TOL);
  assert.equal(r.level, "material");
  assert.equal(r.diff, 41.30);
});

test("la frontera está en la tolerancia: 9¢ es redondeo, 10¢ es material", () => {
  assert.equal(cfdiStampedCheck(1000.09, 1000, TOL).level, "rounding");
  assert.equal(cfdiStampedCheck(1000.10, 1000, TOL).level, "material");
});

// ── Y que la RUTA esté cableada así ────────────────────────────────────────

const route = src("src/app/api/cfdi/route.ts");

test("cfdi/route.ts contrasta el total REAL del SAT con el guardado", () => {
  assert.ok(route.includes("cfdiStampedCheck(result.total, invoice.total, tolerance)"),
    "la ruta tiene que contrastar result.total (el hecho) contra invoice.total");
  assert.ok(route.indexOf("await createInvoice(") < route.indexOf("cfdiStampedCheck("),
    "el contraste va DESPUÉS de timbrar: compara el hecho, no la predicción");
});

test("la constancia del audit log NO depende del aviso", () => {
  assert.ok(/totalMismatch: stampedRecord/.test(route),
    "el audit log tiene que registrar la constancia completa (stampedRecord)");
  assert.ok(!/totalWarning\s*\?\s*\{\s*totalMismatch/.test(route),
    "el registro no puede ir colgado de totalWarning: esa puerta la cierra la tolerancia");
  assert.ok(/stampedRecord\s*=\s*stamped\.level === "match"/.test(route),
    "stampedRecord tiene que existir para TODO lo que no sea 'match', sin tolerancia");
});

test("el aviso al usuario sigue reservado a lo accionable", () => {
  assert.ok(/totalWarning\s*=\s*stamped\.level === "material"/.test(route),
    "el warning de la respuesta solo sale con una diferencia material");
  assert.ok(route.includes("CFDI_STAMPED_TOTAL_DIFFERS"),
    "se conserva el code que el modal ya escucha para el toast");
});

test("nada de esto tumba un timbrado que YA existe ante el SAT", () => {
  // El CFDI ya está emitido: entre createInvoice y la respuesta de éxito no
  // puede aparecer ninguna respuesta de error.
  const desde = route.indexOf("const result = await createInvoice(");
  const hasta = route.indexOf("return NextResponse.json({\n      cfdiId:");
  assert.ok(desde > 0 && hasta > desde, "no se localizó el tramo post-timbrado");
  const tramo = route.slice(desde, hasta);
  assert.ok(!/\{\s*status:\s*\d{3}\s*\}/.test(tramo),
    "después de timbrar no se devuelve ningún error: se deja constancia y se sigue");
  assert.ok(!/\bthrow\b/.test(tramo),
    "después de timbrar no se lanza: perderíamos el CfdiRecord de un CFDI ya emitido");
});
