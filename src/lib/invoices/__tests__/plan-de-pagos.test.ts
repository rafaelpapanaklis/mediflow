// ws1-t2 — El plan de pagos: por qué cuota va y si está al corriente.
// Dos funciones puras. Si alguien deshace la cascada, el reparto exacto o el
// aviso de descuadre, estas pruebas tienen que fallar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calendarioDeCuotas, cuadreDelPlan, destinoDelAbono, estadoDelPlan, pagosDesdeFilas, type Cuota,
} from "../plan-de-pagos";
import {
  aCentavos, calcularCalendario, condicionesPorDefecto, type CondicionesPago,
} from "../../quotes/condiciones-pago";

const plazos = (p: Partial<CondicionesPago>): CondicionesPago => ({
  ...condicionesPorDefecto(), modo: "plazos", numPagos: 24, primerPago: "2026-01-03", ...p,
});
const sumaC = (cuotas: Cuota[]) => cuotas.reduce((a, q) => a + aCentavos(q.importe), 0);

/** N cuotas de $2,000 mensuales desde el 3 de enero de 2026, sin enganche. */
const deDosMil = (n: number) => calendarioDeCuotas(plazos({ numPagos: n }), 2000 * n);

test("24 cuotas + enganche: la suma da EXACTAMENTE el total, al centavo", () => {
  // Totales que no dividen parejo entre 24: aquí es donde se pierden centavos.
  for (const total of [58000, 50000.01, 49999.99, 33333.33, 100000.07, 12345.67]) {
    const cuotas = calendarioDeCuotas(plazos({ enganche: 10000 }), total);
    assert.equal(cuotas.length, 25, `enganche + 24 con total ${total}`);
    assert.equal(cuotas[0].esEnganche, true);
    assert.equal(cuotas[0].numero, 0);
    assert.equal(cuotas[0].importe, 10000);
    assert.equal(sumaC(cuotas), aCentavos(total), `la suma no da el total ${total}`);
    assert.ok(cuadreDelPlan(plazos({ enganche: 10000 }), total).cuadra);
  }
});

test("es el MISMO calendario que pintó el editor de Forma de pago", () => {
  const c = plazos({ enganche: 1500, numPagos: 7 });
  const editor = calcularCalendario(30000, c).pagos;
  const cuotas = calendarioDeCuotas(c, 30000);
  assert.deepEqual(
    cuotas.map((q) => [q.numero, q.esEnganche, q.importe, q.vencimiento]),
    editor.map((p) => [p.numero, p.esEnganche, p.monto, p.fecha]),
  );
});

test("vencimientos: enganche en la fecha fijada, las cuotas un periodo después", () => {
  const cuotas = calendarioDeCuotas(plazos({ enganche: 5000, numPagos: 3, primerPago: "2026-01-31" }), 11000);
  assert.deepEqual(cuotas.map((q) => q.vencimiento), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  const sinEnganche = calendarioDeCuotas(plazos({ numPagos: 2, primerPago: "2026-03-03" }), 4000);
  assert.deepEqual(sinEnganche.map((q) => q.vencimiento), ["2026-03-03", "2026-04-03"]);
});

test("válidos los tres: enganche 0, numPagos 2, y plazos pagados de golpe", () => {
  const cuotas = calendarioDeCuotas(plazos({ enganche: 0, numPagos: 2 }), 4000);
  assert.equal(cuotas.length, 2);
  assert.ok(cuotas.every((q) => !q.esEnganche));
  const e = estadoDelPlan(cuotas, [{ importe: 4000 }], "2026-01-01");
  assert.equal(e.pagadas, 2);
  assert.equal(e.cuotaActual, null);
  assert.equal(e.siguiente, null);
  assert.equal(e.pendiente, 0);
  assert.equal(e.alCorriente, true);
});

test("sin condiciones a plazos no hay cuotas, y nada se rompe", () => {
  assert.deepEqual(calendarioDeCuotas(null, 5000), []);
  assert.deepEqual(calendarioDeCuotas(undefined, 5000), []);
  assert.deepEqual(calendarioDeCuotas({ ...condicionesPorDefecto(), metodo: "cash" }, 5000), []);
  assert.deepEqual(calendarioDeCuotas(plazos({}), 0), []);
  const e = estadoDelPlan([], [{ importe: 100 }], "2026-01-01");
  assert.equal(e.totalCuotas, 0);
  assert.equal(e.alCorriente, true);
  assert.ok(cuadreDelPlan(null, 5000).cuadra);
});

test("un abono de $5,000 sobre cuotas de $2,000 salda dos y deja $1,000 en la tercera", () => {
  const e = estadoDelPlan(deDosMil(24), [{ importe: 5000 }], "2026-01-01");
  assert.deepEqual(e.cuotas.slice(0, 4).map((q) => [q.abonado, q.falta, q.estado]), [
    [2000, 0, "pagada"],
    [2000, 0, "pagada"],
    [1000, 1000, "porVencer"],
    [0, 2000, "porVencer"],
  ]);
  assert.equal(e.pagadas, 2);
  assert.equal(e.cuotaActual?.numero, 3);
  assert.equal(e.pendiente, 43000);
  assert.equal(e.excedente, 0);
});

test("la cascada no mira cuántos pagos fueron ni en qué orden: solo cuánto suman", () => {
  const uno = estadoDelPlan(deDosMil(6), [{ importe: 5000 }], "2026-02-10");
  const varios = estadoDelPlan(deDosMil(6), [{ importe: 500 }, { importe: 4000 }, { importe: 500 }], "2026-02-10");
  assert.deepEqual(uno, varios);
});

test("un reembolso hace retroceder el plan: derivado, no puede mentir", () => {
  const e = estadoDelPlan(deDosMil(6), [{ importe: 4000 }, { importe: -2000 }], "2026-01-01");
  assert.equal(e.pagadas, 1);
  assert.equal(e.cuotaActual?.numero, 2);
  // Y nunca por debajo de cero.
  assert.equal(estadoDelPlan(deDosMil(6), [{ importe: -500 }], "2026-01-01").pagado, 0);
});

test("las filas de `payments`: un reembolso es method 'refund' con amount POSITIVO", () => {
  const pagos = pagosDesdeFilas([
    { amount: 4000, method: "cash" },
    { amount: 2000, method: "refund" },
  ]);
  assert.deepEqual(pagos, [{ importe: 4000 }, { importe: -2000 }]);
  assert.equal(estadoDelPlan(deDosMil(6), pagos, "2026-01-01").pagadas, 1);
  assert.deepEqual(pagosDesdeFilas(null), []);
});

test("dos cuotas vencidas sin pagar: NO está al corriente, y dice cuántas", () => {
  // Vencen el 3 de enero, 3 de febrero, 3 de marzo… Hoy es 10 de febrero.
  const e = estadoDelPlan(deDosMil(24), [], "2026-02-10");
  assert.equal(e.alCorriente, false);
  assert.equal(e.vencidas, 2);
  assert.equal(e.importeVencido, 4000);
  assert.equal(e.cuotaActual?.numero, 1);
  assert.equal(e.siguiente?.numero, 3);
  assert.equal(e.siguiente?.vencimiento, "2026-03-03");
});

test("al corriente = lo pagado ≥ lo vencido hasta hoy. Nada más", () => {
  const cuotas = deDosMil(24);
  assert.equal(estadoDelPlan(cuotas, [{ importe: 3999.99 }], "2026-02-10").alCorriente, false);
  assert.equal(estadoDelPlan(cuotas, [{ importe: 3999.99 }], "2026-02-10").vencidas, 1);
  assert.equal(estadoDelPlan(cuotas, [{ importe: 4000 }], "2026-02-10").alCorriente, true);
  // La que vence HOY todavía no está vencida; mañana sí.
  assert.equal(estadoDelPlan(cuotas, [], "2026-01-03").alCorriente, true);
  assert.equal(estadoDelPlan(cuotas, [], "2026-01-04").alCorriente, false);
});

test("«vas por la 7 de 24»: el enganche no cuenta como cuota", () => {
  const cuotas = calendarioDeCuotas(plazos({ enganche: 10000 }), 58000); // 24 de $2,000
  const e = estadoDelPlan(cuotas, [{ importe: 10000 + 6 * 2000 }], "2026-07-10");
  assert.equal(e.totalCuotas, 24);
  assert.equal(e.pagadas, 6);
  assert.equal(e.cuotaActual?.numero, 7);
  assert.equal(e.cuotaActual?.esEnganche, false);
  assert.equal(e.pendiente, 36000);
  // Sin pagar nada, por donde va es el enganche.
  assert.equal(estadoDelPlan(cuotas, [], "2026-01-01").cuotaActual?.esEnganche, true);
});

test("cobrar de más no inventa cuotas: se enseña como excedente", () => {
  const e = estadoDelPlan(deDosMil(2), [{ importe: 4500 }], "2026-01-01");
  assert.equal(e.pendiente, 0);
  assert.equal(e.excedente, 500);
});

test("sin fecha de primer pago las cuotas no vencen nunca", () => {
  const cuotas = calendarioDeCuotas(plazos({ numPagos: 3, primerPago: null }), 6000);
  const e = estadoDelPlan(cuotas, [], "2030-01-01");
  assert.equal(e.vencidas, 0);
  assert.equal(e.alCorriente, true);
  assert.equal(e.siguiente?.numero, 1);
});

test("total cambiado después de acordar: se AVISA, no se ajusta solo", () => {
  // Se acordó enganche de $10,000 y 24 cuotas; la factura bajó a $8,000.
  const c = plazos({ enganche: 10000 });
  const cuadre = cuadreDelPlan(c, 8000);
  assert.equal(cuadre.cuadra, false);
  assert.equal(cuadre.motivo, "engancheCubreTodo");
  // Y lo acordado sigue intacto: nadie le reescribió el enganche.
  assert.equal(c.enganche, 10000);
  assert.equal(c.numPagos, 24);
  // El total ya no da para las 24 cuotas que se acordaron.
  assert.equal(cuadreDelPlan(plazos({ enganche: 10000 }), 10000.05).motivo, "menosCuotasQueLasAcordadas");
});

test("destino de un abono: a la más vieja que quede, sin que nadie elija", () => {
  const cuotas = deDosMil(24);
  const d = destinoDelAbono(cuotas, [{ importe: 5000 }], 3500, "2026-01-01");
  assert.deepEqual(d.map((x) => [x.cuota.numero, x.aplica, x.laSalda]), [
    [3, 1000, true],
    [4, 2000, true],
    [5, 500, false],
  ]);
  assert.deepEqual(destinoDelAbono(cuotas, [], 0, "2026-01-01"), []);
});

/* ── Lo que rodea a las dos funciones ─────────────────────────────────── */

test("SIN la tabla invoice_payment_terms (sonda to_regclass): no se cae nada y no hay plan", async () => {
  const { leerCondicionesDeFacturas, _olvidarTabla } = await import("../condiciones-pago-db");
  _olvidarTabla();
  let consultas = 0;
  // Una base a la que le falta la tabla: la sonda contesta «no existe» y
  // cualquier otra consulta reventaría como revienta Postgres.
  const db = {
    $queryRaw: async (trozos: TemplateStringsArray) => {
      consultas++;
      if (trozos.join("").includes("to_regclass")) return [{ existe: false }];
      throw new Error('relation "invoice_payment_terms" does not exist');
    },
  };
  const leido = await leerCondicionesDeFacturas(db as any, { clinicId: "c1", invoiceIds: ["f1"] });
  assert.equal(leido.sinTabla, true);
  assert.equal(leido.fallo, false);
  assert.equal(leido.porFactura.size, 0);
  assert.equal(consultas, 1, "sin tabla solo se hace la sonda");
  // Y visto desde la pantalla: sin condiciones no hay cuotas → el bloque no aparece.
  assert.deepEqual(calendarioDeCuotas(leido.porFactura.get("f1"), 58000), []);
  _olvidarTabla();
});

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

test("el núcleo es puro: ni Prisma, ni red, ni SQL, ni «orto»", () => {
  const src = leer("src/lib/invoices/plan-de-pagos.ts");
  const codigo = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /prisma|fetch\(|\$queryRaw|\$executeRaw/i);
  assert.doesNotMatch(codigo, /orto|ortho/i);
  assert.doesNotMatch(codigo, /new Date\(/, "`hoy` entra por parámetro: determinista");
});

test("el bloque no guarda nada: la pantalla solo LEE las condiciones", () => {
  for (const f of ["bloque-plan.tsx", "destino-abono.tsx", "use-condiciones.ts"]) {
    const src = leer(`src/components/dashboard/plan-de-pagos/${f}`);
    assert.doesNotMatch(src, /method:\s*"(POST|PUT|PATCH|DELETE)"/, `${f} no escribe`);
  }
});

test("diseño: ni un hex a mano, y tabular-nums en dinero y fechas", () => {
  const css = leer("src/components/dashboard/plan-de-pagos/plan.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "un color escrito a mano");
  assert.doesNotMatch(css, /rgba?\(/, "un color escrito a mano");
  for (const clase of [".cuotaFecha", ".cuotaImporte", ".destinoImporte", ".grande", ".sello "]) {
    const regla = css.slice(css.indexOf(clase));
    assert.match(regla.slice(0, regla.indexOf("}")), /tabular-nums/, `${clase} sin tabular-nums`);
  }
});

test("es.json y en.json traen las MISMAS claves de planDePagos, y las que usa la pantalla existen", () => {
  const claves = (o: any, pre = ""): string[] =>
    Object.keys(o).flatMap((k) => (o[k] && typeof o[k] === "object" ? claves(o[k], `${pre}${k}.`) : [`${pre}${k}`]));
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).planDePagos;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).planDePagos;
  assert.ok(es && en);
  assert.deepEqual(claves(es).sort(), claves(en).sort());
  const usadas = ["bloque-plan.tsx", "destino-abono.tsx"]
    .flatMap((f) => Array.from(leer(`src/components/dashboard/plan-de-pagos/${f}`).matchAll(/t\("planDePagos\.([\w.]+)"/g)).map((m) => m[1]));
  assert.ok(usadas.length > 10);
  const todas = claves(es);
  for (const k of usadas) {
    assert.ok(todas.some((c) => c === k || c.startsWith(`${k}.`)), `falta planDePagos.${k}`);
  }
  // Las que se arman con plantilla: un estado por cada EstadoCuota, un motivo por cada descuadre.
  for (const k of ["estado.pagada", "estado.porVencer", "estado.vencida",
    "descuadre.engancheCubreTodo", "descuadre.menosCuotasQueLasAcordadas", "descuadre.noSumaElTotal"]) {
    assert.ok(todas.includes(k), `falta planDePagos.${k}`);
  }
});

test("sin fechas: `conFechas` es false, para que nadie presuma de «al corriente»", () => {
  const sin = calendarioDeCuotas(plazos({ numPagos: 3, primerPago: null }), 6000);
  assert.equal(estadoDelPlan(sin, [], "2030-01-01").conFechas, false);
  assert.equal(estadoDelPlan(deDosMil(3), [], "2026-01-01").conFechas, true);
});

test("montaje: tras el interruptor, sin borradores, y el destino no tapa el cobro", () => {
  const detalle = leer("src/components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(detalle, /rediseno && !isCancelled && !isDraft && \(\s*<BloquePlan/);
  assert.match(detalle, /useCondicionesDeFactura\(invoice\?\.id, open && rediseno\)/);
  assert.match(leer("src/components/dashboard/billing/payment-modal.tsx"), /\{rediseno && \(\s*<DestinoDelAbono/);
  assert.match(leer("src/components/dashboard/factura-ficha-rediseno/fichas-factura.tsx"), /!anulada && inv\.status !== "DRAFT" && <BloquePlan/);
  assert.match(leer("src/components/dashboard/plan-de-pagos/destino-abono.tsx"), /const MAX_FILAS = 3;/);
  // Ninguna clase de CSS module que no exista (saldría `undefined` en el DOM).
  const css = leer("src/components/dashboard/plan-de-pagos/plan.module.css");
  for (const f of ["bloque-plan.tsx", "destino-abono.tsx"]) {
    for (const m of leer(`src/components/dashboard/plan-de-pagos/${f}`).matchAll(/\bs\.(\w+)/g)) {
      assert.ok(css.includes(`.${m[1]}`), `${f} usa s.${m[1]} y plan.module.css no la declara`);
    }
  }
});
