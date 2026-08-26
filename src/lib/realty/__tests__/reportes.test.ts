// ═══════════════════════════════════════════════════════════════════════
// REPORTES — la aritmética del dinero y la lectura de lo que dijeron.
//
// Todo lo que se prueba aquí es PURO: sin Postgres, sin navegador, sin
// sesión, sin `server-only`. Corre en medio segundo y NO necesita el hook
// de offline.mjs, porque owner-report.ts se diseñó client-safe justo para
// que la pantalla, el PDF y la hoja de cálculo compartan el cálculo.
//
//   npx tsx --test src/lib/realty/__tests__/reportes.test.ts
//
// Lo que cubre y POR QUÉ:
//
//   · 🔴 NO SE SUMAN PESOS CON DÓLARES. Es LA regla del archivo y la que ya
//     costó un bug en cobranza (commit 2ba44ae6). Aquí se comprueba que un
//     importe en USD nunca cae en el cajón de MXN, que ningún porcentaje
//     sale cruzando monedas, y que la hoja de cálculo las manda a COLUMNAS
//     distintas — si compartieran columna, el primer =SUMA() que alguien
//     escriba en Excel produce el número inventado que todo esto existe
//     para evitar.
//   · CENTAVOS ENTEROS. 0.10 + 0.20 tiene que dar 30, no 30.000000000000004.
//   · EL RENDIMIENTO. El caso del enunciado (12 000/mes, 2 000 de gasto,
//     valor 2 000 000 = 6 % anual) y los casos en los que el porcentaje NO
//     se emite, en vez de emitir uno falso.
//   · LA NEGACIÓN. "no está caro" NO es una queja de precio y "no les
//     gustó" NO es que les gustó. De ese booleano cuelga el titular que le
//     dice al propietario que baje el precio: contarlo al revés es
//     recomendarle perder dinero a alguien de quien nadie se quejó.
//   · EL NOMBRE DEL ARCHIVO viaja en una cabecera HTTP y sale del título
//     del inmueble, que lo escribe el usuario.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSV_BOM,
  activeCurrencies,
  addAmount,
  addCents,
  asCurrency,
  buildCsvReport,
  computeYield,
  csvAmount,
  csvDate,
  csvEscape,
  csvMoneyCells,
  csvMoneyHeaders,
  csvRow,
  emptyMoney,
  formatMoneyByCurrency,
  formatPctOrDash,
  hasFeedback,
  isMixedCurrency,
  looksLikeLiked,
  looksLikePriceObjection,
  medianOf,
  mergeMoney,
  moneyIsEmpty,
  priceDeltaPct,
  safeFileName,
  soleCurrency,
  subtractMoney,
  sumMoneyList,
  visitHappened,
  yieldBlockedText,
} from "@/lib/realty/owner-report";

// ═══════════════════════════════════════════════════════════════════════
// 1. DINERO POR MONEDA
// ═══════════════════════════════════════════════════════════════════════

test("centavos enteros: un decimal en texto no pierde el último centavo", () => {
  const m = emptyMoney();
  addAmount(m, "MXN", "12000.55");
  addAmount(m, "MXN", "0.45");
  assert.equal(m.MXN, 1_200_100);
  assert.ok(Number.isInteger(m.MXN));
});

test("0.10 + 0.20 da 30 centavos, no 30.000000000000004", () => {
  const m = emptyMoney();
  addAmount(m, "MXN", "0.10");
  addAmount(m, "MXN", "0.20");
  assert.equal(m.MXN, 30);
});

test("🔴 pesos y dólares nunca caen en el mismo cajón", () => {
  const m = emptyMoney();
  addAmount(m, "MXN", "1000");
  addAmount(m, "USD", "1000");
  assert.deepEqual(m, { MXN: 100_000, USD: 100_000 });
  assert.equal(isMixedCurrency(m), true);
  // Con dos monedas NO existe un total único que sea honesto.
  assert.equal(soleCurrency(m), null);
});

test("una moneda desconocida cae a MXN y el importe NO se pierde", () => {
  const m = emptyMoney();
  addAmount(m, asCurrency("EUR"), "500");
  assert.equal(m.MXN, 50_000);
  assert.equal(m.USD, 0);
});

test("sumar y restar es cajón por cajón, y el neto puede quedar en rojo", () => {
  const a = { MXN: 500, USD: 100 };
  const b = { MXN: 200, USD: 40 };
  assert.deepEqual(mergeMoney(a, b), { MXN: 700, USD: 140 });
  assert.deepEqual(subtractMoney(a, b), { MXN: 300, USD: 60 });
  assert.deepEqual(subtractMoney({ MXN: 100, USD: 0 }, { MXN: 400, USD: 0 }), {
    MXN: -300,
    USD: 0,
  });
  assert.deepEqual(sumMoneyList([]), { MXN: 0, USD: 0 });
});

test("un importe NaN o infinito no envenena el cajón", () => {
  const m = emptyMoney();
  addCents(m, "MXN", NaN);
  addCents(m, "MXN", Infinity);
  addCents(m, "MXN", 100);
  assert.equal(m.MXN, 100);
});

test("al presentar, dos monedas son dos importes y nunca uno", () => {
  const s = formatMoneyByCurrency({ MXN: 100_000, USD: 50_000 });
  assert.ok(s.includes(" y "), s);
  assert.equal(activeCurrencies(emptyMoney()).length, 0);
  assert.equal(moneyIsEmpty(emptyMoney()), true);
});

// ═══════════════════════════════════════════════════════════════════════
// 2. RENDIMIENTO — el número que el dueño de 10 casas nunca ha visto
// ═══════════════════════════════════════════════════════════════════════

test("el caso del enunciado: 12 000/mes, 2 000 de gasto, valor 2 M = 6 %", () => {
  const y = computeYield({
    currency: "MXN",
    valueCents: 200_000_000,
    income: { MXN: 14_400_000, USD: 0 },
    expenses: { MXN: 2_400_000, USD: 0 },
    months: 12,
  });
  assert.equal(y.netPct, 6);
  assert.equal(y.grossPct, 7.2);
  assert.equal(y.blocked, null);
});

test("un semestre se ANUALIZA y da el mismo 6 %, comparable con el año", () => {
  const y = computeYield({
    currency: "MXN",
    valueCents: 200_000_000,
    income: { MXN: 7_200_000, USD: 0 },
    expenses: { MXN: 1_200_000, USD: 0 },
    months: 6,
  });
  assert.equal(y.netPct, 6);
});

test("🔴 renta en USD contra valor en MXN: NO se emite porcentaje", () => {
  const y = computeYield({
    currency: "MXN",
    valueCents: 200_000_000,
    income: { MXN: 0, USD: 1_000_000 },
    expenses: emptyMoney(),
    months: 12,
  });
  assert.equal(y.netPct, null);
  assert.equal(y.grossPct, null);
  assert.equal(y.blocked, "MEZCLA_MONEDAS");
  assert.ok(String(yieldBlockedText(y.blocked)).includes("monedas distintas"));
});

test("sin precio de lista no se divide entre cero: se dice por qué", () => {
  for (const valueCents of [0, -5]) {
    const y = computeYield({
      currency: "MXN",
      valueCents,
      income: { MXN: 100, USD: 0 },
      expenses: emptyMoney(),
      months: 12,
    });
    assert.equal(y.netPct, null);
    assert.equal(y.blocked, "SIN_VALOR");
  }
});

test("sin un peso cobrado el rendimiento es SIN_INGRESO, no 0 %", () => {
  const y = computeYield({
    currency: "MXN",
    valueCents: 200_000_000,
    income: emptyMoney(),
    expenses: { MXN: 5_000, USD: 0 },
    months: 12,
  });
  assert.equal(y.blocked, "SIN_INGRESO");
  assert.equal(y.netPct, null);
});

test("gastos por encima de ingresos dan rendimiento NEGATIVO, no cero", () => {
  const y = computeYield({
    currency: "MXN",
    valueCents: 200_000_000,
    income: { MXN: 1_000_000, USD: 0 },
    expenses: { MXN: 3_000_000, USD: 0 },
    months: 12,
  });
  assert.ok(y.netPct !== null && y.netPct < 0, String(y.netPct));
});

test("un periodo de cero meses no divide entre cero", () => {
  const y = computeYield({
    currency: "MXN",
    valueCents: 200_000_000,
    income: { MXN: 14_400_000, USD: 0 },
    expenses: emptyMoney(),
    months: 0,
  });
  assert.ok(Number.isFinite(Number(y.grossPct)));
});

test("el porcentaje se redondea SOLO al presentar", () => {
  assert.equal(formatPctOrDash(6), "6 %");
  assert.equal(formatPctOrDash(6.42), "6.4 %");
  assert.equal(formatPctOrDash(null), "—");
});

// ═══════════════════════════════════════════════════════════════════════
// 3. LA ZONA
// ═══════════════════════════════════════════════════════════════════════

test("la mediana de centavos es ENTERA: no existe medio centavo", () => {
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([1, 2, 3, 4]), 3);
  assert.ok(Number.isInteger(Number(medianOf([1, 2, 3, 4]))));
  assert.equal(medianOf([]), null);
  const src = [5, 1, 3];
  medianOf(src);
  assert.deepEqual(src, [5, 1, 3], "medianOf no debe reordenar la lista de quien la llama");
});

test("estar 10 % arriba de la mediana se dice 10; sin mediana no se dice nada", () => {
  assert.equal(priceDeltaPct(220_000_000, 200_000_000), 10);
  assert.equal(priceDeltaPct(100, 0), null);
  assert.equal(priceDeltaPct(0, 100), null);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. LO QUE DIJERON EN LAS VISITAS — 🔴 LA NEGACIÓN
// ═══════════════════════════════════════════════════════════════════════

test("las formas en que un asesor mexicano escribe 'está cara'", () => {
  for (const t of [
    "Les gusto pero la vieron cara",
    "Muy cara para la zona",
    "El precio esta alto",
    "El precio está muy elevado",
    "Se paso de precio",
    "Fuera de su presupuesto",
    "No le alcanza",
    "Quiere negociar el precio",
    "Pide un descuento",
    "Busca algo mas barato",
    "CARISIMA segun ellos",
  ]) {
    assert.equal(looksLikePriceObjection(t), true, t);
  }
});

test("🔴 'no está caro' NO es una queja de precio", () => {
  for (const t of [
    "No esta caro para lo que ofrece",
    "no es cara",
    "Nada caro comparado con el de enfrente",
    "El precio no esta alto",
    "Nunca dijeron que estuviera cara",
    "Tampoco es cara",
  ]) {
    assert.equal(looksLikePriceObjection(t), false, t);
  }
});

test("una negación de OTRA frase no apaga la queja de esta", () => {
  for (const t of [
    "No me acuerdo del bano, pero la vieron cara",
    "No trajeron a la esposa. Esta muy cara.",
    "no tiene estacionamiento, y ademas esta cara",
    "no esta caro el mantenimiento, pero el precio esta alto",
  ]) {
    assert.equal(looksLikePriceObjection(t), true, t);
  }
});

test("🔴 'no les gustó' NO es que les gustó", () => {
  for (const t of [
    "No les gusto nada",
    "no le gusto la distribucion",
    "No quedaron interesados",
    "Nunca regresaron",
    "no es muy bonita por dentro",
  ]) {
    assert.equal(looksLikeLiked(t), false, t);
  }
});

test("les gustó de verdad", () => {
  for (const t of [
    "Les gusto mucho",
    "Le encanto la cocina",
    "Muy bonita",
    "Bien ubicada",
    "Quedaron interesados",
    "Van a regresar con la familia",
    "Quieren volver a ver la casa",
  ]) {
    assert.equal(looksLikeLiked(t), true, t);
  }
});

test("EL CASO del reporte: les gustó Y les pareció cara", () => {
  const t = "Les gusto mucho la casa pero les parecio cara";
  assert.equal(looksLikeLiked(t), true);
  assert.equal(looksLikePriceObjection(t), true);
});

test("el contrario: no les gustó, y además cara", () => {
  const t = "No les gusto, y ademas esta cara";
  assert.equal(looksLikeLiked(t), false);
  assert.equal(looksLikePriceObjection(t), true);
});

test("'bonito' lleva un 'ni' dentro y NO es una negación", () => {
  assert.equal(looksLikeLiked("Muy bonita la casa"), true);
  assert.equal(looksLikePriceObjection("Bonita pero cara"), true);
});

test("texto vacío, nulo o sin sentido no truena ni cuenta", () => {
  for (const t of ["", "   ", null, undefined, "asdf qwerty"]) {
    assert.equal(looksLikePriceObjection(t), false, String(t));
    assert.equal(looksLikeLiked(t), false, String(t));
  }
  assert.equal(hasFeedback("   "), false);
  assert.equal(hasFeedback(null), false);
  assert.equal(hasFeedback("ok"), true);
});

test("un comentario larguísimo no cuelga el reporte", () => {
  const t = "les gusto pero esta cara. ".repeat(400);
  const t0 = Date.now();
  assert.equal(looksLikePriceObjection(t), true);
  assert.equal(looksLikeLiked(t), true);
  assert.ok(Date.now() - t0 < 1000, "las heurísticas no pueden ser cuadráticas");
});

// ═══════════════════════════════════════════════════════════════════════
// 5. ¿LA VISITA OCURRIÓ?
// ═══════════════════════════════════════════════════════════════════════

const AYER = new Date("2026-08-24T12:00:00Z");
const MANANA = new Date("2026-08-27T12:00:00Z");
const HOY = new Date("2026-08-26T12:00:00Z");

test("una visita que ya pasó y nadie cerró SÍ cuenta", () => {
  // Nadie en el vertical marca REALIZADA: contar por ese estado daría cero
  // visitas siempre, y el reporte estrella diría que a la casa no fue nadie.
  assert.equal(visitHappened("PROGRAMADA", AYER, HOY), true);
  assert.equal(visitHappened("CONFIRMADA", AYER, HOY), true);
});

test("cancelada y no-asistió no cuentan aunque ya hayan pasado", () => {
  assert.equal(visitHappened("CANCELADA", AYER, HOY), false);
  assert.equal(visitHappened("NO_ASISTIO", AYER, HOY), false);
});

test("una visita futura no se cuenta como hecha, salvo REALIZADA", () => {
  assert.equal(visitHappened("CONFIRMADA", MANANA, HOY), false);
  assert.equal(visitHappened("REALIZADA", MANANA, HOY), true);
});

test("una fecha basura no truena ni cuenta", () => {
  assert.equal(visitHappened("PROGRAMADA", "no-es-fecha", HOY), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 6. LA HOJA DE CÁLCULO
// ═══════════════════════════════════════════════════════════════════════

test("una fórmula de Excel se neutraliza al escribirla", () => {
  assert.equal(csvEscape("=1+1"), '"=1+1"');
  assert.equal(csvEscape("+34 600"), '"+34 600"');
  assert.equal(csvEscape("-2+3"), '"-2+3"');
  assert.equal(csvEscape("@SUM(A1)"), '"@SUM(A1)"');
  assert.equal(
    csvEscape('=HYPERLINK("http://x","clic")'),
    '"=HYPERLINK(""http://x"",""clic"")"',
  );
});

test("comas, comillas y saltos de línea no rompen la fila", () => {
  const row = csvRow(["Casa, bonita", 'El "mejor" precio', "linea1\nlinea2"]);
  assert.ok(row.startsWith('"Casa, bonita","El ""mejor"" precio"'));
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(undefined), "");
  assert.equal(csvEscape(0), "0");
});

test("BOM y CRLF: Excel de Windows lo abre con los acentos bien", () => {
  const out = buildCsvReport({ title: "Reporte de la Ciénega" }, []);
  assert.ok(out.startsWith(CSV_BOM));
  assert.ok(out.includes("Ciénega"));
  assert.ok(out.endsWith("\r\n"));
});

test("🔴 pesos y dólares en COLUMNAS distintas, nunca en una", () => {
  assert.deepEqual(csvMoneyCells({ MXN: 120_000, USD: 35_000 }), ["1200.00", "350.00"]);
  assert.deepEqual(csvMoneyHeaders("Ingresos"), ["Ingresos (MXN)", "Ingresos (USD)"]);
  // El cero se deja VACÍO: no invita a sumar una columna que no aplica.
  assert.deepEqual(csvMoneyCells({ MXN: 500, USD: 0 }), ["5.00", ""]);
});

test("el importe de una celda es un número sumable, sin símbolo ni miles", () => {
  assert.equal(csvAmount(1_234_567), "12345.67");
  assert.equal(csvAmount(-500), "-5.00");
  assert.equal(csvAmount(1), "0.01");
  assert.ok(!csvAmount(100_000_000).includes(","));
  assert.ok(!csvAmount(100).includes("$"));
  assert.equal(csvDate("2026-08-25T21:00:00.000Z"), "2026-08-25");
  assert.equal(csvDate(null), "");
});

test("un bloque sin renglones se pinta con su frase, no se omite", () => {
  const out = buildCsvReport({ title: "T" }, [
    { title: "Visitas", header: ["a"], rows: [], emptyText: "No hubo visitas." },
  ]);
  assert.ok(out.includes("Visitas"));
  assert.ok(out.includes("No hubo visitas."));
});

test("el aviso de la otra moneda va en el encabezado de la hoja", () => {
  const out = buildCsvReport({ title: "T", currency: "MXN", otherCurrencies: ["USD"] }, []);
  assert.ok(out.includes("USD"));
  assert.ok(out.includes("NO están en esta hoja"));
});

// ═══════════════════════════════════════════════════════════════════════
// 7. EL NOMBRE DEL ARCHIVO — viaja en una cabecera HTTP
// ═══════════════════════════════════════════════════════════════════════

test("🔴 un título con comillas o CRLF no puede inyectar la cabecera", () => {
  const evil = [
    "Casa",
    String.fromCharCode(34),
    "; rm -rf /",
    String.fromCharCode(13),
    String.fromCharCode(10),
    "X-Evil: 1",
    String.fromCharCode(92),
  ].join("");
  const name = safeFileName(evil, "csv");
  for (const ch of [
    String.fromCharCode(34),
    String.fromCharCode(13),
    String.fromCharCode(10),
    ";",
    String.fromCharCode(92),
  ]) {
    assert.equal(name.indexOf(ch), -1, name);
  }
  assert.match(name, /^[a-z0-9-]+\.csv$/);
});

test("acentos y eñes se transliteran; lo que queda vacío cae a 'reporte'", () => {
  assert.equal(safeFileName("Casa en la Cañada Ñ", "pdf"), "casa-en-la-canada-n.pdf");
  assert.equal(safeFileName("中文中文", "csv"), "reporte.csv");
  assert.equal(safeFileName("", "csv"), "reporte.csv");
  assert.equal(safeFileName("---", "csv"), "reporte.csv");
});

test("un título kilométrico se recorta y no deja el guión pegado al punto", () => {
  const name = safeFileName("a".repeat(200), "pdf");
  assert.ok(name.length <= 64, name);
  assert.ok(!name.startsWith("-"));
  assert.ok(!name.includes("-."));
});
