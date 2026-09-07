/**
 * Hallazgo 19 · el total GUARDADO se calcula con el criterio del SAT.
 *
 * Run: npm run test:iva-sat
 *
 * El CFDI manda `taxes` DENTRO de cada concepto y Facturapi redondea línea por
 * línea: Importe e Impuesto de cada concepto a 2 decimales, y el total es su
 * suma. `computeInvoiceTotal` calculaba el impuesto sobre la base AGREGADA
 * (`round2(base × tasa)`), que da un número distinto en cuanto hay varios
 * conceptos — el 34% de las facturas con IVA agregado, hasta 2¢ con 8 líneas.
 *
 * Lo que se fija aquí: pasándole los CONCEPTOS, el total interno y el que se
 * timbra son el MISMO número, en los tres modos de IVA. Y se deja constancia de
 * que el criterio viejo daba otro, para que revertirlo rompa la prueba en vez de
 * volver a colar la divergencia en silencio.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeInvoiceTotal,
  expectedCfdiTotal,
  invoiceLineBases,
  sumInvoiceItems,
  round2,
} from "../invoice-totals";
import { computeTotals } from "../quotes/compute";
import { invoiceFieldsFromQuote } from "../quotes/invoice-from-quote-core";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Total con el criterio VIEJO: el impuesto sobre la base agregada. */
const criterioViejo = (items: any[], discount: number, rate: number) => {
  const base = round2(Math.max(0, sumInvoiceItems(items) - round2(Math.max(0, discount))));
  return round2(base + round2(base * (rate / 100)));
};
/** Total con el criterio NUEVO, tal como lo va a guardar la factura. */
const criterioNuevo = (items: any[], discount: number, rate: number) =>
  computeInvoiceTotal(items, discount, rate, false).total;
/** Lo que Facturapi va a timbrar de verdad. */
const timbrado = (items: any[], discount: number) =>
  expectedCfdiTotal(items, discount, "iva16", false);

// ── El caso del hallazgo: 8 conceptos con centavos ─────────────────────────

const OCHO = Array.from({ length: 8 }, (_, i) => ({
  description: `Resina ${i + 1}`, quantity: 1, unitPrice: 333.33,
}));

test("8 conceptos de $333.33: el total guardado ES el que se timbra", () => {
  assert.equal(timbrado(OCHO, 0), 3093.28);            // lo que ve el SAT
  assert.equal(criterioNuevo(OCHO, 0, 16), 3093.28);   // lo que se guarda AHORA
  // Y el criterio viejo daba otro: si alguien revierte el arreglo, esto falla.
  assert.equal(criterioViejo(OCHO, 0, 16), 3093.30);
  assert.notEqual(criterioViejo(OCHO, 0, 16), timbrado(OCHO, 0));
});

test("los 2¢ del hallazgo ya no existen: la divergencia es 0", () => {
  const antes = round2(Math.abs(criterioViejo(OCHO, 0, 16) - timbrado(OCHO, 0)));
  const ahora = round2(Math.abs(criterioNuevo(OCHO, 0, 16) - timbrado(OCHO, 0)));
  assert.equal(antes, 0.02);
  assert.equal(ahora, 0);
});

// ── Varias facturas de varios conceptos: coinciden SIEMPRE ─────────────────

/** Casos duros escritos a mano: centavos que arrastran redondeo por línea. */
const CASOS: Array<{ nombre: string; items: any[]; discount: number }> = [
  { nombre: "8 × 333.33", items: OCHO, discount: 0 },
  { nombre: "8 × 333.33 con descuento global de $100", items: OCHO, discount: 100 },
  {
    nombre: "8 conceptos con centavos distintos",
    items: [850.5, 1200.99, 450.25, 99.9, 2750.75, 180.33, 615.67, 75.55]
      .map((p, i) => ({ description: `S${i}`, quantity: 1, unitPrice: p })),
    discount: 0,
  },
  {
    nombre: "cantidades > 1 y precios con centavos",
    items: [
      { description: "Limpieza", quantity: 3, unitPrice: 333.33 },
      { description: "Resina",   quantity: 2, unitPrice: 1499.99 },
      { description: "Rx",       quantity: 7, unitPrice: 45.45 },
      { description: "Consulta", quantity: 1, unitPrice: 990.01 },
    ],
    discount: 0,
  },
  {
    nombre: "descuento de línea + descuento global (prorrateo)",
    items: [
      { description: "A", quantity: 1, unitPrice: 1200.99, discount: 55.55 },
      { description: "B", quantity: 2, unitPrice: 333.33 },
      { description: "C", quantity: 1, unitPrice: 615.67, discount: 15.15 },
      { description: "D", quantity: 4, unitPrice: 180.33 },
      { description: "E", quantity: 1, unitPrice: 99.9 },
    ],
    discount: 237.77,
  },
  {
    nombre: "céntimos sueltos (0.01, 0.03)",
    items: [0.01, 0.03, 0.07, 33.34, 7.77, 0.05]
      .map((p, i) => ({ description: `c${i}`, quantity: 1, unitPrice: p })),
    discount: 0,
  },
  { nombre: "un solo concepto (nunca divergió)", items: [{ description: "U", quantity: 1, unitPrice: 1000 }], discount: 0 },
];

test("en todos los casos duros, el total guardado y el timbrado son el mismo", () => {
  const divergentes: string[] = [];
  for (const c of CASOS) {
    assert.equal(
      criterioNuevo(c.items, c.discount, 16),
      timbrado(c.items, c.discount),
      `«${c.nombre}»: el total guardado no cuadra con el timbrado`,
    );
    if (criterioViejo(c.items, c.discount, 16) !== timbrado(c.items, c.discount)) {
      divergentes.push(c.nombre);
    }
  }
  // La prueba no puede ser vacía: al menos un caso TIENE que separar los dos
  // criterios, si no pasaría igual con el código viejo y no probaría nada.
  assert.ok(
    divergentes.length >= 3,
    `pocos casos separan los dos criterios (${divergentes.length}): la prueba no demuestra el arreglo`,
  );
});

test("barrido determinista de 20 000 facturas: cero divergencias", () => {
  let s = 20260907;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const PRECIOS = [333.33, 850.5, 1200.99, 450.25, 99.9, 2750.75, 180.33, 615.67, 1499.99, 75.55, 990.01, 45.45];

  let malNuevo = 0;
  let malViejo = 0;
  for (let i = 0; i < 20_000; i++) {
    const n = 1 + Math.floor(rnd() * 8);
    const items = Array.from({ length: n }, () => ({
      description: "Servicio",
      quantity: [1, 1, 1, 2, 3][Math.floor(rnd() * 5)],
      unitPrice: PRECIOS[Math.floor(rnd() * PRECIOS.length)],
    }));
    const sub = sumInvoiceItems(items);
    const discount = rnd() < 0.25 ? round2(sub * 0.1) : 0;
    const esperado = timbrado(items, discount);
    if (criterioNuevo(items, discount, 16) !== esperado) malNuevo++;
    if (criterioViejo(items, discount, 16) !== esperado) malViejo++;
  }
  assert.equal(malNuevo, 0, "el criterio nuevo tiene que cuadrar con el timbrado SIEMPRE");
  // ~34% de divergencia con el criterio viejo: es el hallazgo, medido.
  assert.ok(malViejo > 5_000, `el criterio viejo divergía en ${malViejo}/20000, se esperaban muchos más`);
});

// ── Los tres modos de IVA ──────────────────────────────────────────────────

test("IVA agregado: impuesto por concepto y suma", () => {
  const r = computeInvoiceTotal(OCHO, 0, 16, false);
  assert.equal(r.base, 2666.64);
  assert.equal(r.tax, 426.64);          // Σ round2(333.33 × 0.16) = 8 × 53.33
  assert.equal(r.total, 3093.28);
  assert.equal(r.total, timbrado(OCHO, 0));
});

test("IVA incluido: el total es la base, igual que el CFDI", () => {
  const r = computeInvoiceTotal(OCHO, 0, 16, true);
  assert.equal(r.tax, 0);
  assert.equal(r.total, 2666.64);
  assert.equal(r.total, expectedCfdiTotal(OCHO, 0, "iva16", true));
});

test("exento (tasa 0): el total es la base, igual que el CFDI", () => {
  const r = computeInvoiceTotal(OCHO, 0, 0, false);
  assert.equal(r.tax, 0);
  assert.equal(r.total, 2666.64);
  assert.equal(r.total, expectedCfdiTotal(OCHO, 0, "exento", false));
});

// ── El presupuesto NO se mueve (hallazgo 15, que no vuelva) ────────────────

test("el paciente firma un número y se le cobra ESE: presupuesto = factura", () => {
  const quoteItems = [
    { name: "Resina", toothFdi: "16", quantity: 2, unitPrice: 1200.99, discount: 55.55 },
    { name: "Limpieza", toothFdi: null, quantity: 1, unitPrice: 850.5 },
    { name: "Endodoncia", toothFdi: "36", quantity: 1, unitPrice: 4333.33 },
    { name: "Rx", toothFdi: null, quantity: 4, unitPrice: 180.33 },
  ];
  const q = computeTotals(quoteItems as any, { discountAmount: 500 });
  const inv = invoiceFieldsFromQuote({ discountAmount: 500, items: quoteItems as any });

  // El total del presupuesto es el de la factura derivada — sin IVA de por medio.
  assert.equal(inv.total, q.total);
  // Y el CFDI de esa factura (exenta, que es el default dental) sale por lo mismo.
  assert.equal(expectedCfdiTotal(inv.items, inv.discount, "exento", false), q.total);
  // Recalcular ese total con el criterio nuevo tampoco lo mueve: rate 0 → sin IVA.
  assert.equal(computeInvoiceTotal(inv.items, inv.discount, 0, true).total, q.total);
});

test("una clínica con IVA 16% incluido tampoco separa presupuesto y factura", () => {
  const quoteItems = [
    { name: "Corona", toothFdi: "11", quantity: 3, unitPrice: 2750.75 },
    { name: "Consulta", toothFdi: null, quantity: 1, unitPrice: 615.67 },
    { name: "Provisional", toothFdi: "12", quantity: 5, unitPrice: 333.33 },
  ];
  const q = computeTotals(quoteItems as any, { discountPct: 10 });
  const inv = invoiceFieldsFromQuote({ discountAmount: q.discountAmount, items: quoteItems as any });
  // clinicInvoiceTaxDefaults("iva16") → { taxRate: 16, taxIncluded: true }
  assert.equal(computeInvoiceTotal(inv.items, inv.discount, 16, true).total, q.total);
  assert.equal(expectedCfdiTotal(inv.items, inv.discount, "iva16", true), q.total);
});

// ── El camino LEGADO (por suma) sigue dando el criterio viejo ──────────────

test("pasando la SUMA se conserva el criterio agregado: las facturas ya guardadas no se mueven", () => {
  // Es lo que hace que la alerta de cfdi-timbrado-alerta siga viendo divergir a
  // las facturas nacidas antes del arreglo, en vez de taparlas.
  assert.equal(computeInvoiceTotal(333.33 * 8, 0, 16, false).total, 3093.30);
  assert.notEqual(computeInvoiceTotal(333.33 * 8, 0, 16, false).total, timbrado(OCHO, 0));
});

// ── Por FUENTE: que el cableado no se revierta en silencio ─────────────────

test("computeInvoiceTotal y el CFDI comparten las bases por concepto", () => {
  const s = src("src/lib/invoice-totals.ts");
  const cuerpo = s.slice(s.indexOf("export function computeInvoiceTotal"));
  assert.match(
    cuerpo.slice(0, cuerpo.indexOf("export function", 10)),
    /invoiceLineBases\(/,
    "computeInvoiceTotal tiene que calcular el IVA sobre las bases POR CONCEPTO",
  );
  const cfdi = s.slice(s.indexOf("export function cfdiTotalBreakdown"));
  assert.match(
    cfdi.slice(0, cfdi.indexOf("export function", 10)),
    /invoiceLineBases\(/,
    "cfdiTotalBreakdown tiene que usar las MISMAS bases que el total interno",
  );
});

test("invoiceLineBases reparte el descuento global como el payload del CFDI", () => {
  const bases = invoiceLineBases(OCHO, 100);
  assert.equal(bases.length, 8);
  assert.equal(round2(bases.reduce((a, b) => a + b, 0)), round2(333.33 * 8 - 100));
});

test("las rutas que GUARDAN el total le pasan los conceptos, no la suma", () => {
  // Sin esto, el helper puede estar perfecto y la factura seguir guardándose con
  // el criterio agregado: es justo el estado en el que quedó el hallazgo 19 a
  // medias. Se comprueba por FUENTE, ruta por ruta.
  const rutas: Array<[string, RegExp]> = [
    ["src/app/api/invoices/route.ts", /computeInvoiceTotal\(data\.items,/],
    ["src/app/api/invoices/[id]/route.ts", /computeInvoiceTotal\(items,/],
    ["src/app/api/invoices/[id]/edit-price/route.ts", /computeInvoiceTotal\(newItems,/],
  ];
  for (const [ruta, re] of rutas) {
    assert.match(src(ruta), re, `${ruta} tiene que pasar los CONCEPTOS a computeInvoiceTotal`);
  }
  // edit-price tiene DOS ramas (editar precio / solo descuento) y las dos cuentan.
  const editPrice = src("src/app/api/invoices/[id]/edit-price/route.ts");
  assert.equal(
    (editPrice.match(/computeInvoiceTotal\(newItems,/g) ?? []).length, 2,
    "las dos ramas de edit-price tienen que calcular por concepto",
  );
  // Y que no quede ningún sitio guardando el total con el criterio agregado.
  for (const [ruta] of rutas) {
    assert.doesNotMatch(
      src(ruta), /computeInvoiceTotal\((subtotal|newSubtotal|keptSum),/,
      `${ruta} sigue pasando una SUMA: eso reintroduce la divergencia del hallazgo 19`,
    );
  }
});

test("«Editar precio»: el total guardado sigue cuadrando con el CFDI (línea de ajuste incluida)", () => {
  // Réplica de la rama `totalIn` de edit-price: al SUBIR el precio se añade una
  // línea "Ajuste de precio" sintética, y el IVA por concepto también corre
  // sobre ella. Lo que tiene que seguir siendo cierto es la invariante: el total
  // guardado es EXACTAMENTE el que se va a timbrar.
  const baseItems = [
    { description: "Corona", quantity: 1, unitPrice: 2750.75 },
    { description: "Consulta", quantity: 2, unitPrice: 615.67 },
    { description: "Rx", quantity: 3, unitPrice: 180.33 },
  ];
  const itemsSum = sumInvoiceItems(baseItems);

  // Subir el precio → línea de ajuste.
  const targetArriba = round2(6000 / 1.16);
  const conAjuste = [...baseItems, {
    description: "Ajuste de precio", quantity: 1,
    unitPrice: round2(targetArriba - itemsSum), total: round2(targetArriba - itemsSum),
  }];
  assert.equal(
    computeInvoiceTotal(conAjuste, 0, 16, false).total,
    expectedCfdiTotal(conAjuste, 0, "iva16", false),
  );

  // Bajar el precio → descuento explícito, los conceptos no se tocan.
  const targetAbajo = round2(3000 / 1.16);
  const descuento = round2(itemsSum - targetAbajo);
  assert.equal(
    computeInvoiceTotal(baseItems, descuento, 16, false).total,
    expectedCfdiTotal(baseItems, descuento, "iva16", false),
  );
});
