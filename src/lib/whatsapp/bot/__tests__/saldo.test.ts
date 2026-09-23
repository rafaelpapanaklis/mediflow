/**
 * «¿CUÁNTO DEBO?» POR WHATSAPP — ws1-t3, rehecho en ws1-t5.
 *
 * Run: npm run test:bot-saldo
 *
 * Desde el 23-sep-2026 (decisión de producto de Rafael, explicada en la
 * cabecera de `saldo-core.ts`) la fecha de nacimiento ya no es un control para
 * todos: solo desambigua un número con varios pacientes. Lo que esto prueba:
 *
 *   · con el interruptor de la clínica apagado, el bot no dice nada de dinero;
 *   · un número con UN paciente: pregunta y respuesta en un mensaje;
 *   · un número con DOS o más no se adivina: se pide la fecha para saber de
 *     cuál, y si no cuadra se deriva a una persona; nunca se enseña la deuda
 *     del otro, tampoco la de la mamá al hijo dado de baja;
 *   · no se reintenta en bucle: dos fallos al día y se deriva;
 *   · cada consulta deja rastro de quién preguntó y qué se contestó;
 *   · se contesta lo mínimo.
 *
 * El núcleo es puro y recibe sus dependencias, así que aquí no hay base de
 * datos ni red: los dobles son objetos planos. ⛔ No sale ni un WhatsApp.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FALLOS,
  RESULTADOS_FALLIDOS,
  TEXTOS,
  detectaIntencionDeSaldo,
  elegirPorFecha,
  parseFechaNacimiento,
  runSaldoTurn,
  sufijoDelRastro,
  textoDelSaldo,
  type PacienteSaldo,
  type RastroConsulta,
  type ResumenSaldo,
  type SaldoDeps,
} from "../saldo-core";
import { BotIntent } from "../types";
import type { BotConfigDTO, BotJson, BotTurnInput } from "../types";

const ANA: PacienteSaldo = { id: "p1", activo: true, dob: "1990-03-15" };
const LUIS: PacienteSaldo = { id: "p2", activo: true, dob: "2015-06-01" };
const SOFIA: PacienteSaldo = { id: "p3", activo: true, dob: "2018-11-20" };

/* ── Dobles ────────────────────────────────────────────────────────────── */
let pacientes: PacienteSaldo[];
/** El saldo de cada paciente: así se ve DE QUIÉN es el que se contestó. */
let saldos: Record<string, ResumenSaldo | null>;
/** Todo lo que se registró. ESTE es el rastro. */
let rastro: RastroConsulta[];
/** De quién se leyó el dinero, en orden. */
let lecturas: string[];
/** Los fallos que «ya había» registrados en el hilo (sobreviven al TTL). */
let fallosPrevios: number;

function resumenCon(importeCuota: number, pendiente: number): ResumenSaldo {
  return {
    vencimiento: "2026-03-03",
    importeCuota,
    numeroCuota: 7,
    esEnganche: false,
    totalCuotas: 24,
    pendiente,
    tieneVencidas: false,
  };
}

beforeEach(() => {
  pacientes = [ANA];
  saldos = { p1: resumenCon(2000, 18000), p2: resumenCon(750, 4500), p3: resumenCon(990, 8910) };
  rastro = [];
  lecturas = [];
  fallosPrevios = 0;
});

const deps = (): SaldoDeps => ({
  async buscarPacientesPorTelefono(clinicId, phone) {
    assert.equal(clinicId, "c1", "siempre se busca dentro de la clínica");
    assert.ok(phone, "y con un teléfono");
    return pacientes;
  },
  async resumenDeSaldo(clinicId, patientId) {
    assert.equal(clinicId, "c1", "el saldo también se lee dentro de la clínica");
    lecturas.push(patientId);
    return saldos[patientId] ?? null;
  },
  async registrarConsulta(datos) {
    rastro.push(datos);
  },
  async fallosRecientes() {
    // Como la base: lo ya registrado de antes más lo de esta tanda, contado
    // con la MISMA lista que usa el shell.
    return fallosPrevios + rastro.filter((r) => RESULTADOS_FALLIDOS.includes(r.resultado)).length;
  },
  formatearImporte: (n) => `$${n.toLocaleString("en-US")}.00`,
  formatearFecha: (iso) => iso,
});

function config(over: Partial<BotConfigDTO> = {}): BotConfigDTO {
  return {
    id: "b1",
    clinicId: "c1",
    enabled: true,
    botName: "Asistente",
    persona: null,
    greeting: null,
    businessHours: null,
    afterHoursMsg: null,
    canAnswerFaq: true,
    canBookAppointments: false,
    canAnswerBalance: true,
    fallbackToHuman: true,
    timezone: "America/Mexico_City",
    ...over,
  };
}

function turno(texto: string, botState: BotJson | null = null): BotTurnInput {
  return {
    clinicId: "c1",
    threadId: "t1",
    patient: { id: "p1", phone: "+52 999 260 2093" },
    incomingText: texto,
    history: [],
    botState,
  };
}

const correr = (texto: string, estado: BotJson | null = null, cfg = config()) =>
  runSaldoTurn(turno(texto, estado), cfg, deps());

/** Pregunta y contesta: el segundo turno recibe el estado del primero. */
async function preguntaYFecha(fecha: string) {
  const primero = await correr("¿cuánto debo?");
  const segundo = await correr(fecha, primero!.newBotState ?? null);
  return { primero: primero!, segundo: segundo! };
}

/** Ninguna de estas respuestas puede llevar un importe. */
function sinDinero(texto: string | undefined, mensaje: string) {
  assert.ok(texto, "el bot contestó algo");
  assert.doesNotMatch(texto!, /\$|\bpesos\b|pendiente/i, mensaje);
}

/* ═══ 1. EL INTERRUPTOR DE LA CLÍNICA ══════════════════════════════════ */

test("con el interruptor apagado, el bot no dice nada de dinero", async () => {
  for (const frase of ["¿cuánto debo?", "mi saldo", "¿cuándo vence mi mensualidad?"]) {
    const r = await correr(frase, null, config({ canAnswerBalance: false }));
    assert.equal(r, null, `${frase}: devuelve null y el motor sigue con FAQ/agenda/IA como hoy`);
  }
  assert.equal(rastro.length, 0, "no se consulta ni se registra nada: no ha pasado nada");
  assert.deepEqual(lecturas, [], "ni se lee el saldo");
});

test("apagado, ni siquiera con una pregunta de desambiguación a medias", async () => {
  pacientes = [ANA, LUIS];
  const estado = { flow: "saldo", updatedAt: Date.now() } as unknown as BotJson;
  const r = await correr("15/03/1990", estado, config({ canAnswerBalance: false }));
  assert.equal(r, null);
  assert.deepEqual(lecturas, []);
});

test("un DTO sin el campo cuenta como apagado", async () => {
  const { canAnswerBalance: _fuera, ...sinCampo } = config();
  const r = await runSaldoTurn(turno("¿cuánto debo?"), sinCampo as BotConfigDTO, deps());
  assert.equal(r, null);
  assert.deepEqual(lecturas, []);
});

/* ═══ 2. UN PACIENTE: PREGUNTA Y RESPUESTA EN UN MENSAJE ═══════════════ */

test("contesta la próxima mensualidad al primer mensaje, sin pedir nada", async () => {
  const r = await correr("¿cuánto debo?");
  assert.ok(r!.reply!.includes("$2,000.00"), "la cuota");
  assert.ok(r!.reply!.includes("$18,000.00"), "y lo pendiente");
  assert.ok(r!.reply!.includes("7 de 24"), "por qué cuota va");
  assert.doesNotMatch(r!.reply!, /nacimiento/i, "no se pide ningún dato");
  assert.deepEqual(lecturas, ["p1"]);
  assert.equal(r!.newBotState, null, "no queda nada esperando un segundo mensaje");
  assert.equal(r!.handoff, undefined, "y el bot sigue activo en el hilo");
});

test("sin fecha de nacimiento en el expediente, igual: no se le pide nada", async () => {
  pacientes = [{ ...ANA, dob: null }];
  const r = await correr("¿cuánto debo?");
  assert.ok(r!.reply!.includes("$2,000.00"));
});

test("sin plan a plazos también contesta a la primera", async () => {
  saldos.p1 = null;
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.reply, TEXTOS.sinPlan);
  assert.equal(r!.newBotState, null);
});

test("un hilo que se quedó esperando la fecha con las reglas viejas se contesta ya", async () => {
  // Estado de antes del 23-sep-2026, a media verificación, en un número de
  // UN paciente: lo que escriba se contesta, porque ya no hay nada que pedir.
  const viejo = { flow: "saldo", patientId: "p1", intentos: 1, updatedAt: Date.now() } as unknown as BotJson;
  const r = await correr("15/03/1990", viejo);
  assert.ok(r!.reply!.includes("$2,000.00"));
  assert.equal(r!.newBotState, null, "y el estado viejo se barre");

  // Y si lo que escribe no es ni fecha ni dinero, no se le contesta el saldo.
  assert.equal(await correr("quiero agendar una limpieza", viejo), null);
});

test("un número sin paciente se deriva sin decir nada, y sin callar al bot", async () => {
  pacientes = [];
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.reply, TEXTOS.derivar);
  assert.equal(r!.handoff, undefined, "no ha hecho nada que una persona tenga que mirar");
  assert.deepEqual(lecturas, []);
  assert.deepEqual(rastro.map((x) => [x.resultado, x.patientId]), [["pacienteNoEncontrado", null]]);
});

test("a un paciente dado de baja no se le habla de dinero", async () => {
  pacientes = [{ ...ANA, activo: false }];
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.reply, TEXTOS.derivar);
  assert.deepEqual(lecturas, [], "ni se lee su saldo");
  assert.deepEqual(rastro.map((x) => [x.resultado, x.patientId]), [["pacienteDeBaja", "p1"]]);
});

/* ═══ 3. NÚMERO COMPARTIDO: SE DESAMBIGUA, NO SE ADIVINA ═══════════════ */

test("con DOS pacientes, se pide la fecha y no se dice un peso", async () => {
  // Una mamá con dos hijos en la misma clínica es el caso NORMAL.
  pacientes = [ANA, LUIS];
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.reply, TEXTOS.pideFecha);
  sinDinero(r!.reply, "antes de saber de quién, ni un importe");
  assert.deepEqual(lecturas, [], "ni se consulta: elegir a uno sería enseñarle la deuda del otro");
  assert.deepEqual(rastro.map((x) => [x.resultado, x.patientId]), [["fechaPedida", null]]);
  assert.ok(r!.newBotState, "queda esperando la fecha");
});

test("con la fecha, identifica a cuál y le contesta a ESE, no al otro", async () => {
  pacientes = [ANA, LUIS];
  const { segundo } = await preguntaYFecha("01/06/2015"); // la de Luis
  assert.ok(segundo.reply!.includes("$750.00"), "la cuota de Luis");
  assert.ok(segundo.reply!.includes("$4,500.00"), "y lo pendiente de Luis");
  assert.doesNotMatch(segundo.reply!, /2,000|18,000/, "nada de lo de Ana");
  assert.deepEqual(lecturas, ["p2"], "solo se leyó el dinero de Luis");
  assert.equal(segundo.newBotState, null);
  assert.deepEqual(rastro.at(-1), {
    clinicId: "c1", threadId: "t1", patientId: "p2", telefono: "+52 999 260 2093",
    resultado: "saldoEntregado",
  });
});

test("con tres, igual: la fecha elige a uno", async () => {
  pacientes = [ANA, LUIS, SOFIA];
  const { segundo } = await preguntaYFecha("20 de noviembre de 2018");
  assert.ok(segundo.reply!.includes("$990.00"));
  assert.deepEqual(lecturas, ["p3"]);
});

test("si la fecha no cuadra con ninguno, deriva a una persona", async () => {
  pacientes = [ANA, LUIS];
  const { segundo } = await preguntaYFecha("01/01/1980");
  assert.equal(segundo.reply, TEXTOS.derivar);
  assert.equal(segundo.handoff, true, "el bot se calla en el hilo: lo que siga lo lee una persona");
  assert.equal(segundo.intent, BotIntent.HANDOFF);
  assert.deepEqual(lecturas, []);
  assert.equal(rastro.at(-1)!.resultado, "fechaSinCoincidencia");
  assert.equal(segundo.newBotState, null, "no se deja seguir probando fechas en el acto");
});

test("si la fecha es de dos (gemelos), no elige a ninguno: deriva", async () => {
  pacientes = [ANA, { ...LUIS, dob: ANA.dob }];
  const { segundo } = await preguntaYFecha("15/03/1990");
  assert.equal(segundo.reply, TEXTOS.derivar);
  assert.equal(segundo.handoff, true);
  assert.deepEqual(lecturas, []);
  assert.equal(rastro.at(-1)!.resultado, "fechaAmbigua");
});

test("un paciente sin fecha en el expediente no se elige nunca por fecha", async () => {
  pacientes = [{ ...ANA, dob: null }, LUIS];
  const { segundo } = await preguntaYFecha("15/03/1990");
  assert.equal(segundo.reply, TEXTOS.derivar);
  assert.deepEqual(lecturas, []);
});

test("algo que no es una fecha: se vuelve a pedir una vez, y a la segunda deriva", async () => {
  pacientes = [ANA, LUIS];
  const { segundo } = await preguntaYFecha("no me acuerdo");
  assert.equal(segundo.reply, TEXTOS.fechaIlegible);
  assert.ok(segundo.newBotState, "sigue esperando la fecha");
  const tercero = await correr("la de mi hijo", segundo.newBotState ?? null);
  assert.equal(tercero!.reply, TEXTOS.derivar, "falló dos veces: se acabó");
  assert.equal(tercero!.handoff, true);
  assert.equal(tercero!.newBotState, null);
  assert.deepEqual(lecturas, []);
  assert.deepEqual(
    rastro.map((x) => x.resultado),
    ["fechaPedida", "fechaIlegible", "intentosAgotados"],
    "y la nota dice que se derivó, no solo que no era una fecha",
  );
});

test("tras el reintento, una fecha buena sí contesta", async () => {
  pacientes = [ANA, LUIS];
  const { segundo } = await preguntaYFecha("no sé");
  const tercero = await correr("15/03/1990", segundo.newBotState ?? null);
  assert.ok(tercero!.reply!.includes("$2,000.00"));
  assert.deepEqual(lecturas, ["p1"]);
});

test("pedir la fecha no calla al bot: es una pregunta, no una derivación", async () => {
  pacientes = [ANA, LUIS];
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.handoff, undefined);
  assert.notEqual(r!.intent, BotIntent.HANDOFF);
});

test("si a media pregunta el número se queda con UN paciente, la fecha de otro NO saca su deuda", async () => {
  // Ana responde con SU fecha, pero entretanto su teléfono cambió en la ficha
  // y en el número solo queda Luis.
  pacientes = [ANA, LUIS];
  const primero = await correr("¿cuánto debo?");
  pacientes = [LUIS];
  const r = await correr("15/03/1990", primero!.newBotState ?? null);
  assert.equal(r!.reply, TEXTOS.derivar, "Ana no puede recibir lo de Luis");
  assert.deepEqual(lecturas, []);
});

test("…y la fecha del que queda, sí", async () => {
  pacientes = [ANA, LUIS];
  const primero = await correr("¿cuánto debo?");
  pacientes = [LUIS];
  const r = await correr("01/06/2015", primero!.newBotState ?? null);
  assert.ok(r!.reply!.includes("$750.00"));
  assert.deepEqual(lecturas, ["p2"]);
});

/* ═══ 3a. LOS DADOS DE BAJA CUENTAN PARA DESAMBIGUAR ═══════════════════ */

test("mamá activa + hijo dado de baja en el mismo número: NO es un número de un paciente", async () => {
  // Si solo contaran los activos, el hijo que escribe «¿cuánto debo?» desde
  // el teléfono de su mamá recibiría la deuda de ella como si fuera suya.
  pacientes = [ANA, { ...LUIS, activo: false }];
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.reply, TEXTOS.pideFecha, "se pregunta de quién se trata");
  assert.deepEqual(lecturas, []);
});

test("con la fecha del hijo dado de baja, no se dice nada de nadie", async () => {
  pacientes = [ANA, { ...LUIS, activo: false }];
  const { segundo } = await preguntaYFecha("01/06/2015");
  assert.equal(segundo.reply, TEXTOS.derivar);
  assert.deepEqual(lecturas, []);
  assert.equal(rastro.at(-1)!.resultado, "pacienteDeBaja");
});

test("con la fecha de la mamá, se le contesta a ella", async () => {
  pacientes = [ANA, { ...LUIS, activo: false }];
  const { segundo } = await preguntaYFecha("15/03/1990");
  assert.ok(segundo.reply!.includes("$2,000.00"));
  assert.deepEqual(lecturas, ["p1"]);
});

/* ═══ 3b. NO SE REINTENTA EN BUCLE ═════════════════════════════════════ */

test("preguntar otra vez NO regala intentos nuevos: el tope es por día", async () => {
  // Si el contador viviera solo en la sesión, cada «¿cuánto debo?» nuevo
  // daría otros dos intentos y se podrían probar fechas sin fin.
  pacientes = [ANA, LUIS];
  await preguntaYFecha("01/01/1980"); // fallo 1 (deriva)
  const otra = await preguntaYFecha("02/02/1970"); // fallo 2 (deriva)
  assert.equal(otra.segundo.reply, TEXTOS.derivar);
  const tercera = await correr("¿cuánto debo?");
  assert.equal(tercera!.reply, TEXTOS.derivar, "ya ni se le pregunta la fecha");
  assert.equal(tercera!.handoff, true);
  assert.equal(rastro.at(-1)!.resultado, "intentosAgotados");
  assert.deepEqual(lecturas, []);
});

test("con los fallos del día agotados, ni la fecha buena sirve", async () => {
  pacientes = [ANA, LUIS];
  fallosPrevios = MAX_FALLOS;
  const r = await correr("15/03/1990", { flow: "saldo", updatedAt: Date.now() } as unknown as BotJson);
  assert.equal(r!.reply, TEXTOS.derivar);
  assert.deepEqual(lecturas, []);
});

test("pero un paciente que acierta a la primera no paga por un fallo ajeno", async () => {
  pacientes = [ANA, LUIS];
  fallosPrevios = MAX_FALLOS - 1;
  const { segundo } = await preguntaYFecha("15/03/1990");
  assert.ok(segundo.reply!.includes("$2,000.00"));
});

test("el tope no toca al número de un solo paciente: ahí no hay nada que adivinar", async () => {
  fallosPrevios = MAX_FALLOS;
  const r = await correr("¿cuánto debo?");
  assert.ok(r!.reply!.includes("$2,000.00"));
});

test("las respuestas que no contestan no delatan por qué", async () => {
  // Sin paciente, fecha de nadie, gemelos, intentos agotados: el mismo texto.
  const respuestas = new Set<string>();
  pacientes = [];
  respuestas.add((await correr("¿cuánto debo?"))!.reply!);
  pacientes = [ANA, LUIS];
  respuestas.add((await preguntaYFecha("01/01/1980")).segundo.reply!);
  pacientes = [ANA, { ...LUIS, dob: ANA.dob }];
  respuestas.add((await preguntaYFecha("15/03/1990")).segundo.reply!);
  pacientes = [ANA, LUIS];
  fallosPrevios = MAX_FALLOS;
  respuestas.add((await correr("¿cuánto debo?"))!.reply!);
  assert.deepEqual([...respuestas], [TEXTOS.derivar]);
});

/* ═══ 3c. EL RASTRO ════════════════════════════════════════════════════ */

test("contestar el saldo deja rastro de quién preguntó y qué se contestó", async () => {
  await correr("¿cuánto debo?");
  assert.equal(rastro.length, 1, "un acceso, una nota");
  assert.deepEqual(rastro[0], {
    clinicId: "c1", threadId: "t1", patientId: "p1", telefono: "+52 999 260 2093",
    resultado: "saldoEntregado",
  });
});

test("el rastro se escribe ANTES de soltar el dato, no después", async () => {
  const orden: string[] = [];
  const d = deps();
  const espia: SaldoDeps = {
    ...d,
    async resumenDeSaldo(...args) {
      orden.push("lee");
      return d.resumenDeSaldo(...args);
    },
    async registrarConsulta(datos) {
      orden.push(`registra:${datos.resultado}`);
      return d.registrarConsulta(datos);
    },
  };
  pacientes = [ANA, LUIS];
  const primero = await runSaldoTurn(turno("¿cuánto debo?"), config(), espia);
  await runSaldoTurn(turno("15/03/1990", primero!.newBotState ?? null), config(), espia);
  assert.deepEqual(orden, ["registra:fechaPedida", "lee", "registra:saldoEntregado"]);
});

test("también queda rastro cuando NO hay nada que cobrar", async () => {
  saldos.p1 = null;
  await correr("¿cuánto debo?");
  assert.deepEqual(rastro.map((x) => [x.resultado, x.patientId]), [["sinPlan", "p1"]]);
});

test("los sufijos del rastro que cuentan como fallo no se confunden con otros", () => {
  // El shell cuenta con `endsWith(sufijoDelRastro(r))`: si el sufijo de un
  // resultado cualquiera terminara igual que el de un fallo, contaría de más
  // (o, al revés, un fallo no contaría).
  const todos = [
    "saldoEntregado", "sinPlan", "pacienteNoEncontrado", "pacienteDeBaja", "fechaPedida",
    "fechaIlegible", "fechaSinCoincidencia", "fechaAmbigua", "intentosAgotados",
  ] as const;
  for (const fallo of RESULTADOS_FALLIDOS) {
    const cuentan = todos.filter((r) => `sys:system:x${sufijoDelRastro(r)}`.endsWith(sufijoDelRastro(fallo)));
    assert.deepEqual(cuentan, [fallo]);
  }
});

test("elegirPorFecha: los cuatro desenlaces", () => {
  assert.deepEqual(elegirPorFecha([ANA, LUIS], "15/03/1990"), { tipo: "uno", paciente: ANA });
  assert.deepEqual(elegirPorFecha([ANA, LUIS], "01/01/1980"), { tipo: "ninguno" });
  assert.deepEqual(elegirPorFecha([ANA, { ...LUIS, dob: ANA.dob }], "15/03/1990"), { tipo: "varios" });
  assert.deepEqual(elegirPorFecha([ANA, LUIS], "no sé"), { tipo: "ilegible" });
});

/* ═══ 4. SE CONTESTA LO MÍNIMO ═════════════════════════════════════════ */

test("la respuesta lleva la cuota y lo pendiente, y nada más", async () => {
  const texto = textoDelSaldo(saldos.p1!, { importe: (n) => `$${n}`, fecha: (f) => f });
  assert.ok(texto.includes("$2000"), "la cuota");
  assert.ok(texto.includes("$18000"), "lo pendiente");
  // Ni historial, ni tratamientos, ni procedimientos.
  assert.doesNotMatch(texto, /tratamiento|procedimiento|diagn|factura|expediente/i);
});

test("si va atrasado se le dice, sin regañarlo", async () => {
  const texto = textoDelSaldo(
    { ...saldos.p1!, tieneVencidas: true },
    { importe: (n) => `$${n}`, fecha: (f) => f },
  );
  assert.match(texto, /atrasado/);
});

test("el enganche se llama enganche, no «mensualidad 0»", async () => {
  const texto = textoDelSaldo(
    { ...saldos.p1!, esEnganche: true, numeroCuota: 0 },
    { importe: (n) => `$${n}`, fecha: (f) => f },
  );
  assert.match(texto, /enganche/);
  assert.doesNotMatch(texto, /mensualidad 0/);
});

/* ═══ 5. CUÁNDO SE DA POR ALUDIDO ══════════════════════════════════════ */

test("reconoce las formas normales de preguntar por dinero", async () => {
  for (const frase of [
    "¿cuánto debo?",
    "cuanto debo",
    "¿cuánto me falta?",
    "mi saldo",
    "cual es mi adeudo",
    "¿cuándo vence mi mensualidad?",
    "quiero saber mi próxima mensualidad",
    "mándame mi estado de cuenta",
  ]) {
    assert.equal(detectaIntencionDeSaldo(frase), true, frase);
  }
});

test("NO secuestra una conversación normal", async () => {
  // Un falso positivo aquí le suelta a un paciente su deuda sin que la haya
  // pedido, en mitad de otra cosa.
  for (const frase of [
    "hola",
    "quiero una cita para el lunes",
    "¿cuánto cuesta una limpieza?",
    "gracias, muy amable",
    "¿a qué hora abren?",
    "me duele una muela",
  ]) {
    assert.equal(detectaIntencionDeSaldo(frase), false, frase);
  }
});

test("una pregunta que no es de saldo devuelve null y el motor sigue", async () => {
  const r = await correr("¿a qué hora abren?");
  assert.equal(r, null);
  assert.equal(rastro.length, 0);
});

/* ═══ 6. LA FECHA DE NACIMIENTO, ESTRICTA ══════════════════════════════ */

test("acepta las formas en que la gente escribe una fecha", async () => {
  assert.equal(parseFechaNacimiento("15/03/1990"), "1990-03-15");
  assert.equal(parseFechaNacimiento("15-3-1990"), "1990-03-15");
  assert.equal(parseFechaNacimiento("1990-03-15"), "1990-03-15");
  assert.equal(parseFechaNacimiento("15 de marzo de 1990"), "1990-03-15");
  assert.equal(parseFechaNacimiento("nací el 15 de Marzo de 1990"), "1990-03-15");
});

test("exige el año completo: sin él no hay fecha que elija a nadie", async () => {
  // `parseDateInput` (el de agendar) rellenaría el año actual y daría por buena
  // una fecha que el paciente nunca quiso decir.
  assert.equal(parseFechaNacimiento("15/03"), null);
  assert.equal(parseFechaNacimiento("15 de marzo"), null);
  assert.equal(parseFechaNacimiento("mañana"), null);
  assert.equal(parseFechaNacimiento("lunes"), null);
  assert.equal(parseFechaNacimiento(""), null);
});

test("una fecha que no existe en el calendario no cuadra con nada", async () => {
  assert.equal(parseFechaNacimiento("31/02/1990"), null);
  assert.equal(parseFechaNacimiento("30/02/2000"), null);
  assert.equal(parseFechaNacimiento("00/01/1990"), null);
  assert.equal(parseFechaNacimiento("15/13/1990"), null);
});

test("el 29 de febrero de un año bisiesto sí existe", async () => {
  assert.equal(parseFechaNacimiento("29/02/2000"), "2000-02-29");
  assert.equal(parseFechaNacimiento("29/02/1999"), null);
});
