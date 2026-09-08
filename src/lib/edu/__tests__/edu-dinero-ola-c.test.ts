/**
 * OLA C·1 — EL DINERO DEL INSTITUTO: caja, cortes, tarifas y facturación.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-dinero-ola-c.test.ts
 *       (o `npm run test:edu`, que descubre este archivo solo)
 *
 * Fija los hallazgos de la auditoría del 6-sep-2026 que esta ola cierra.
 * Mismo enfoque doble que `edu-cierre.test.ts`, y por la misma razón: la
 * mitad de lo que se arregla vive en funciones PURAS (y se prueba
 * llamándolas), y la otra mitad vive en la capa que consulta Prisma —un
 * `where` al que le faltaba el estado, un upsert en el orden equivocado, un
 * candado que no estaba—. Eso segundo se comprueba LEYENDO EL ARCHIVO, con
 * los comentarios quitados: un archivo se juzga por lo que hace, no por lo
 * que dice su prosa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eduCorteAgrupar,
  type EduCorteGrupoInput,
} from "../dinero-core";
import {
  EDU_FORMA_PAGO_POR_DEFINIR,
  eduDescribeFormaPago,
  eduDesgloseIva,
  eduMetodoPagoDeCobro,
  eduNextInvoiceFolio,
  eduSugerirFormaPago,
  parseEduInvoiceFilters,
} from "../facturacion-core";
import {
  resolveEduChargeLines,
  resolveFeeSchedule,
  type EduFeeItemData,
  type EduFeeScheduleData,
  type EduPacienteTarifaData,
  type EduProcedureData,
  type EduTarifaFuente,
} from "../tarifas";

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** El archivo, sin comentarios: se juzga por lo que hace, no por lo que dice. */
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
const FACT = () => fuenteDe("src", "lib", "edu", "facturacion.ts");
const TARIFAS = () => fuenteDe("src", "lib", "edu", "tarifas.ts");

// ═════════════════════════════════════════════════════════════════════
// H-10 · LAS LISTAS "MANUAL" SE APLICAN
//
// Se prueba de VERDAD (no leyendo el archivo) porque tarifas.ts recibe su
// FUENTE de datos como parámetro: lo que corre aquí son las funciones
// reales, con sus guardias y su orden de decisión.
// ═════════════════════════════════════════════════════════════════════

const INST = "inst_1";

const PUBLICO: EduFeeScheduleData = {
  id: "fs_pub",
  key: "publico",
  name: "Público general",
  rule: "MANUAL",
  isDefault: true,
  isActive: true,
  orderIndex: 1,
};
const ALUMNO: EduFeeScheduleData = {
  id: "fs_alu",
  key: "alumno",
  name: "Paciente de alumno",
  rule: "REFERRED_BY_STUDENT",
  isDefault: false,
  isActive: true,
  orderIndex: 2,
};
const CONVENIO: EduFeeScheduleData = {
  id: "fs_conv",
  key: "convenio-sindicato",
  name: "Convenio sindicato",
  rule: "MANUAL",
  isDefault: false,
  isActive: true,
  orderIndex: 3,
};
const CAMPANA_VIEJA: EduFeeScheduleData = {
  id: "fs_vieja",
  key: "campana-mayo",
  name: "Campaña de mayo",
  rule: "MANUAL",
  isDefault: false,
  isActive: false,
  orderIndex: 4,
};

const SOLO: EduPacienteTarifaData = {
  id: "pac_solo",
  referredByStudentId: null,
  referredByStudentName: null,
  referredByStudentMatricula: null,
};
const TRAIDO: EduPacienteTarifaData = {
  id: "pac_traido",
  referredByStudentId: "stu_1",
  referredByStudentName: "Sofía Ibarra",
  referredByStudentMatricula: "A-014",
};

const ENDO: EduProcedureData = {
  id: "proc_endo",
  code: "ENDO-1",
  name: "Endodoncia unirradicular",
  category: "Endodoncia",
  durationMinutes: 90,
  isActive: true,
};

const PRECIOS: EduFeeItemData[] = [
  { feeScheduleId: PUBLICO.id, procedureId: ENDO.id, priceCents: 250000 },
  { feeScheduleId: ALUMNO.id, procedureId: ENDO.id, priceCents: 90000 },
  { feeScheduleId: CONVENIO.id, procedureId: ENDO.id, priceCents: 120000 },
];

function fuente(): EduTarifaFuente {
  const listas = [PUBLICO, ALUMNO, CONVENIO, CAMPANA_VIEJA];
  const pacientes = [SOLO, TRAIDO];
  return {
    async listas(institutionId) {
      return institutionId === INST ? listas : [];
    },
    async paciente(institutionId, patientId) {
      if (institutionId !== INST) return null;
      return pacientes.find((p) => p.id === patientId) ?? null;
    },
    async procedimientos(institutionId, ids) {
      return institutionId === INST && ids.includes(ENDO.id) ? [ENDO] : [];
    },
    async precios(institutionId, ids) {
      if (institutionId !== INST) return [];
      return PRECIOS.filter((p) => ids.includes(p.procedureId));
    },
  };
}

test("🔴 H-10 · sin elección a mano, la regla de siempre", async () => {
  const m = await resolveFeeSchedule(INST, TRAIDO.id, fuente());
  assert.equal(m?.feeScheduleId, ALUMNO.id);
  assert.equal(m?.manual, false);
});

test("🔴 H-10 · una lista MANUAL elegida a mano SE APLICA", async () => {
  const m = await resolveFeeSchedule(INST, SOLO.id, fuente(), {
    feeScheduleId: CONVENIO.id,
  });
  assert.equal(m?.feeScheduleId, CONVENIO.id);
  assert.equal(m?.manual, true);
  assert.match(m?.reason ?? "", /a mano/i);
});

test("🔴 H-10 · la elección a mano GANA a la regla automática, y lo dice", async () => {
  const m = await resolveFeeSchedule(INST, TRAIDO.id, fuente(), {
    feeScheduleId: CONVENIO.id,
  });
  assert.equal(m?.feeScheduleId, CONVENIO.id, "gana el convenio, no la de alumno");
  // Y el motivo NO esconde que al paciente lo trajo un alumno: quien lee el
  // recibo tiene que poder ver las dos cosas.
  assert.match(m?.reason ?? "", /Sofía Ibarra/);
});

test("🔴 H-10 · el PRECIO sale de la lista elegida, no del navegador", async () => {
  const r = await resolveEduChargeLines(
    INST,
    SOLO.id,
    [{ procedureId: ENDO.id, quantity: 1, unitPriceCents: "1.00" }],
    fuente(),
    { feeScheduleId: CONVENIO.id },
  );
  assert.equal(r.applied?.feeScheduleId, CONVENIO.id);
  assert.equal(r.lines[0].unitPriceCents, 120000, "el precio del convenio, no el del cliente");
  assert.equal(r.descartados, 1, "el precio del cliente se descarta y queda registrado");
  assert.equal(r.lines[0].clientPriceCents, 100);
});

test("🔴 H-10 · una lista DESACTIVADA no se puede elegir", async () => {
  await assert.rejects(
    () => resolveFeeSchedule(INST, SOLO.id, fuente(), { feeScheduleId: CAMPANA_VIEJA.id }),
    /desactivada/i,
  );
});

test("🔴 H-10 · una lista de regla AUTOMÁTICA no se elige a mano", async () => {
  // Si se pudiera, bastaría con elegirla para saltarse el dato que la
  // dispara (quién trajo al paciente), que es justo lo que el navegador no
  // controla.
  await assert.rejects(
    () => resolveFeeSchedule(INST, SOLO.id, fuente(), { feeScheduleId: ALUMNO.id }),
    /se aplica sola/i,
  );
});

test("🔴 H-10 · una lista de OTRO instituto no existe aquí", async () => {
  await assert.rejects(
    () => resolveFeeSchedule(INST, SOLO.id, fuente(), { feeScheduleId: "fs_de_otra_escuela" }),
    /no es de este instituto/i,
  );
});

test("H-10 · el cobro pasa la lista elegida a la resolución de precios", () => {
  const cuerpo = cuerpoDe(CAJA(), "createEduCharge");
  assert.match(cuerpo, /feeScheduleId:\s*input\.feeScheduleId/);
});

// ═════════════════════════════════════════════════════════════════════
// H-06 · EL ABONO PARCIAL LLEVA LLAVE DE IDEMPOTENCIA
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-06 · addEduPayment acepta la clave y devuelve `duplicado`", () => {
  const cuerpo = cuerpoDe(CAJA(), "addEduPayment");
  assert.match(cuerpo, /parseIdempotencyKey\(input\.idempotencyKey\)/, "la clave se VALIDA");
  assert.match(cuerpo, /duplicado:\s*true/, "la repetida NO cobra otra vez");
  // El candado es el índice único de la LLAVE PRIMARIA: la clave se usa
  // como `id` de la fila, así que un segundo POST idéntico choca con un
  // P2002 que revienta la transacción entera.
  assert.match(
    cuerpo,
    /ids\.length === 0 \? \{ id: idemKey \}/,
    "la primera forma de pago lleva el id determinista",
  );
});

test("🔴 H-06 · el POST simultáneo NO sale con un 500", () => {
  // El pre-chequeo solo atrapa el reintento SECUENCIAL. Dos peticiones a la
  // vez pasan las dos y la segunda choca contra la llave primaria: sin
  // capturar ese P2002, salía como "500 · Intenta de nuevo", que es
  // exactamente la frase que este hallazgo viene a matar.
  const cuerpo = cuerpoDe(CAJA(), "addEduPayment");
  assert.match(cuerpo, /code\?:\s*string\s*\}\)\?\.code === "P2002"/);
  assert.match(cuerpo, /const ganador = await eduPagoDeLaClave/);
});

test("🔴 H-06 · la clave NUNCA se consulta sin tenant", () => {
  // `id` es único en toda la tabla, no por instituto: preguntar por el id
  // pelado convertiría el endpoint en un oráculo de existencia entre
  // escuelas (regla (c) de CLAUDE.md).
  const src = CAJA();
  assert.match(
    src,
    /where:\s*\{\s*id:\s*key,\s*institutionId,\s*chargeId\s*\}/,
    "eduPagoDeLaClave lleva institutionId y chargeId",
  );
  assert.ok(
    !/eduPayment\.findUnique/.test(src),
    "no queda ninguna lectura de EduPayment por id pelado",
  );
});

test("H-06 · eduApplyEduPaymentInTx sabe escribir el id determinista", () => {
  const cuerpo = cuerpoDe(CAJA(), "eduApplyEduPaymentInTx");
  assert.match(cuerpo, /pago\.id \? \{ id: pago\.id \} : \{\}/);
});

// ═════════════════════════════════════════════════════════════════════
// H-11 · CANCELAR UN COBRO CON CFDI VIVO REBOTA
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-11 · cancelEduCharge mira la factura viva y dice qué hacer", () => {
  const cuerpo = cuerpoDe(CAJA(), "cancelEduCharge");
  assert.match(cuerpo, /eduInvoice\.findFirst/, "consulta la factura");
  assert.match(cuerpo, /activeChargeId:\s*id/, "«viva» es activeChargeId != null");
  assert.match(cuerpo, /Cancela primero el CFDI/i, "el mensaje dice qué hacer");
  // Y la condición se repite en el `where` del updateMany: la lectura de
  // arriba también fue fuera de la transacción.
  assert.match(cuerpo, /invoices:\s*\{\s*none:\s*\{\s*activeChargeId:\s*\{\s*not:\s*null\s*\}/);
});

// ═════════════════════════════════════════════════════════════════════
// H-47 / H-55 · LA DEVOLUCIÓN SALE POR DONDE ENTRÓ, Y CON MOTIVO
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-47 · la devolución se topa contra el NETO DE SU MÉTODO", () => {
  const cuerpo = cuerpoDe(CAJA(), "addEduPayment");
  assert.match(cuerpo, /eduNetoPorMetodo\(reales\)/);
  assert.match(cuerpo, /dev\.amountCents > disponible/);
  // La salida de emergencia es "Otro", que ya exige motivo escrito.
  assert.match(cuerpo, /dev\.method !== "OTHER"/);
});

test("🔴 H-47 · el tope por método se comprueba DENTRO de la transacción", () => {
  // Comprobarlo fuera es un check-then-act: dos devoluciones simultáneas de
  // $1,000 por débito sobre un cobro pagado mitad débito y mitad efectivo
  // pasaban las dos y dejaban el débito en −$1,000. El candado de la fila
  // se toma ANTES de leer los pagos.
  const cuerpo = cuerpoDe(CAJA(), "addEduPayment");
  const tx = cuerpo.indexOf("prisma.$transaction");
  const chequeo = cuerpo.indexOf("eduNetoPorMetodo(reales)");
  assert.ok(tx > 0 && chequeo > tx, "el chequeo vive dentro de la transacción");
  assert.match(cuerpo, /balanceCents:\s*\{\s*increment:\s*0\s*\}/, "toma el candado de la fila");
  assert.match(cuerpo, /tx\.eduPayment\.findMany/, "y relee los pagos con el candado puesto");
});

test("🔴 H-47 · no se manda a nadie a devolver por un método que no existe", () => {
  // El legado "CARD" puede tener el dinero y ya no se puede elegir: decir
  // "devuelve por ahí" sería un callejón sin salida.
  const cuerpo = cuerpoDe(CAJA(), "addEduPayment");
  assert.match(cuerpo, /EDU_PAYMENT_METHODS_COBRABLES as string\[\]\)\.includes\(m\)/);
  // Y la pantalla tampoco arranca en un método que su desplegable no pinta.
  assert.match(
    CAJA_UI(),
    /EDU_PAYMENT_METHODS_COBRABLES as readonly string\[\]\)\.includes\(p\.method\)/,
  );
});

test("🔴 H-55 · la devolución EXIGE motivo", () => {
  const cuerpo = cuerpoDe(CAJA(), "addEduPayment");
  assert.match(cuerpo, /pagos\[0\]\.notes\.trim\(\)\.length < 3/);
});

// ═════════════════════════════════════════════════════════════════════
// H-48 / H-66 · LAS DOS CARRERAS: updateMany CON EL ESTADO EN EL WHERE
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-48 · el cierre del turno lleva `closedAt: null` en el where y 409", () => {
  const cuerpo = cuerpoDe(CAJA(), "closeEduCashSession");
  assert.match(cuerpo, /eduCashSession\.updateMany/);
  assert.match(cuerpo, /closedAt:\s*null/);
  assert.match(cuerpo, /count === 0/);
  assert.match(cuerpo, /409/);
  assert.ok(
    !/eduCashSession\.update\(\{\s*where:\s*\{\s*id:\s*abierta\.id\s*\}/.test(cuerpo),
    "ya no queda el update por id a secas",
  );
});

test("🔴 H-66 · cancelar un CFDI reserva ANTES de hablar con el SAT", () => {
  const cuerpo = cuerpoDe(FACT(), "cancelEduInvoice");
  const reserva = cuerpo.indexOf("eduInvoice.updateMany");
  const sat = cuerpo.indexOf("await cancelInvoice(");
  assert.ok(reserva > 0, "hay una reserva con updateMany");
  assert.ok(sat > 0, "sigue llamando al SAT");
  assert.ok(reserva < sat, "la reserva va PRIMERO: si no, dos peticiones cancelan dos veces");
  assert.match(cuerpo, /status:\s*"VALID"/, "el estado va en el where");
  assert.match(cuerpo, /reserva\.count === 0/);
  // Y si el SAT dice que no, la reserva se SUELTA: si no, la factura se
  // quedaría marcada y el siguiente intento chocaría con el 409 para siempre.
  assert.match(cuerpo, /cancelledAt:\s*null,\s*cancelledByUserId:\s*null/);
});

test("🔴 H-66 · la reserva CADUCA: no hay estado sin salida", () => {
  // Si el proceso muere entre la reserva y la respuesta del SAT, una
  // reserva eterna dejaría esa factura en 409 para siempre —y
  // `resolveEduStuckInvoice` solo toca las STAMPING, así que no habría
  // ninguna vía de recuperación.
  const cuerpo = cuerpoDe(FACT(), "cancelEduInvoice");
  assert.match(cuerpo, /OR:\s*\[\{ cancelledAt: null \}, \{ cancelledAt: \{ lt: caducada \} \}\]/);
  assert.match(FACT(), /const EDU_CANCEL_RESERVA_MIN = \d+/);
});

test("🔴 H-66 · «rechazó» y «no contestó» no son lo mismo", () => {
  // Soltar la reserva ante un timeout dejaría la factura viva con el cobro
  // ocupado y un mensaje que afirma que el SAT la rechazó — cuando la
  // cancelación pudo llegar. Emitir ya hacía esta distinción.
  const cuerpo = cuerpoDe(FACT(), "cancelEduInvoice");
  const dudoso = cuerpo.indexOf("pudoHaberTimbrado(err)");
  const suelta = cuerpo.indexOf("cancelledAt: null,");
  assert.ok(dudoso > 0, "se pregunta si pudo haber llegado");
  assert.ok(dudoso < suelta, "y solo se suelta la reserva cuando NO llegó");
  assert.match(cuerpo, /502/);
});

// ═════════════════════════════════════════════════════════════════════
// H-12 · PUE / PPD SEGÚN EL SALDO
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-12 · un cobro liquidado sale PUE con su forma de pago", () => {
  const d = eduMetodoPagoDeCobro({ balanceCents: 0, paymentForm: "01" });
  assert.equal(d.metodo, "PUE");
  assert.equal(d.paymentForm, "01");
  assert.equal(d.aviso, null);
});

test("🔴 H-12 · con saldo abierto sale PPD y la forma pasa a «99 · Por definir»", () => {
  const d = eduMetodoPagoDeCobro({ balanceCents: 240000, paymentForm: "01" });
  assert.equal(d.metodo, "PPD");
  assert.equal(d.paymentForm, EDU_FORMA_PAGO_POR_DEFINIR);
  assert.equal(d.paymentForm, "99");
  assert.ok(d.aviso && d.aviso.includes("$2,400.00"), "el aviso dice cuánto se debe");
});

test("H-12 · el «99» se pinta con palabras, no como código", () => {
  assert.match(eduDescribeFormaPago("99"), /Por definir/i);
  assert.match(eduDescribeFormaPago("01"), /Efectivo/i);
});

test("🔴 H-12 · el timbrado manda el método y el dental no cambia", () => {
  const cuerpo = cuerpoDe(FACT(), "emitEduInvoice");
  assert.match(cuerpo, /paymentMethod:\s*metodoPago\.metodo/);
  assert.match(cuerpo, /const paymentForm = metodoPago\.paymentForm/);
  // El helper COMPARTIDO con el dental mantiene "PUE" por defecto: sin el
  // parámetro, /api/cfdi se comporta exactamente igual línea por línea.
  const facturapi = fuenteDe("src", "lib", "facturapi.ts");
  assert.match(facturapi, /payment_method:\s*params\.paymentMethod \?\? "PUE"/);
});

// ═════════════════════════════════════════════════════════════════════
// H-09 / H-60 · EL DESGLOSE DEL TURNO
// ═════════════════════════════════════════════════════════════════════

const pago = (
  key: string,
  label: string,
  method: EduCorteGrupoInput["method"],
  amountCents: number,
  isRefund = false,
): EduCorteGrupoInput => ({ key, label, method, amountCents, isRefund });

test("🔴 H-09 · el turno se desglosa por sede, y el efectivo va aparte", () => {
  const g = eduCorteAgrupar([
    pago("c_norte", "Norte", "CASH", 500000),
    pago("c_norte", "Norte", "CARD_DEBIT", 100000),
    pago("c_sur", "Sur", "CASH", 340000),
    pago("c_sur", "Sur", "CASH", 40000, true),
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].label, "Norte");
  assert.equal(g[0].cashNetCents, 500000, "solo el efectivo entra en el cajón");
  assert.equal(g[0].netCents, 600000, "el neto sí suma la tarjeta");
  assert.equal(g[1].cashNetCents, 300000, "la devolución RESTA del efectivo");
  assert.equal(g[1].count, 2);
});

test("H-09 · sin sede sellada el renglón existe igual, y se llama por su nombre", () => {
  const g = eduCorteAgrupar([pago("", "Sin sede sellada", "CASH", 1000)]);
  assert.equal(g[0].key, "");
  assert.equal(g[0].label, "Sin sede sellada");
});

test("🔴 H-60 · el MISMO agrupador sirve para «quién cobró qué»", () => {
  const g = eduCorteAgrupar([
    pago("u_ana", "Ana", "CASH", 80000),
    pago("u_beto", "Beto", "CASH", 20000),
  ]);
  assert.deepEqual(
    g.map((x) => x.label),
    ["Ana", "Beto"],
    "de mayor a menor efectivo: la hoja que se firma no puede bailar",
  );
});

test("H-09 · el corte calcula los dos desgloses desde los pagos del turno", () => {
  const src = CAJA();
  assert.match(src, /porSede = eduCorteAgrupar/);
  assert.match(src, /porCajero = eduCorteAgrupar/);
  // La sede se DERIVA del cobro porque el pago no la guarda y el turno
  // tampoco: es lo único que se puede decir sin la columna nueva.
  assert.match(src, /p\.charge\?\.campusId/);
  assert.match(src, /receivedByUserId:\s*true/);
});

// ═════════════════════════════════════════════════════════════════════
// H-68 · EL FOLIO NO MUERE EN LA FACTURA 10.000
// ═════════════════════════════════════════════════════════════════════

test("H-68 · el folio sigue rellenando a cuatro dígitos", () => {
  assert.equal(eduNextInvoiceFolio("F", null), "F-0001");
  assert.equal(eduNextInvoiceFolio("F", "F-0041"), "F-0042");
});

test("🔴 H-68 · pasado F-9999 el conteo desatasca el folio", () => {
  // El orden de Postgres es ALFABÉTICO: "F-10000" < "F-9999" como texto,
  // así que el "último" se congelaba en F-9999 y toda emisión posterior
  // moría en 409 contra el índice único.
  assert.equal(eduNextInvoiceFolio("F", "F-9999", 9999), "F-10000");
  assert.equal(eduNextInvoiceFolio("F", "F-9999", 10000), "F-10001");
  assert.equal(eduNextInvoiceFolio("F", "F-9999", 12345), "F-12346");
  // Y si hubiera huecos, manda el alfabético: el conteo nunca RETROCEDE.
  assert.equal(eduNextInvoiceFolio("F", "F-0500", 3), "F-0501");
});

test("H-68 · siguienteFolio pregunta las dos cosas", () => {
  const src = FACT();
  assert.match(src, /eduInvoice\.count\(\{ where \}\)/);
  assert.match(src, /eduNextInvoiceFolio\(prefix, ultimo\?\.folio \?\? null, emitidas\)/);
});

// ═════════════════════════════════════════════════════════════════════
// H-67 / H-69 / H-70 / H-71 / H-74 / H-78 / H-80 / H-82 · FACTURACIÓN
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-67 · el receptor se guarda DESPUÉS de saber que el timbre salió", () => {
  const cuerpo = cuerpoDe(FACT(), "emitEduInvoice");
  // El primer `eduPatientTaxProfile` del cuerpo es la LECTURA del receptor
  // guardado (paso 1d), que sigue yendo antes: lo que se movió es el
  // upsert.
  const upsert = cuerpo.search(/eduPatientTaxProfile[\s\S]{0,40}upsert/);
  const timbre = cuerpo.indexOf("await createInvoice(");
  assert.ok(upsert > 0 && timbre > 0);
  assert.ok(
    upsert > timbre,
    "antes se escribía el RFC ANTES de timbrar: un RFC rechazado quedaba guardado en el paciente",
  );
});

test("🔴 H-69 · buscar Y TIMBRAR respetan la sede", () => {
  assert.match(cuerpoDe(FACT(), "listEduCobrosFacturables"), /campusIds:\s*ctx\.campusIds/);
  // Recortar solo el buscador tapaba la lista pero no la puerta: un POST
  // con el id de un cobro de otra sede se timbraba igual.
  assert.match(cuerpoDe(FACT(), "emitEduInvoice"), /campusIds:\s*ctx\.campusIds/);
  const cobros = fuenteDe("src", "app", "api", "instituto", "facturacion", "cobros", "route.ts");
  assert.match(cobros, /getEduCampusScope/, "el endpoint resuelve el alcance y lo pasa");
  assert.match(cobros, /eduWithCampus/);
  const emitir = fuenteDe("src", "app", "api", "instituto", "facturacion", "route.ts");
  assert.match(emitir, /eduWithCampus\(g\.ctx, await getEduCampusScope\(g\.ctx\)\)/);
});

test("🔴 H-70 · el KPI separa lo fiscal de lo de PRUEBAS", () => {
  const cuerpo = cuerpoDe(FACT(), "listEduInvoices");
  assert.match(cuerpo, /r\.environment === "LIVE" \? acc\.live : acc\.test/);
  const pantalla = fuenteDe("src", "components", "edu", "facturacion", "facturacion-screen.tsx");
  assert.match(pantalla, /page\.totals\.live\.totalCents/);
  assert.match(pantalla, /page\.totals\.test\.vivas/);
});

test("🔴 H-71 · eduSugerirFormaPago ya tiene un llamador de producción", () => {
  // Estaba escrita y probada desde la Ola 10 y nadie la llamaba: caja
  // elegía a mano entre las ~20 formas del SAT con el paciente delante.
  const cuerpo = cuerpoDe(FACT(), "listEduCobrosFacturables");
  assert.match(cuerpo, /formaPagoSugerida:\s*eduSugerirFormaPago\(c\.payments\)/);
  // Y sigue diciendo lo que decía: gana el método de MAYOR monto neto.
  assert.equal(
    eduSugerirFormaPago([
      { method: "CASH", isRefund: false, paidAt: "2026-03-01T10:00:00Z", amountCents: 90000 },
      { method: "CARD_CREDIT", isRefund: false, paidAt: "2026-03-01T11:00:00Z", amountCents: 10000 },
    ]),
    "01",
  );
});

test("🔴 H-74 · el IVA se desglosa, y lo timbrado se compara con el cobro", () => {
  // EXENTO no desglosa nada: no hay IVA que separar.
  assert.equal(eduDesgloseIva([{ totalCents: 100000 }], "EXENTO"), null);
  // Con IVA16 el precio YA lo lleva dentro: la base es el total / 1.16.
  const d = eduDesgloseIva([{ totalCents: 116000 }], "IVA16");
  assert.equal(d?.baseCents, 100000);
  assert.equal(d?.ivaCents, 16000);
  assert.equal(d?.totalCents, 116000, "el total no cambia: es lo que pagó el paciente");
  // Y el descuadre entre lo que Facturapi dice haber timbrado y el cobro
  // queda ESCRITO en la factura en vez de descubrirse en la conciliación —
  // con TOLERANCIA (con IVA incluido, Facturapi redondea concepto a
  // concepto) y descartando el total cero, que es un dato que falta y no un
  // descuadre. Marcar como sospechosa una factura sana es peor que nada.
  const emit = cuerpoDe(FACT(), "emitEduInvoice");
  assert.match(emit, /const toleranciaCents = 1 \+ conceptos\.length/);
  assert.match(emit, /timbradoCents > 0/);
  assert.match(emit, /Math\.abs\(timbradoCents - charge\.totalCents\) > toleranciaCents/);
});

test("🔴 H-78 · la facturación se puede acotar por fechas", () => {
  const f = parseEduInvoiceFilters({ desde: "2026-03-01", hasta: "2026-03-31" });
  assert.equal(f.desde, "2026-03-01");
  assert.equal(f.hasta, "2026-03-31");
  // Lo que no es una fecha se descarta: entra en un `where`.
  assert.equal(parseEduInvoiceFilters({ desde: "marzo" }).desde, null);
  assert.equal(parseEduInvoiceFilters({ hasta: "2026-3-1" }).hasta, null);
  // Y el rango se traduce a instantes en la zona del INSTITUTO.
  const src = FACT();
  assert.match(src, /eduZonedToUtc\(filters\.desde, 0, timeZone\)/);
  assert.match(src, /eduZonedToUtc\(eduShiftDayISO\(filters\.hasta, 1\), 0, timeZone\)/);
});

test("🔴 H-80 · un cuerpo incompleto ya no apaga la facturación", () => {
  const cuerpo = cuerpoDe(FACT(), "saveEduFiscalConfig");
  assert.match(cuerpo, /previo\?\.isEnabled \?\? false/, "ausente = se conserva lo guardado");
  assert.match(cuerpo, /conservar<EduFiscalEnv>/);
  assert.ok(
    !/const isEnabled = input\.isEnabled === true;/.test(cuerpo),
    "ya no se apaga por omisión",
  );
  // Y bajar de EN VIVO a PRUEBAS deja de ser mudo.
  assert.match(cuerpo, /previo\?\.environment === "LIVE" && environment === "TEST"/);
});

test("🔴 H-80 · y los CUATRO obligatorios siguen la misma regla", () => {
  // Un `PUT {"isEnabled": false}` contestaba 400 "El RFC del instituto…":
  // el cuerpo no estaba pidiendo borrar el RFC, estaba apagando la
  // facturación.
  const cuerpo = cuerpoDe(FACT(), "saveEduFiscalConfig");
  assert.match(cuerpo, /ausente\(input\.rfc\) \? \(previo\?\.rfc \?\? null\)/);
  assert.match(cuerpo, /ausente\(input\.legalName\)/);
  assert.match(cuerpo, /ausente\(input\.taxRegime\)/);
  assert.match(cuerpo, /ausente\(input\.zipCode\)/);
  // Y lo que se manda a Facturapi es el régimen RESUELTO, no el del body.
  assert.match(cuerpo, /tax_system: taxRegime/);
});

test("H-81 · cancelar y resolver contestan en la zona del INSTITUTO", () => {
  // `toInvoiceRow` sin formateador cae a México: en Tijuana, una factura de
  // las 23:30 cambiaba de día entre la lista y la respuesta.
  const src = FACT();
  assert.ok(
    !/return toInvoiceRow\(actualizada\);/.test(src),
    "ninguna respuesta se queda sin la zona del instituto",
  );
  for (const ruta of ["cancelar", "resolver"]) {
    const r = fuenteDe("src", "app", "api", "instituto", "facturacion", "[id]", ruta, "route.ts");
    assert.match(r, /timeZone: g\.ctx\.institution\.timezone/, ruta);
  }
});

test("H-77 · el buscador de pacientes pide LO MÍNIMO", () => {
  // Un desplegable no necesita el domicilio ni los antecedentes de nadie
  // (la lección P1-4): el endpoint tiene `opciones=1` justo para esto.
  assert.match(
    fuenteDe("src", "components", "edu", "facturacion", "facturacion-screen.tsx"),
    /\/api\/instituto\/pacientes\?opciones=1&q=/,
  );
});

test("H-10 · la lista solo se fija cuando la cotización LLEGÓ", () => {
  // Fijarla antes del `await` dejaba, si el GET fallaba, los precios de la
  // lista anterior en pantalla y el id de la nueva en el cuerpo del cobro.
  const src = CAJA_UI();
  const cuerpo = src.slice(src.indexOf("async function cambiarLista"));
  const fin = cuerpo.indexOf("\n  }");
  const bloque = cuerpo.slice(0, fin === -1 ? undefined : fin);
  assert.ok(
    bloque.indexOf("await eduRequest") < bloque.indexOf("setListaElegida(lista)"),
    "setListaElegida va DESPUÉS de que la tarifa llegue",
  );
});

test("H-82 · el POST de timbrado tiene su maxDuration", () => {
  const ruta = fuenteDe("src", "app", "api", "instituto", "facturacion", "route.ts");
  assert.match(ruta, /export const maxDuration = 60/);
});

// ═════════════════════════════════════════════════════════════════════
// H-65 / H-73 / H-75 · TARIFARIOS Y CATÁLOGO
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-65 · una lista INACTIVA no puede quedar como predeterminada", () => {
  const cuerpo = cuerpoDe(TARIFAS(), "updateEduFeeSchedule");
  assert.match(cuerpo, /seraDefaultFinal && !seraActivaFinal/);
  // El guardia ya NO vive dentro del `if (input.isActive !== undefined)`:
  // ése era el agujero — un PATCH con solo {isDefault:true} no lo tocaba.
  assert.ok(
    !/if \(input\.isActive !== undefined\) \{\s*const activa/.test(cuerpo),
    "el guardia salió del if que lo dejaba pasar",
  );
});

test("🔴 H-73 · «con precio» solo cuenta las listas ACTIVAS", () => {
  const src = TARIFAS();
  const veces = src.split(
    'feeItems: { where: { feeSchedule: { isActive: true } } }',
  ).length - 1;
  assert.equal(veces, 2, "el catálogo y la tabla comparativa cuentan igual");
});

test("🔴 H-75 · dar de baja un procedimiento dice a quién deja colgando", () => {
  const cuerpo = cuerpoDe(TARIFAS(), "updateEduProcedure");
  assert.match(cuerpo, /data\.isActive === false/);
  assert.match(cuerpo, /eduCase\.count/);
  assert.match(cuerpo, /eduRequirement\.count/);
  assert.match(cuerpo, /eduRubric\.count/);
  const ruta = fuenteDe("src", "app", "api", "instituto", "procedimientos", "[id]", "route.ts");
  assert.match(ruta, /aviso:\s*updated\.aviso/, "el aviso llega a la pantalla");
});

// ═════════════════════════════════════════════════════════════════════
// H-46 / H-49 / H-52 / H-54 / H-57 / H-58 / H-59 / H-61 · LA PANTALLA
// ═════════════════════════════════════════════════════════════════════

const CAJA_UI = () => fuenteDe("src", "components", "edu", "dinero", "caja-screen.tsx");

test("🔴 H-46 · la clave de idempotencia se RENUEVA al cambiar de paciente", () => {
  const src = CAJA_UI();
  assert.match(src, /setIdemKey\(eduNuevaClaveIdem\(\)\)/);
  // Y la bandera `duplicado` se LEE: antes el servidor la mandaba y la
  // pantalla anunciaba "Cobro C-0041 emitido" igual.
  assert.match(src, /res\.duplicado === true/);
  assert.match(src, /yaEstaba/);
});

test("🔴 H-49 · el KPI del turno sale de los PAGOS del turno", () => {
  assert.match(CAJA(), /async function sumaNetaDelTurno/);
  assert.match(cuerpoDe(CAJA(), "listEduCharges"), /turnoNetCents/);
  assert.match(CAJA_UI(), /page\.turnoNetCents !== null/);
});

test("🔴 H-49 · y se recorta por SEDE, como las filas de esa misma pantalla", () => {
  // `EduPayment` no guarda sede y `eduPaymentScopeWhere` no la sabe
  // aplicar: sin esto, la cajera de Norte veía una tabla de Norte con un
  // "Entró en el turno" que incluía el dinero de Sur.
  assert.match(
    CAJA(),
    /Array\.isArray\(ctx\.campusIds\) \? \{ charge: \{ campusId: \{ in: ctx\.campusIds \} \} \}/,
  );
});

test("H-52 / H-61 · el recibo se imprime y dice cuándo fue", () => {
  const src = CAJA_UI();
  assert.match(src, /window\.print\(\)/, "H-52: se puede entregar el recibo");
  assert.match(src, /charge\.chargedAtLabel/, "H-61: el recibo tiene fecha y hora");
  assert.match(src, /charge\.notes/, "H-61: la nota del cobro deja de ser de solo escritura");
});

test("H-54 · las notas del turno se pueden volver a leer", () => {
  const src = fuenteDe("src", "components", "edu", "dinero", "corte-screen.tsx");
  assert.match(src, /s\.notes &&/, "la nota del turno cerrado se pinta");
  assert.match(src, /session\.notes \?/, "y la de la apertura, mientras vive");
});

test("H-57 · el aviso de truncado va PEGADO a las cifras", () => {
  const src = CAJA_UI();
  assert.match(src, /truncated &&[\s\S]{0,200}edu-kpi__note/);
});

test("H-58 · la sede del cobro llega a la tabla", () => {
  assert.match(CAJA(), /campusLabel:\s*c\.campus \? eduCampusLabel\(c\.campus\) : null/);
  assert.match(CAJA_UI(), /c\.campusLabel/);
});

test("H-59 · el modal de cobro avisa de la sede ANTES de armar el ticket", () => {
  assert.match(CAJA_UI(), /sedeAviso/);
  const pagina = fuenteDe("src", "app", "instituto", "(panel)", "caja", "page.tsx");
  assert.match(pagina, /eduCampusForCharge\(sede\)\.reason/);
});

test("H-64 · si el tarifario cambió en medio, el error lo DICE", () => {
  const cuerpo = cuerpoDe(CAJA(), "createEduCharge");
  assert.match(cuerpo, /soloElTope && descartados > 0 && err instanceof EduPadronError/);
  assert.match(cuerpo, /el total es ahora/);
});

test("🔴 H-64 · y NO reescribe los errores que no son del tope", () => {
  // Un cheque sin referencia, un "Otro" sin motivo o el 403 de caja.refund
  // se contestaban como "el precio cambió": un mensaje que ayuda cambiado
  // por uno que miente.
  const cuerpo = cuerpoDe(CAJA(), "createEduCharge");
  assert.match(cuerpo, /const conTopeAmplio = parseEduPagosDivididos\(/);
  assert.match(cuerpo, /conTopeAmplio\.sumaCents > totals\.totalCents/);
});

test("H-72 / H-77 / H-81 · la factura dice lo que se puede hacer con ella", () => {
  const src = fuenteDe("src", "components", "edu", "facturacion", "facturacion-screen.tsx");
  assert.match(src, /factura\.status === "VALID" && factura\.hasDocument/, "H-72");
  assert.match(src, /DatosFiscalesPaciente/, "H-77");
  assert.match(src, /eduDescribeRegimen\(factura\.receptorTaxRegime\)/, "H-81");
  assert.match(src, /factura\.issuedAtLabel/, "H-81");
});
