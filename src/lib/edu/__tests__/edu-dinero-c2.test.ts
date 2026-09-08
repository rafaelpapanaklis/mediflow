/**
 * OLA C·2 — EL DINERO DEL INSTITUTO, LO QUE LA COLUMNA HIZO POSIBLE.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-dinero-c2.test.ts
 *       (o `npm run test:edu`, que descubre este archivo solo)
 *
 * Cierra la segunda mitad de los hallazgos de dinero: el turno POR SEDE
 * (H-09), el desglose CONGELADO del corte y su reimpresión (H-53), el
 * autor y la baja lógica del precio (H-76), el fondo corregible de un
 * turno abierto (H-51), el CSV de facturación (H-78) y los presupuestos
 * (fila 26 del comparativo con el dental).
 *
 * Mismo enfoque doble que `edu-dinero-ola-c.test.ts`, y por la misma
 * razón: la mitad de lo que se arregla vive en funciones PURAS (y se
 * prueba llamándolas) y la otra mitad vive en la capa que consulta Prisma
 * —un `where` al que le faltaba un filtro, un `deleteMany` que tenía que
 * dejar de serlo, un candado que no estaba—. Eso segundo se comprueba
 * LEYENDO EL ARCHIVO, con los comentarios quitados: un archivo se juzga
 * por lo que hace, no por lo que dice su prosa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_CORTE_DESGLOSE_VERSION,
  eduCorteDesglose,
  eduCorteDesgloseLeer,
  type EduCorteDesglose,
} from "../caja-cierre-core";
import type { EduCorteDesgloseRow } from "../dinero-core";
import {
  EDU_INVOICE_CSV_COLUMNAS,
  eduCsvCelda,
  eduCsvImporte,
  eduInvoicesCsv,
  eduInvoicesCsvNombre,
  type EduInvoiceFilters,
  type EduInvoiceRow,
} from "../facturacion-core";
import {
  EDU_QUOTE_TRANSITIONS,
  eduQuoteTotales,
  type EduQuoteRow,
} from "../presupuestos-core";
import { eduQuoteRepartirDescuento } from "../presupuestos";

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** El archivo, sin comentarios: se juzga por lo que hace, no por su prosa. */
function fuenteDe(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** El cuerpo de UNA función exportada, para no acusar al archivo entero. */
function cuerpoDe(src: string, nombre: string): string {
  const desde = src.indexOf(`export async function ${nombre}`);
  assert.notEqual(desde, -1, `no se encontró ${nombre}: ¿la renombraron?`);
  const siguiente = src.indexOf("\nexport ", desde + 1);
  return src.slice(desde, siguiente === -1 ? undefined : siguiente);
}

const CAJA = () => fuenteDe("src", "lib", "edu", "caja.ts");
const TARIFAS = () => fuenteDe("src", "lib", "edu", "tarifas.ts");
const PRESU = () => fuenteDe("src", "lib", "edu", "presupuestos.ts");
const PAGOS = () => fuenteDe("src", "lib", "edu", "pagos.ts");

// ═══════════════════════════════════════════════════════════════════════
// 1 · H-53 · EL DESGLOSE SE CONGELA Y SE VUELVE A LEER IGUAL
// ═══════════════════════════════════════════════════════════════════════

const PAGOS_DE_UN_TURNO = [
  { method: "CASH", amountCents: 50_000, isRefund: false },
  { method: "CASH", amountCents: 30_000, isRefund: false },
  { method: "CASH", amountCents: 10_000, isRefund: true },
  { method: "CARD_DEBIT", amountCents: 120_000, isRefund: false },
];

test("🔴 H-53 · el desglose guardado se relee EXACTAMENTE igual", () => {
  const armado = eduCorteDesglose(PAGOS_DE_UN_TURNO);
  // Lo que se guarda en Postgres pasa por JSON: se prueba ese viaje, no
  // el objeto en memoria. Un `Map`, un `Date` o un `undefined` que se
  // colara aquí sobreviviría en memoria y moriría en la base.
  const releido = eduCorteDesgloseLeer(JSON.parse(JSON.stringify(armado)));
  assert.deepEqual(releido, armado);
  assert.equal(releido?.version, EDU_CORTE_DESGLOSE_VERSION);
});

test("🔴 H-53 · el neto del desglose cuadra con la resta de sus renglones", () => {
  const d = eduCorteDesglose(PAGOS_DE_UN_TURNO);
  const efectivo = d.renglones.find((r) => r.method === "CASH");
  assert.equal(efectivo?.chargedCents, 80_000);
  assert.equal(efectivo?.refundedCents, 10_000);
  assert.equal(efectivo?.netCents, 70_000);
  assert.equal(d.netoTotalCents, 70_000 + 120_000);
  // Y la suma de los netos ES el neto total: si algún día dejaran de
  // cuadrar, el corte impreso no cuadraría consigo mismo.
  assert.equal(
    d.renglones.reduce((a, r) => a + r.netCents, 0),
    d.netoTotalCents,
  );
});

test("🔴 H-53 · un turno ANTERIOR a esta ola se lee como null, no como ceros", () => {
  // `null` en la columna es "cerrado antes de la ola": la pantalla lo dice
  // con esas palabras. Pintar ceros sería pintar datos que no existen.
  assert.equal(eduCorteDesgloseLeer(null), null);
  assert.equal(eduCorteDesgloseLeer({}), null);
  assert.equal(eduCorteDesgloseLeer({ renglones: [] }), null);
  assert.equal(eduCorteDesgloseLeer("{}"), null);
});

test("🔴 el tipo que viaja a la pantalla es ESPEJO del que se guarda", () => {
  // Chequeo de TIPOS, no de valores: `EduCorteDesgloseRow` (dinero-core,
  // client-safe) y `EduCorteDesglose` (caja-cierre-core) tienen que poder
  // asignarse en los dos sentidos. Si alguien añade un campo a uno y no al
  // otro, esto deja de compilar — que es exactamente cuándo hay que
  // enterarse.
  const guardado: EduCorteDesglose = eduCorteDesglose(PAGOS_DE_UN_TURNO);
  const aPantalla: EduCorteDesgloseRow = guardado;
  const deVuelta: EduCorteDesglose = aPantalla;
  assert.equal(deVuelta.renglones.length, guardado.renglones.length);
});

test("🔴 H-53 · closeEduCashSession ESCRIBE el desglose en la misma transacción del cierre", () => {
  const cuerpo = cuerpoDe(CAJA(), "closeEduCashSession");
  assert.match(
    cuerpo,
    /methodBreakdown:\s*cuentas\.desglose/,
    "el cierre tiene que congelar el desglose: sin él no hay reimpresión",
  );
  // Y sale de las MISMAS cuentas con las que se calculó el esperado: dos
  // consultas para dos cifras del mismo papel es cómo se llega a un corte
  // que no cuadra consigo mismo.
  const iCuentas = cuerpo.indexOf("const cuentas = await calcularTurno");
  const iDesglose = cuerpo.indexOf("methodBreakdown");
  assert.ok(iCuentas !== -1 && iCuentas < iDesglose);
  // El estado sigue en el `where`.
  assert.match(cuerpo, /updateMany\(\{[\s\S]*closedAt:\s*null/);
});

test("🔴 H-53 · el corte cerrado se REIMPRIME leyendo, no recalculando", () => {
  const cuerpo = cuerpoDe(CAJA(), "getEduCorteCerrado");
  assert.match(cuerpo, /closedAt:\s*\{\s*not:\s*null\s*\}/);
  assert.equal(
    /calcularTurno/.test(cuerpo),
    false,
    "reimprimir NO puede recalcular: eso deshace el congelado que protege al papel firmado",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · H-09 · UN TURNO POR SEDE
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-09 · getEduOpenCashSession resuelve POR SEDE, con el legado sin sede de respaldo", () => {
  const cuerpo = cuerpoDe(CAJA(), "getEduOpenCashSession");
  // Ya no es "el turno abierto del instituto": se leen TODOS los abiertos
  // y se elige.
  assert.match(cuerpo, /findMany\(/);
  assert.match(cuerpo, /closedAt:\s*null/);
  // La regla 2: sin turno propio de la sede, el turno SIN sede.
  assert.match(cuerpo, /campusId\s*===\s*null/);
  assert.match(cuerpo, /sinSede/);
  // Y con varios abiertos y sin sede pedida NO se inventa uno.
  assert.match(cuerpo, /abiertas\.length\s*===\s*1/);
});

test("🔴 H-09 · abrir turno sella la sede y rebota si ya hay uno (propio o del instituto)", () => {
  const cuerpo = cuerpoDe(CAJA(), "openEduCashSession");
  // La sede NO sale del body: llega por `options`, que resuelve el
  // endpoint con eduCampusForCharge.
  assert.match(cuerpo, /options\.campusId/);
  assert.equal(
    /input\.campusId|body\.campusId/.test(cuerpo),
    false,
    "un campusId del navegador abriría el turno de la otra sede",
  );
  // Pertenencia de la sede al instituto.
  assert.match(cuerpo, /eduCampus\.findFirst/);
  // Los DOS candados, dentro de la transacción.
  assert.match(cuerpo, /\$transaction/);
  assert.match(cuerpo, /delInstituto/);
  assert.match(cuerpo, /409/);
});

test("🔴 H-09 · el cobro, el abono y la mensualidad sellan el turno de SU sede", () => {
  const caja = CAJA();
  assert.match(
    cuerpoDe(caja, "createEduCharge"),
    /getEduOpenCashSession\(ctx,\s*options\.campusId/,
    "el cobro tiene que caer en el turno de la sede en la que se emite",
  );
  assert.match(
    cuerpoDe(caja, "addEduPayment"),
    /getEduOpenCashSession\(ctx,\s*cobro\.campusId\)/,
    "un abono cae en el turno de la sede del cobro que paga",
  );
  const pagos = PAGOS();
  assert.match(pagos, /getEduOpenCashSession\(ctx,\s*cobro\.campusId\)/);
  assert.match(pagos, /getEduOpenCashSession\(ctx,\s*fila\.plan\.charge\.campusId\)/);
  // Y no queda ni una llamada "a ciegas" sin sede — tampoco en la LECTURA
  // («solo el turno abierto» tiene que ser el de este mostrador).
  assert.match(
    cuerpoDe(caja, "listEduCharges"),
    /getEduOpenCashSession\(ctx,\s*options\.campusId/,
  );
  assert.equal(
    /getEduOpenCashSession\(ctx\)/.test(caja + pagos),
    false,
    "una llamada sin sede volvería a mandar el dinero al corte equivocado",
  );
  for (const ruta of [
    ["src", "app", "instituto", "(panel)", "caja", "page.tsx"],
    ["src", "app", "api", "instituto", "caja", "cobros", "route.ts"],
  ]) {
    assert.equal(
      /getEduOpenCashSession\(ctx\)/.test(fuenteDe(...ruta)),
      false,
      `${ruta.join("/")} lee el turno sin decir de qué sede`,
    );
  }
});

test("🔴 H-09 · getEduCorte pinta el turno de la sede que se está mirando", () => {
  const cuerpo = cuerpoDe(CAJA(), "getEduCorte");
  assert.match(cuerpo, /getEduOpenCashSession\(ctx,\s*donde\.campusId\)/);
  // Y ofrece los turnos abiertos en OTRAS sedes, que es la mitad que la
  // pantalla necesita para no mentir con "no hay turno abierto".
  assert.match(cuerpo, /otrosTurnos/);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · H-51 · EL FONDO DE UN TURNO ABIERTO
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-51 · corregir el fondo exige turno ABIERTO, motivo y deja rastro", () => {
  const cuerpo = cuerpoDe(CAJA(), "setEduCashSessionOpening");
  // El estado en el `where`, como manda la casa, y con 409.
  assert.match(cuerpo, /updateMany\(\{[\s\S]*closedAt:\s*null/);
  assert.match(cuerpo, /409/);
  // El motivo es obligatorio.
  assert.match(cuerpo, /motivo/);
  // El rastro: el importe anterior queda escrito en las notas.
  assert.match(cuerpo, /notes/);
  assert.match(cuerpo, /anteriorCents/);
  // Y la bitácora.
  assert.match(cuerpo, /eduAudit\(/);
});

test("🔴 H-51 · la ruta del fondo es SUYA y no un verbo más del corte", () => {
  // Dos operaciones sobre dinero compartiendo verbo es cómo un cliente que
  // manda el cuerpo equivocado cierra una caja sin querer.
  const fondo = fuenteDe(
    "src", "app", "api", "instituto", "caja", "corte", "fondo", "route.ts",
  );
  assert.match(fondo, /export async function PATCH/);
  assert.match(fondo, /eduApiGuard\("caja\.corte"\)/);
  const corte = fuenteDe("src", "app", "api", "instituto", "caja", "corte", "route.ts");
  assert.match(corte, /closeEduCashSession/);
  assert.equal(/setEduCashSessionOpening/.test(corte), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · H-76 · EL AUTOR DEL PRECIO Y LA BAJA LÓGICA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-76 · quitar un precio ya NO es un deleteMany físico", () => {
  const cuerpo = cuerpoDe(TARIFAS(), "setEduProcedurePrices");
  assert.equal(
    /eduFeeScheduleItem\.deleteMany/.test(cuerpo),
    false,
    "borrar la fila se lleva por delante el único rastro de que ese precio existió",
  );
  assert.match(cuerpo, /updateMany\(\{[\s\S]*deletedAt:\s*now/);
  // Y con `deletedAt: null` en el `where`: volver a vaciar una celda ya
  // vacía no puede mover la fecha de baja.
  assert.match(cuerpo, /deletedAt:\s*null,\s*\n?\s*\},\s*\n?\s*data:/);
});

test("🔴 H-76 · volver a poner un precio REVIVE la fila (el índice único no es parcial)", () => {
  const cuerpo = cuerpoDe(TARIFAS(), "setEduProcedurePrices");
  assert.match(cuerpo, /upsert\(/);
  // El `update` del upsert limpia la baja: insertar otra fila chocaría
  // contra `@@unique([feeScheduleId, procedureId])`.
  assert.match(cuerpo, /update:\s*\{[\s\S]*deletedAt:\s*null/);
  assert.match(cuerpo, /deletedById:\s*null/);
});

test("🔴 H-76 · el autor y `priceSetAt` se escriben, y la fecha SOLO cuando cambia el importe", () => {
  const cuerpo = cuerpoDe(TARIFAS(), "setEduProcedurePrices");
  assert.match(cuerpo, /createdByUserId:\s*ctx\.eduUserId/);
  assert.match(cuerpo, /updatedByUserId:\s*ctx\.eduUserId/);
  assert.match(cuerpo, /updatedByName:\s*autor/);
  assert.match(cuerpo, /priceSetAt:\s*now/);
  // La condición que distingue "cambió el precio" de "se tocó la fila".
  assert.match(cuerpo, /antes\.get\(it\.feeScheduleId\)\?\.priceCents\s*===\s*it\.priceCents/);
});

test("🔴 H-76 · NINGUNA lectura de precios cotiza una fila retirada", () => {
  const src = TARIFAS();
  // CINCO lecturas de `eduFeeScheduleItem` en todo el archivo. Tres
  // cotizan (y llevan el filtro) y DOS incluyen las retiradas a
  // propósito: el rastro de H-76 y la foto del "antes" que arma el
  // renglón de bitácora. Si aparece una sexta, este recuento se rompe y
  // hay que mirarla una por una.
  const lecturas = src.match(/eduFeeScheduleItem\.findMany\(/g) ?? [];
  assert.equal(lecturas.length, 5, "¿apareció una lectura nueva de precios?");
  // Las tres que cotizan + los dos `_count`.
  const conFiltro = src.match(/deletedAt:\s*null/g) ?? [];
  assert.ok(
    conFiltro.length >= 5,
    `solo ${conFiltro.length} filtros de baja lógica: falta alguno y ese cotizaría precios retirados`,
  );
  // Las DOS que sí las incluyen, y por qué.
  const rastro = cuerpoDe(src, "getEduProcedurePrecioRastro");
  assert.equal(/deletedAt:\s*null/.test(rastro), false);
  const escritura = cuerpoDe(src, "setEduProcedurePrices");
  assert.match(escritura, /const previas = await prisma\.eduFeeScheduleItem\.findMany/);
});

test("🔴 H-76 · un cambio de precio deja renglón en la bitácora", () => {
  assert.match(cuerpoDe(TARIFAS(), "setEduProcedurePrices"), /eduAudit\(/);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · PRESUPUESTOS
// ═══════════════════════════════════════════════════════════════════════

test("🔴 el descuento global se reparte al CENTAVO: el último renglón absorbe el resto", () => {
  // Tres partidas de $100 y $100 de descuento: 33.33 + 33.33 + 33.34.
  // Repartir y redondear cada línea daría 99.99 y el cobro saldría un
  // centavo por encima del papel que el paciente firmó.
  const lineas = [1, 2, 3].map((n) => ({
    procedureId: `p${n}`,
    description: `Partida ${n}`,
    quantity: 1,
    unitPriceCents: 10_000,
    discountCents: 0,
    clientPriceCents: null,
  }));
  const repartido = eduQuoteRepartirDescuento(lineas, 10_000);
  assert.equal(
    repartido.reduce((a, l) => a + l.discountCents, 0),
    10_000,
    "la suma de los descuentos repartidos TIENE que ser el descuento global",
  );
  const total = repartido.reduce(
    (a, l) => a + (l.quantity * l.unitPriceCents - l.discountCents),
    0,
  );
  assert.equal(total, 30_000 - 10_000);
});

test("🔴 el reparto CUADRA aunque una partida se quede sin sitio", () => {
  // El caso que rompe la regla de tres a secas: $0.07 + $0.01 + $0.01 con
  // $0.05 de descuento global. Repartiendo proporcional y capando, la
  // última partida no admite su parte y quedaba un centavo sin repartir:
  // el cobro salía UN CENTAVO por encima del presupuesto firmado.
  const lineas = [7, 1, 1].map((c, n) => ({
    procedureId: null,
    description: `L${n}`,
    quantity: 1,
    unitPriceCents: c,
    discountCents: 0,
    clientPriceCents: null,
  }));
  const r = eduQuoteRepartirDescuento(lineas, 5);
  assert.equal(r.reduce((a, l) => a + l.discountCents, 0), 5);
  // Y ninguna línea con más descuento que su importe.
  for (const l of r) assert.ok(l.discountCents <= l.quantity * l.unitPriceCents);
  // El total del cobro = el total del presupuesto, al centavo.
  assert.equal(
    r.reduce((a, l) => a + (l.quantity * l.unitPriceCents - l.discountCents), 0),
    9 - 5,
  );
});

test("el reparto respeta el descuento que YA traía cada partida", () => {
  const lineas = [
    { procedureId: null, description: "A", quantity: 1, unitPriceCents: 10_000, discountCents: 1_000, clientPriceCents: null },
    { procedureId: null, description: "B", quantity: 1, unitPriceCents: 10_000, discountCents: 0, clientPriceCents: null },
  ];
  const r = eduQuoteRepartirDescuento(lineas, 1_900);
  // Los descuentos de línea NO se pisan: se les SUMA la parte global.
  assert.ok(r[0].discountCents >= 1_000);
  assert.equal(
    r.reduce((a, l) => a + l.discountCents, 0),
    1_000 + 1_900,
  );
});

test("el reparto no deja ninguna línea en negativo ni toca nada si no hay descuento", () => {
  const una = [
    {
      procedureId: null,
      description: "Material",
      quantity: 1,
      unitPriceCents: 5_000,
      discountCents: 0,
      clientPriceCents: null,
    },
  ];
  assert.deepEqual(eduQuoteRepartirDescuento(una, 0), una);
  // Un descuento mayor que el importe se topa en el importe: no hay
  // regalos con vuelto, y la línea nunca queda en negativo.
  const topado = eduQuoteRepartirDescuento(una, 99_999);
  assert.equal(topado[0].discountCents, 5_000);
});

test("🔴 la conversión es idempotente POR COLUMNA y NO vuelve a cotizar", () => {
  const cuerpo = cuerpoDe(PRESU(), "convertirEduQuote");
  // La llave de idempotencia es `chargeId`, no una clave del cliente.
  assert.match(cuerpo, /q\.chargeId/);
  assert.match(cuerpo, /duplicado/);
  // El sellado lleva `chargeId: null` en el `where`: dos clics a la vez no
  // pueden dejar los DOS cobros vivos en silencio.
  assert.match(cuerpo, /updateMany\(\{[\s\S]*chargeId:\s*null/);
  // Y los precios van CONGELADOS.
  assert.match(cuerpo, /lineasCongeladas/);
  assert.equal(
    /resolveEduChargeLines/.test(cuerpo),
    false,
    "re-cotizar traicionaría el precio que el paciente aceptó y firmó",
  );
  // Solo un ACEPTADO se convierte.
  assert.match(cuerpo, /"ACEPTADO"/);
  // Y los dos topes, que NO son el mismo: 60 partidas contra 50
  // conceptos. Sin esta comprobación el fallo salía con el paciente
  // delante y el papel ya firmado.
  assert.match(cuerpo, /EDU_MAX_CHARGE_ITEMS/);
});

test("🔴 `lineasCongeladas` es un camino de SERVIDOR: ninguna ruta lo lee del body", () => {
  const caja = cuerpoDe(CAJA(), "createEduCharge");
  assert.match(caja, /options\.lineasCongeladas/);
  // Si viniera del body sería un agujero en el antifraude del precio.
  assert.equal(/input\.lineasCongeladas|body\.lineasCongeladas/.test(caja), false);
  for (const ruta of [
    ["src", "app", "api", "instituto", "caja", "cobros", "route.ts"],
    ["src", "app", "api", "instituto", "presupuestos", "[id]", "convertir", "route.ts"],
  ]) {
    assert.equal(
      /lineasCongeladas/.test(fuenteDe(...ruta)),
      false,
      `${ruta.join("/")} no puede pasar líneas congeladas desde la petición`,
    );
  }
});

test("un presupuesto se puede crear DESDE un plan de tratamiento, y hereda su caso", () => {
  const cuerpo = cuerpoDe(PRESU(), "createEduQuote");
  // La columna que la C·base dejó puesta y que no escribía nadie.
  assert.match(cuerpo, /treatmentPlanId/);
  // Con pertenencia comprobada: el plan tiene que ser DE ESE paciente.
  assert.match(cuerpo, /eduTreatmentPlan\.findFirst/);
  assert.match(cuerpo, /patientId:\s*paciente\.id/);
  // Y hereda el caso del plan cuando no mandan otro.
  assert.match(cuerpo, /plan\?\.caseId/);
});

test("un presupuesto solo se EDITA en borrador, y el estado va en el `where`", () => {
  const cuerpo = cuerpoDe(PRESU(), "updateEduQuote");
  assert.match(cuerpo, /!==\s*"BORRADOR"/);
  assert.match(cuerpo, /updateMany\(\{[\s\S]*status:\s*"BORRADOR"/);
  assert.match(cuerpo, /409/);
  // Partidas y totales, en la MISMA transacción.
  assert.match(cuerpo, /\$transaction/);
});

test("un ACEPTADO no se des-acepta: la tabla de transiciones lo dice", () => {
  assert.deepEqual(EDU_QUOTE_TRANSITIONS.ACEPTADO, []);
  assert.deepEqual(EDU_QUOTE_TRANSITIONS.CANCELADO, []);
});

test("el PDF de un presupuesto no sale en BORRADOR", () => {
  const cuerpo = cuerpoDe(PRESU(), "getEduQuotePdfData");
  assert.match(cuerpo, /"BORRADOR"/);
  assert.match(cuerpo, /409/);
});

test("los totales del presupuesto son la MISMA aritmética en pantalla y en la base", () => {
  // `eduQuoteTotales` es puro y lo llaman los dos lados: se prueba el caso
  // que rompe un redondeo mal hecho.
  const items = [
    { quantity: 3, unitPriceCents: 33_333, discountCents: 0 },
    { quantity: 1, unitPriceCents: 1, discountCents: 0 },
  ];
  const t = eduQuoteTotales(items, 33.33, 0);
  assert.equal(t.subtotalCents, 100_000);
  assert.equal(t.discountCents, Math.round((100_000 * 33.33) / 100));
  assert.equal(t.totalCents, t.subtotalCents - t.discountCents);
});

test("la fila del presupuesto que viaja a la pantalla es client-safe", () => {
  // El tipo vive en el core, no en presupuestos.ts (que importa prisma).
  const core = fuenteDe("src", "lib", "edu", "presupuestos-core.ts");
  assert.match(core, /export interface EduQuoteRow/);
  assert.equal(core.includes("@/lib/prisma"), false);
  const fila: EduQuoteRow["status"] = "BORRADOR";
  assert.equal(fila, "BORRADOR");
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · H-78 · EL CSV DE FACTURACIÓN
// ═══════════════════════════════════════════════════════════════════════

function facturaDePrueba(over: Partial<EduInvoiceRow> = {}): EduInvoiceRow {
  return {
    id: "inv_1",
    folio: "F-0001",
    status: "VALID",
    environment: "LIVE",
    chargeId: "c1",
    chargeFolio: "C-0007",
    patientId: "p1",
    patientName: "María Rodríguez",
    patientFolio: "PAC-0003",
    receptorRfc: "XAXX010101000",
    receptorLegalName: "PÚBLICO EN GENERAL",
    receptorTaxRegime: "616",
    receptorZip: "22000",
    receptorEmail: null,
    usoCfdi: "D01",
    paymentForm: "01",
    taxMode: "EXENTO",
    subtotalCents: 120_000,
    discountCents: 20_000,
    totalCents: 100_000,
    conceptos: [],
    uuid: "AAAA-BBBB",
    stampedAt: null,
    issuedAt: "2026-03-31T23:00:00.000Z",
    issuedAtLabel: "31 de marzo de 2026, 17:00",
    issuedByName: "Caja Norte",
    cancelledAt: null,
    cancelledByName: null,
    cancelMotive: null,
    cancelReason: null,
    errorMessage: null,
    hasXml: true,
    hasDocument: true,
    ...over,
  };
}

test("🔴 H-78 · el CSV lleva BOM y CRLF: sin ellos Excel lo abre mal o en una sola línea", () => {
  const csv = eduInvoicesCsv([facturaDePrueba()]);
  assert.ok(csv.startsWith("﻿"), "sin BOM, «Rodríguez» sale «RodrÃ­guez» en Excel");
  assert.ok(csv.includes("\r\n"));
});

test("🔴 H-78 · el encabezado y la fila tienen EXACTAMENTE las mismas columnas", () => {
  // Una columna añadida en un sitio y no en el otro corre el archivo
  // entero y el error se ve una semana después, en una conciliación.
  const csv = eduInvoicesCsv([facturaDePrueba()]);
  const [cabecera, fila] = csv.replace("﻿", "").split("\r\n");
  const cuenta = (l: string) => (l.match(/","/g) ?? []).length + 1;
  assert.equal(cuenta(cabecera), EDU_INVOICE_CSV_COLUMNAS.length);
  assert.equal(cuenta(fila), EDU_INVOICE_CSV_COLUMNAS.length);
});

test("🔴 H-78 · una celda que empieza por `=` NO se ejecuta como fórmula al abrirla", () => {
  // Inyección CSV de manual: la razón social del receptor y el motivo de
  // una cancelación los escribe una persona.
  assert.equal(eduCsvCelda("=1+1"), "\"'=1+1\"");
  assert.equal(eduCsvCelda("+34 600"), "\"'+34 600\"");
  assert.equal(eduCsvCelda("@sat"), "\"'@sat\"");
  // Y las comillas se duplican, que es lo que dice el estándar.
  assert.equal(eduCsvCelda('Dice "hola"'), '"Dice ""hola"""');
  assert.equal(eduCsvCelda(null), '""');
});

test("los importes salen en punto decimal, sin símbolo y SIN signo menos", () => {
  // Un `-` inicial también dispara la fórmula de Excel; el descuento va en
  // su propia columna y en positivo.
  assert.equal(eduCsvImporte(100_000), "1000.00");
  assert.equal(eduCsvImporte(5), "0.05");
  assert.equal(eduCsvImporte(-2_50), "2.50");
});

test("el nombre del archivo lleva el rango que se exportó", () => {
  const base: EduInvoiceFilters = { q: "", status: null, desde: null, hasta: null };
  assert.equal(eduInvoicesCsvNombre(base), "facturas.csv");
  assert.equal(
    eduInvoicesCsvNombre({ ...base, desde: "2026-03-01", hasta: "2026-03-31" }),
    "facturas-2026-03-01_a_2026-03-31.csv",
  );
});

test("🔴 H-78 · el CSV sale de los MISMOS filtros y la MISMA consulta que la lista", () => {
  const ruta = fuenteDe("src", "app", "api", "instituto", "facturacion", "csv", "route.ts");
  assert.match(ruta, /parseEduInvoiceFilters/);
  assert.match(ruta, /listEduInvoices/);
  assert.match(ruta, /eduApiGuard\("facturacion\.view"\)/);
  // Y deja renglón de EXPORT: la NOM-024 pregunta cuándo SALIÓ un dato.
  assert.match(ruta, /action:\s*"export"/);
  assert.match(ruta, /text\/csv/);
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · LA BITÁCORA DEL DINERO
// ═══════════════════════════════════════════════════════════════════════

test("🔴 cobros, devoluciones, cancelaciones, cortes, precios y presupuestos llaman a eduAudit", () => {
  const caja = CAJA();
  for (const fn of [
    "createEduCharge",
    "addEduPayment",
    "cancelEduCharge",
    "openEduCashSession",
    "closeEduCashSession",
    "setEduCashSessionOpening",
  ]) {
    assert.match(cuerpoDe(caja, fn), /eduAudit\(/, `${fn} no deja renglón de bitácora`);
  }
  assert.match(cuerpoDe(TARIFAS(), "setEduProcedurePrices"), /eduAudit\(/);
  assert.match(
    cuerpoDe(fuenteDe("src", "lib", "edu", "facturacion.ts"), "cancelEduInvoice"),
    /eduAudit\(/,
  );
  const presu = PRESU();
  for (const fn of ["createEduQuote", "updateEduQuote", "presentarEduQuote", "cambiarEstadoEduQuote"]) {
    assert.match(cuerpoDe(presu, fn), /eduAudit\(/, `${fn} no deja renglón de bitácora`);
  }
});

test("la bitácora NUNCA va dentro de la transacción del dinero", () => {
  // `eduAudit` no lanza, pero meterla dentro de la transacción del cobro
  // le daría la oportunidad de alargarla: un renglón de auditoría no puede
  // hacer esperar a un pago.
  const cuerpo = cuerpoDe(CAJA(), "createEduCharge");
  const iFin = cuerpo.indexOf("return cobro;");
  const iAudit = cuerpo.indexOf("await eduAudit(");
  assert.ok(iFin !== -1 && iAudit !== -1 && iAudit > iFin);
});
