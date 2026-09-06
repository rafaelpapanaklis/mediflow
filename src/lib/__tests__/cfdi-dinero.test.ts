/**
 * El dinero que se timbra ante el SAT y el que lee la recepcionista.
 *
 * Run: npm run test:cfdi-dinero
 *
 * La auditoría encontró CERO pruebas sobre la aritmética del dinero, y por eso
 * nada de esto saltó antes. Cubre cuatro hallazgos:
 *
 *   13 · POST /api/cfdi sin `invoiceId` timbraba una factura CUALQUIERA.
 *   19 · el IVA se calculaba distinto en la factura y en el CFDI.
 *   20 · el comprobante impreso no imprimía el IVA y no cuadraba.
 *   21 · los modales de dinero borraban los centavos.
 *
 * 19 y 20 se prueban por VALOR sobre los helpers puros. 13 y 21 viven en un
 * `route.ts` de App Router y en dos componentes React (@react-pdf y DOM) que
 * `tsx --test` no puede ejecutar, así que además de probar su núcleo puro se
 * fija por FUENTE que el archivo de verdad lo usa: sin eso, la prueba pasaría
 * con el helper correcto y el archivo sin arreglar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cfdiTotalBreakdown,
  computeInvoiceTotal,
  expectedCfdiTotal,
  invoicePrintTotals,
} from "../invoice-totals";
import { isUsableWhereId } from "../validations";
import { formatCurrency } from "../utils";
import { fmtMXNdec } from "../format";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ── Hallazgo 13 · qué factura se timbra ────────────────────────────────────

test("un id que Prisma DESCARTARÍA del where no pasa la guarda", () => {
  // `{ id: undefined }` no filtra: Prisma quita la clave y el findFirst se queda
  // en `{ clinicId }` → devuelve una factura arbitraria de la clínica.
  assert.equal(isUsableWhereId(undefined), false);
  assert.equal(isUsableWhereId(null), false);
  assert.equal(isUsableWhereId(""), false);
  assert.equal(isUsableWhereId("   "), false);
  assert.equal(isUsableWhereId(123), false);
  assert.equal(isUsableWhereId({}), false);
  assert.equal(isUsableWhereId("cl_inv_1"), true);
});

test("la trampa es real: sin la guarda, el where se queda solo con clinicId", () => {
  // Réplica del comportamiento documentado de Prisma: las claves con `undefined`
  // se descartan del where.
  const prismaWhere = (w: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined));

  const sinGuarda = prismaWhere({ id: undefined, clinicId: "cl_1" });
  assert.deepEqual(sinGuarda, { clinicId: "cl_1" }); // ← devolvía cualquier factura
  assert.equal(Object.hasOwn(sinGuarda, "id"), false);
});

test("POST /api/cfdi valida el invoiceId ANTES de tocar la base", () => {
  const route = src("src/app/api/cfdi/route.ts");
  assert.ok(route.includes("isUsableWhereId(invoiceId)"),
    "cfdi/route.ts tiene que validar invoiceId con isUsableWhereId");
  assert.ok(
    route.indexOf("isUsableWhereId(invoiceId)") < route.indexOf("prisma.invoice.findFirst"),
    "la validación tiene que ir ANTES del findFirst que elige la factura a timbrar");
});

// ── Hallazgo 19 · el IVA del CFDI se calcula POR CONCEPTO ──────────────────

const ocho = Array.from({ length: 8 }, (_, i) => ({
  description: `Resina ${i + 1}`, quantity: 1, unitPrice: 333.33,
}));

test("con IVA agregado el total esperado es el del SAT: IVA por concepto, no sobre la base", () => {
  // Por concepto: base 333.33 → IVA round2(53.3328) = 53.33; ocho veces.
  //   base 2,666.64 + IVA 426.64 = 3,093.28   ← lo que Facturapi timbra
  // Sobre la base agregada: round2(2,666.64 × 1.16) = 3,093.30 ← lo que se
  // calculaba antes, y NO es el importe del comprobante fiscal.
  assert.equal(expectedCfdiTotal(ocho, 0, "iva16", false), 3093.28);

  // El total INTERNO sigue saliendo del criterio agregado (computeInvoiceTotal
  // lo comparten ocho rutas que no son de esta tarea): 2¢ de diferencia, que es
  // exactamente lo que absorbe la tolerancia de la guarda (0.01 + 0.01 × líneas).
  const interno = computeInvoiceTotal(2666.64, 0, 16, false).total;
  assert.equal(interno, 3093.30);
  assert.equal(Math.round(Math.abs(interno - 3093.28) * 100) / 100, 0.02);
  assert.ok(0.02 <= 0.01 + 0.01 * ocho.length);
});

test("el desglose por concepto es el que se manda en el payload", () => {
  const b = cfdiTotalBreakdown(ocho, 0, "iva16", false);
  assert.equal(b.bases[0], 333.33);
  assert.equal(b.base, 2666.64);
  assert.equal(b.tax, 426.64);
  assert.equal(b.total, 3093.28);
});

test("exento e IVA incluido no cambian: el total es la base", () => {
  assert.equal(expectedCfdiTotal(ocho, 0, "exento", false), 2666.64);
  assert.equal(expectedCfdiTotal(ocho, 0, "iva16", true), 2666.64);
});

test("el descuento de factura se prorratea igual que en el payload del CFDI", () => {
  const items = [
    { description: "Corona", quantity: 1, unitPrice: 1000 },
    { description: "Limpieza", quantity: 1, unitPrice: 500 },
  ];
  // spreadInvoiceDiscount reparte 100 → 66.67 y 33.33 (las mismas líneas que se
  // mandan a Facturapi), así que las bases son 933.33 y 466.67.
  const b = cfdiTotalBreakdown(items, 100, "iva16", false);
  assert.equal(b.bases[0], 933.33);
  assert.equal(b.bases[1], 466.67);
  assert.equal(b.base, 1400);
  assert.equal(b.tax, 224);
  assert.equal(b.total, 1624);
});

// ── Hallazgo 20 · el comprobante impreso tiene que cuadrar ─────────────────

test("con IVA agregado el impreso saca un renglón de IVA que cuadra el documento", () => {
  // Conceptos $1,000, descuento $100 → total 1,044.00. Las líneas impresas
  // suman 1,000: sin el renglón de IVA el documento no cuadra por $144.
  const t = invoicePrintTotals({ subtotal: 1000, discount: 100, total: 1044, taxRate: 16, taxIncluded: false });
  assert.equal(t.base, 900);
  assert.equal(t.discount, 100);
  assert.equal(t.tax, 144);
  assert.equal(t.rate, 16);
  assert.equal(t.base + t.tax, t.total); // los renglones SUMAN el TOTAL impreso
});

test("con IVA incluido (y sin IVA) no se inventa renglón: las líneas ya suman el total", () => {
  assert.equal(invoicePrintTotals({ subtotal: 1000, discount: 0, total: 1000, taxRate: 16, taxIncluded: true }).tax, 0);
  assert.equal(invoicePrintTotals({ subtotal: 1000, discount: 0, total: 1000, taxRate: 0, taxIncluded: false }).tax, 0);
});

test("el comprobante lee taxRate/taxIncluded e imprime el renglón", () => {
  const pdf = src("src/lib/invoices/print-pdf.tsx");
  assert.ok(/taxRate:\s*true/.test(pdf) && /taxIncluded:\s*true/.test(pdf),
    "el select del comprobante tiene que traer taxRate y taxIncluded");
  assert.ok(pdf.includes("invoicePrintTotals"), "el comprobante tiene que derivar sus renglones de invoicePrintTotals");
  assert.ok(pdf.includes("IVA ("), "el comprobante tiene que imprimir el renglón de IVA");
});

// ── Hallazgo 21 · las pantallas de dinero no borran los centavos ───────────

test("formatCurrency redondea a pesos; fmtMXNdec es el de la lista de facturas", () => {
  assert.ok(!formatCurrency(2447.25).includes("."), "formatCurrency sigue siendo el de pesos enteros (KPIs y gráficas)");
  assert.equal(fmtMXNdec(2447.25), "$2,447.25");
  assert.equal(fmtMXNdec(0.5), "$0.50");
});

for (const modal of [
  "src/components/dashboard/billing/invoice-detail-modal.tsx",
  "src/components/dashboard/billing/payment-modal.tsx",
]) {
  test(`${modal.split("/").pop()} enseña el dinero con centavos`, () => {
    const code = src(modal);
    assert.ok(/import\s*\{\s*fmtMXNdec\s*\}\s*from\s*"@\/lib\/format"/.test(code),
      "tiene que importar fmtMXNdec de @/lib/format, igual que la lista de facturas");
    assert.ok(!/import\s*\{[^}]*\bformatCurrency\b[^}]*\}\s*from\s*"@\/lib\/utils"/.test(code),
      "ya no puede importar formatCurrency");
    assert.ok(!code.includes("formatCurrency("),
      "ninguna cifra de dinero del modal puede seguir formateándose con formatCurrency");
  });
}
