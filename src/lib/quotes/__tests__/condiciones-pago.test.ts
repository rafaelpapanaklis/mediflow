/**
 * Presupuesto nuevo (WS1-T8) — las pruebas del DINERO.
 *
 * Run: npm run test:presupuesto-pagos
 *
 * Las dos que pidió Rafael, y las que hicieron falta para sostenerlas:
 *
 *  1. EL TOTAL QUE VE EL PACIENTE ES EL QUE SE COBRA. El número grande del
 *     editor sale de `totalACobrar`, que es `invoiceFieldsFromQuote` — la misma
 *     función con la que el servidor arma la factura. Se comprueba con el
 *     camino REAL de los datos (computeTotals → QuoteItem → factura), no con
 *     una suma paralela, que es justo lo que produce desfases de centavos.
 *
 *  2. LAS MENSUALIDADES SUMAN EXACTAMENTE EL TOTAL. Los centavos que sobran al
 *     dividir van a algún pago; ninguno se pierde ni se inventa. Se prueba con
 *     fuerza bruta sobre miles de combinaciones, no con tres ejemplos.
 *
 *  3. El calendario cae en los días que dice. Un plan a 12 meses no se puede
 *     adelantar cinco días por sumar «30 días» doce veces.
 *
 *  4. Los métodos de pago son los SEIS del selector de cobros, no una lista
 *     nueva inventada para esta pantalla.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeTotals } from "../compute";
import { invoiceFieldsFromQuote } from "../invoice-from-quote-core";
import { computeInvoiceTotal } from "@/lib/invoice-totals";
import {
  METODOS_PAGO,
  aCentavos,
  calcularCalendario,
  condicionesPorDefecto,
  fechaCorta,
  frasePlan,
  hayCondiciones,
  normalizarCondiciones,
  planParaDocumento,
  PAGOS_SUGERIDOS,
  repartirCentavos,
  sumarPeriodos,
  totalACobrar,
  type CondicionesPago,
} from "../condiciones-pago";
import type { QuoteItemInput } from "../types";

const RAIZ = join(__dirname, "..", "..", "..", "..");

/**
 * El camino real de los datos: el editor manda líneas → `computeTotals` las
 * normaliza → `buildItemsData` (service.ts) guarda ESA salida en QuoteItem →
 * `invoiceFieldsFromQuote` lee esas filas para armar la factura. Encadenarlos
 * aquí es lo único que prueba algo.
 */
function caminoReal(items: QuoteItemInput[], opts: { discountPct?: number | null; discountAmount?: number | null } = {}) {
  const quote = computeTotals(items, {
    discountPct: opts.discountPct ?? null,
    discountAmount: opts.discountAmount ?? null,
  });
  const guardado = {
    discountAmount: quote.discountAmount,
    items: quote.items.map((it) => ({
      name: it.name,
      toothFdi: it.toothFdi ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: it.discount,
    })),
  };
  return { quote, factura: invoiceFieldsFromQuote(guardado), pantalla: totalACobrar(guardado) };
}

// ═══ 1 · El total con impuestos es el que se guarda al facturar ═══════

test("el total que enseña el editor es, al centavo, el que va a quedar en la factura", () => {
  const casos: QuoteItemInput[][] = [
    [{ name: "Corona de zirconia", quantity: 1, unitPrice: 8500 }],
    [
      { name: "Endodoncia", quantity: 1, unitPrice: 4500, discount: 500 },
      { name: "Poste de fibra", quantity: 2, unitPrice: 1250.55 },
      { name: "Corona", quantity: 3, unitPrice: 8333.33, discount: 1111.11 },
    ],
    [
      { name: "Limpieza", quantity: 4, unitPrice: 0.01 },
      { name: "Resina", quantity: 7, unitPrice: 999.99, discount: 0.07 },
    ],
  ];
  casos.forEach((items) => {
    [null, 13.37, 0, 100].forEach((pct) => {
      const { quote, factura, pantalla } = caminoReal(items, { discountPct: pct });
      assert.equal(pantalla.total, factura.total, `pantalla ≠ factura con pct=${pct}`);
      assert.equal(pantalla.subtotal, factura.subtotal);
      assert.equal(pantalla.descuento, factura.discount);
      // Y la columna que se guarda en el propio presupuesto tampoco se separa.
      assert.equal(quote.total, factura.total, `quotes.total ≠ invoices.total con pct=${pct}`);
    });
  });
});

test("el presupuesto no lleva IVA agregado: la factura derivada nace con el impuesto INCLUIDO", () => {
  // La columna Invoice.taxIncluded nace en `true` y taxRate en 16
  // (prisma/schema.prisma). Con el IVA incluido en el precio, el total ES la
  // base: por eso el presupuesto y la factura pueden coincidir al centavo.
  // Si alguien cambiara ese default a "IVA agregado", el total de la factura
  // pasaría a ser base × 1.16 y ESTA prueba es la que tiene que enterarse.
  const esquema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const modelo = /model Invoice \{[\s\S]*?\n\}/.exec(esquema)?.[0] ?? "";
  assert.match(modelo, /taxIncluded\s+Boolean\s+@default\(true\)/, "Invoice.taxIncluded ya no nace en true");

  const { factura } = caminoReal([{ name: "Corona", quantity: 1, unitPrice: 10000 }]);
  const conIvaIncluido = computeInvoiceTotal(factura.items, factura.discount, 16, true);
  assert.equal(conIvaIncluido.total, factura.total);
  assert.equal(conIvaIncluido.tax, 0);
});

test("un descuento global que se pasa del subtotal no deja la factura en negativo", () => {
  const { quote, factura, pantalla } = caminoReal(
    [{ name: "Corona", quantity: 1, unitPrice: 1000 }],
    { discountAmount: 99999 },
  );
  assert.equal(quote.total, 0);
  assert.equal(factura.total, 0);
  assert.equal(pantalla.total, 0);
});

// ═══ 2 · La suma de las mensualidades es EXACTAMENTE el total ═════════

function condiciones(p: Partial<CondicionesPago>): CondicionesPago {
  return { ...condicionesPorDefecto(), modo: "plazos", numPagos: PAGOS_SUGERIDOS, ...p };
}

test("repartirCentavos no pierde ni inventa un solo centavo, para ningún reparto", () => {
  for (let total = 0; total <= 1200; total++) {
    for (let n = 1; n <= 24; n++) {
      const partes = repartirCentavos(total, n);
      assert.equal(partes.length, n);
      assert.equal(partes.reduce((a, b) => a + b, 0), total, `${total}¢ entre ${n}`);
      // Nunca se parte un centavo, y entre la parte mayor y la menor no puede
      // haber más de 1¢: si no, el «plan parejo» dejaría de serlo.
      partes.forEach((p) => assert.ok(Number.isInteger(p) && p >= 0));
      assert.ok(Math.max(...partes) - Math.min(...partes) <= 1);
    }
  }
});

test("la suma de las mensualidades es exactamente el total — con enganche y sin él", () => {
  // Los importes que de verdad salen de una clínica: los que no se dividen
  // limpio entre 3, entre 6 ni entre 7.
  const totales = [30000, 29999.99, 10000, 1000.01, 8333.33, 0.03, 0.01, 47850.77, 100];
  const enganches = [0, 5000, 0.01, 29999.99, 99999];
  const numeros = [2, 3, 6, 7, 12, 13, 24, 60];

  totales.forEach((total) => {
    enganches.forEach((enganche) => {
      numeros.forEach((numPagos) => {
        const c = condiciones({ enganche, numPagos, primerPago: "2026-10-01" });
        const cal = calcularCalendario(total, c);
        assert.equal(
          cal.suma,
          cal.total,
          `total ${total} · enganche ${enganche} · ${numPagos} pagos → suma ${cal.suma}`,
        );
        // En centavos enteros, que es donde de verdad tiene que cuadrar.
        const sumaC = cal.pagos.reduce((a, p) => a + aCentavos(p.monto), 0);
        assert.equal(sumaC, aCentavos(total));
        // Ningún pago negativo ni de más de lo que queda.
        cal.pagos.forEach((p) => assert.ok(p.monto >= 0, `pago negativo: ${p.monto}`));
      });
    });
  });
});

test("un enganche que se come el presupuesto entero no fabrica mensualidades de $0", () => {
  const cal = calcularCalendario(5000, condiciones({ enganche: 5000, numPagos: 6 }));
  assert.equal(cal.pagos.length, 1);
  assert.equal(cal.pagos[0].esEnganche, true);
  assert.equal(cal.suma, 5000);
});

test("modo «un pago» devuelve un solo pago por el total", () => {
  const cal = calcularCalendario(12345.67, { ...condicionesPorDefecto(), metodo: "credit" });
  assert.equal(cal.pagos.length, 1);
  assert.equal(cal.pagos[0].monto, 12345.67);
  assert.equal(cal.suma, cal.total);
});

test("el ejemplo que se le cuenta al paciente sale con el número redondo", () => {
  const cal = calcularCalendario(30000, condiciones({ numPagos: 6, primerPago: "2026-10-01" }));
  assert.equal(cal.pagos.length, 6);
  cal.pagos.forEach((p) => assert.equal(p.monto, 5000));
  assert.equal(
    frasePlan(30000, condiciones({ numPagos: 6, primerPago: "2026-10-01" })),
    "6 pagos mensuales de $5,000.00, el primero el 1 de octubre de 2026",
  );
});

test("cuando no divide exacto, la frase dice cuántos pagos llevan el centavo de más", () => {
  // 10,000 entre 3 = 3,333.333… → 3,333.34 + 3,333.33 + 3,333.33.
  const c = condiciones({ numPagos: 3, primerPago: "2026-10-01" });
  const cal = calcularCalendario(10000, c);
  assert.deepEqual(cal.pagos.map((p) => p.monto), [3333.34, 3333.33, 3333.33]);
  assert.equal(cal.suma, 10000);
  assert.equal(cal.parejo, false);
  assert.match(frasePlan(10000, c), /\$3,333\.33 \(el primero, de \$3,333\.34\)/);
});

test("con enganche, la frase lo dice y las mensualidades salen del resto", () => {
  const c = condiciones({ enganche: 6000, numPagos: 4, primerPago: "2026-10-05" });
  const cal = calcularCalendario(30000, c);
  assert.equal(cal.pagos[0].esEnganche, true);
  assert.equal(cal.pagos[0].monto, 6000);
  assert.deepEqual(cal.pagos.slice(1).map((p) => p.monto), [6000, 6000, 6000, 6000]);
  assert.equal(cal.suma, 30000);
  assert.match(frasePlan(30000, c), /^Enganche de \$6,000\.00 y 4 pagos mensuales de \$6,000\.00/);
});

// ═══ 3 · Las fechas caen donde dicen ══════════════════════════════════

test("mensual quiere decir el mismo día del mes siguiente, no «+30 días»", () => {
  assert.equal(sumarPeriodos("2026-01-15", "MONTHLY", 1), "2026-02-15");
  assert.equal(sumarPeriodos("2026-01-15", "MONTHLY", 12), "2027-01-15");
  // Doce veces «+30 días» habría dado el 11 de enero: cinco días de adelanto.
});

test("el 31 cae en el último día del mes que no tiene 31", () => {
  assert.equal(sumarPeriodos("2026-01-31", "MONTHLY", 1), "2026-02-28");
  assert.equal(sumarPeriodos("2028-01-31", "MONTHLY", 1), "2028-02-29"); // bisiesto
  assert.equal(sumarPeriodos("2026-01-31", "MONTHLY", 3), "2026-04-30");
  // Y no se "pega" al 28: cada cuota se calcula desde la fecha original.
  assert.equal(sumarPeriodos("2026-01-31", "MONTHLY", 2), "2026-03-31");
});

test("semanal y quincenal son 7 y 14 días exactos, y cruzan el fin de año", () => {
  assert.equal(sumarPeriodos("2026-12-28", "WEEKLY", 1), "2027-01-04");
  assert.equal(sumarPeriodos("2026-12-28", "BIWEEKLY", 1), "2027-01-11");
});

test("la primera mensualidad es la fecha fijada; con enganche, cae un periodo después", () => {
  const sinEnganche = calcularCalendario(3000, condiciones({ numPagos: 3, primerPago: "2026-10-01" }));
  assert.deepEqual(sinEnganche.pagos.map((p) => p.fecha), ["2026-10-01", "2026-11-01", "2026-12-01"]);

  const conEnganche = calcularCalendario(4000, condiciones({ enganche: 1000, numPagos: 3, primerPago: "2026-10-01" }));
  assert.deepEqual(conEnganche.pagos.map((p) => p.fecha), ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]);
});

// ═══ 4 · Saneo y métodos ══════════════════════════════════════════════

test("los métodos son los SEIS del selector de cobros, ni uno más", () => {
  const modal = readFileSync(
    join(RAIZ, "src", "components", "dashboard", "billing", "payment-modal.tsx"),
    "utf8",
  );
  const linea = /export type PaymentMethod =([^;]+);/.exec(modal)?.[1] ?? "";
  const delModal = Array.from(linea.matchAll(/"([a-z]+)"/g)).map((m) => m[1]);
  assert.deepEqual([...METODOS_PAGO], delModal);
});

test("normalizar acota lo que manda el cliente y nunca lanza", () => {
  // Basura entera → las condiciones de hoy (un pago, sin método).
  [null, undefined, 42, "texto", []].forEach((basura) => {
    assert.deepEqual(normalizarCondiciones(basura, 1000), condicionesPorDefecto());
  });

  // El enganche no puede pasarse del total ni ser negativo.
  assert.equal(normalizarCondiciones({ modo: "plazos", enganche: 99999 }, 1000).enganche, 1000);
  assert.equal(normalizarCondiciones({ modo: "plazos", enganche: -500 }, 1000).enganche, 0);

  // El número de pagos se acota a [2, 60]. Un 1 es "pago único mal escrito":
  // sube al mínimo. Un 0 o una basura no dicen nada: caen en la sugerencia.
  assert.equal(normalizarCondiciones({ modo: "plazos", numPagos: 1 }, 1000).numPagos, 2);
  assert.equal(normalizarCondiciones({ modo: "plazos", numPagos: 0 }, 1000).numPagos, PAGOS_SUGERIDOS);
  assert.equal(normalizarCondiciones({ modo: "plazos", numPagos: "x" }, 1000).numPagos, PAGOS_SUGERIDOS);
  assert.equal(normalizarCondiciones({ modo: "plazos", numPagos: -4 }, 1000).numPagos, PAGOS_SUGERIDOS);
  assert.equal(normalizarCondiciones({ modo: "plazos", numPagos: 999 }, 1000).numPagos, 60);
  assert.equal(normalizarCondiciones({ modo: "plazos", numPagos: 6.9 }, 1000).numPagos, 6);

  // Un método inventado no entra.
  assert.equal(normalizarCondiciones({ metodo: "bitcoin" }, 1000).metodo, null);
  assert.equal(normalizarCondiciones({ metodo: "transfer" }, 1000).metodo, "transfer");

  // Una frecuencia desconocida cae en mensual.
  assert.equal(normalizarCondiciones({ modo: "plazos", frecuencia: "DIARIA" }, 1000).frecuencia, "MONTHLY");

  // Fechas imposibles se descartan en vez de correr el calendario.
  assert.equal(normalizarCondiciones({ primerPago: "2026-02-31" }, 1000).primerPago, null);
  assert.equal(normalizarCondiciones({ primerPago: "mañana" }, 1000).primerPago, null);
  assert.equal(normalizarCondiciones({ primerPago: "2026-10-01T00:00:00.000Z" }, 1000).primerPago, "2026-10-01");
});

test("«lo difiere con su banco» solo se guarda donde significa algo", () => {
  // Un pago con tarjeta de crédito: sí.
  assert.equal(
    normalizarCondiciones({ modo: "unico", metodo: "credit", difiereConSuBanco: true }, 1000).difiereConSuBanco,
    true,
  );
  // En efectivo no hay banco que difiera nada.
  assert.equal(
    normalizarCondiciones({ modo: "unico", metodo: "cash", difiereConSuBanco: true }, 1000).difiereConSuBanco,
    false,
  );
  // Y sobre el financiamiento de la clínica NO se puede marcar: eso sería
  // prometer «meses sin intereses» sobre un plan que no pasa por ningún banco.
  assert.equal(
    normalizarCondiciones({ modo: "plazos", metodo: "credit", difiereConSuBanco: true }, 1000).difiereConSuBanco,
    false,
  );
});

test("en ninguna parte del módulo se promete «meses sin intereses»", () => {
  // El término tiene significado bancario y legal. El panel no puede dividir un
  // cargo a MSI (lo hace el banco emisor desde la terminal o la pasarela), así
  // que no lo dice: dice «pagos mensuales».
  const fuentes = [
    "src/lib/quotes/condiciones-pago.ts",
    "src/lib/quotes/condiciones-pago-db.ts",
  ];
  fuentes.forEach((f) => {
    const texto = readFileSync(join(RAIZ, f), "utf8");
    // Solo se permite nombrarlo en comentarios que EXPLICAN por qué no se ofrece.
    const codigo = texto
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    assert.doesNotMatch(codigo, /sin intereses/i, `${f} promete MSI en código vivo`);
    assert.doesNotMatch(codigo, /\bMSI\b/, `${f} promete MSI en código vivo`);
  });
});

test("la vigencia se lee en el día que es, no un día antes", () => {
  // El editor guarda la fecha elegida como medianoche UTC. Pintarla con
  // `toLocaleDateString` en México (UTC−6) la corría un día hacia atrás: una
  // vigencia puesta al 16 de octubre se leía «15 oct» en la pantalla.
  assert.equal(fechaCorta("2026-10-16T00:00:00.000Z"), "16 oct 2026");
  assert.equal(fechaCorta("2027-01-01T00:00:00.000Z"), "1 ene 2027");
  assert.equal(fechaCorta(null), "—");
  assert.equal(fechaCorta("no es una fecha"), "—");
});

// ═══ 5 · Los cabos que encontró la revisión ══════════════════════════

test("nunca se emite una mensualidad de $0.00 en un documento del paciente", () => {
  // 3¢ a «6 pagos» imprimía tres cuotas de $0.01 y TRES DE $0.00 en el PDF que
  // firma el paciente. Se reparte entre las que pueden llevar algo.
  const cal = calcularCalendario(0.03, condiciones({ numPagos: 6 }));
  assert.equal(cal.pagos.length, 3);
  cal.pagos.forEach((p) => assert.ok(p.monto > 0, `cuota de ${p.monto}`));
  assert.equal(cal.suma, 0.03);

  // Y con un importe normal no cambia nada: 6 pagos siguen siendo 6.
  assert.equal(calcularCalendario(30000, condiciones({ numPagos: 6 })).pagos.length, 6);

  // Tampoco con enganche: el resto es 1¢, así que solo cabe una mensualidad.
  const conEnganche = calcularCalendario(100.01, condiciones({ enganche: 100, numPagos: 12 }));
  assert.equal(conEnganche.pagos.length, 2);
  assert.equal(conEnganche.suma, 100.01);
});

test("un enganche de menos de medio centavo no rebautiza la primera mensualidad", () => {
  // `c.enganche > 0` era cierto con 0.004, pero el calendario no emite fila de
  // enganche (se redondea a 0 centavos): la frase llamaba «Enganche» a la
  // primera mensualidad y el plan se leía al doble.
  const c = condiciones({ enganche: 0.004, numPagos: 6, primerPago: "2026-10-01" });
  const cal = calcularCalendario(30000, c);
  assert.equal(cal.pagos.length, 6);
  assert.equal(cal.pagos[0].esEnganche, false);
  assert.doesNotMatch(frasePlan(30000, c), /Enganche/);
  assert.equal(cal.suma, 30000);
});

test("unas condiciones de «un pago sin método» no son condiciones", () => {
  // Es exactamente el presupuesto de antes de WS1-T8: no merece fila propia en
  // la base, ni sección en el PDF, ni línea en la lista.
  assert.equal(hayCondiciones(condicionesPorDefecto()), false);
  assert.equal(hayCondiciones({ ...condicionesPorDefecto(), metodo: "cash" }), true);
  assert.equal(hayCondiciones({ ...condicionesPorDefecto(), modo: "plazos" }), true);
  assert.equal(hayCondiciones(null), false);
  // Y `planParaDocumento` no imprime nada con ellas.
  assert.equal(planParaDocumento(30000, condicionesPorDefecto()), null);
  assert.ok(planParaDocumento(30000, { ...condicionesPorDefecto(), metodo: "cash" }));
});

test("el plan impreso dice lo mismo que el calculado, cuota a cuota", () => {
  const c = condiciones({ enganche: 6000, numPagos: 6, metodo: "transfer", primerPago: "2026-10-01" });
  const cal = calcularCalendario(30150, c);
  const plan = planParaDocumento(30150, c);
  assert.ok(plan);
  assert.equal(plan.suma, cal.suma);
  assert.equal(plan.cuotas.length, cal.pagos.length);
  assert.equal(plan.metodo, "Transferencia");
  assert.deepEqual(plan.cuotas.map((x) => x.monto), cal.pagos.map((p) => p.monto));
  assert.equal(plan.cuotas[0].etiqueta, "Enganche");
  assert.equal(plan.cuotas[1].etiqueta, "Pago 1");
  // Y la suma impresa es el total, que es lo único que el papel tiene que probar.
  assert.equal(plan.cuotas.reduce((a, x) => a + aCentavos(x.monto), 0), aCentavos(30150));
});
