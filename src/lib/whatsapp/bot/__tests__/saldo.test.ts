/**
 * EL BOT NO DICE UN PESO SIN SABER CON QUIÉN HABLA — ws1-t3.
 *
 * Run: npm run test:bot-saldo
 *
 * El cliente lo pidió con estas palabras: «consultar de forma segura la próxima
 * mensualidad del paciente». El «de forma segura» es suyo y es la mitad del
 * encargo, así que esto prueba, sobre todo, lo que el bot se NIEGA a contestar:
 *
 *   · con el interruptor de la clínica apagado, ni se entera de la pregunta;
 *   · no dice un peso hasta que la fecha de nacimiento cuadra;
 *   · no se reintenta en bucle: a los dos fallos, deriva;
 *   · un teléfono con DOS pacientes no se adivina: deriva;
 *   · cada consulta deja rastro de quién preguntó y qué se contestó.
 *
 * El núcleo es puro y recibe sus dependencias, así que aquí no hay base de
 * datos ni red: los dobles son objetos planos. ⛔ No sale ni un WhatsApp.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INTENTOS,
  TEXTOS,
  detectaIntencionDeSaldo,
  parseFechaNacimiento,
  runSaldoTurn,
  textoDelSaldo,
  type PacienteSaldo,
  type RastroConsulta,
  type ResumenSaldo,
  type SaldoDeps,
} from "../saldo-core";
import type { BotConfigDTO, BotJson, BotTurnInput } from "../types";

const DOB = "1990-03-15";

/* ── Dobles ────────────────────────────────────────────────────────────── */
let pacientes: PacienteSaldo[];
let resumen: ResumenSaldo | null;
/** Todo lo que se registró. ESTE es el rastro. */
let rastro: RastroConsulta[];
/** Cuántas veces se preguntó por el dinero del paciente. */
let lecturasDeSaldo: number;
/** Los fallos que «ya había» registrados en el hilo (sobreviven al TTL). */
let fallosPrevios: number;

beforeEach(() => {
  pacientes = [{ id: "p1", firstName: "Ana", dob: DOB }];
  resumen = {
    vencimiento: "2026-03-03",
    importeCuota: 2000,
    numeroCuota: 7,
    esEnganche: false,
    totalCuotas: 24,
    pendiente: 18000,
    tieneVencidas: false,
  };
  rastro = [];
  lecturasDeSaldo = 0;
  fallosPrevios = 0;
});

const deps = (): SaldoDeps => ({
  async buscarPacientesPorTelefono(clinicId, phone) {
    assert.equal(clinicId, "c1", "siempre se busca dentro de la clínica");
    assert.ok(phone, "y con un teléfono");
    return pacientes;
  },
  async resumenDeSaldo() {
    lecturasDeSaldo++;
    return resumen;
  },
  async registrarConsulta(datos) {
    rastro.push(datos);
  },
  async fallosRecientes() {
    // El contador REAL: lo ya registrado más lo que lleve esta tanda. Así el
    // doble se comporta como la base, donde las notas no caducan con la sesión.
    return (
      fallosPrevios +
      rastro.filter((r) =>
        ["verificacionFallida", "telefonoCompartido", "pacienteNoEncontrado", "sinFechaDeNacimiento"].includes(
          r.resultado,
        ),
      ).length
    );
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

/**
 * Ninguna respuesta del bot puede llevar un IMPORTE si no se verificó.
 *
 * Se busca dinero, no dígitos: el texto que pide la fecha de nacimiento lleva
 * un ejemplo («15/03/1990») y eso es justo lo que tiene que llevar.
 */
function sinCifras(texto: string | undefined, mensaje: string) {
  assert.ok(texto, "el bot contestó algo");
  assert.doesNotMatch(texto!, /\$|\bpesos\b|2[.,]?000|18[.,]?000/i, mensaje);
}

/* ═══ 1. EL INTERRUPTOR DE LA CLÍNICA ══════════════════════════════════ */

test("con el interruptor apagado, el bot ni se entera de la pregunta", async () => {
  const r = await correr("¿cuánto debo?", null, config({ canAnswerBalance: false }));
  assert.equal(r, null, "devuelve null y el motor sigue con FAQ/agenda/IA como hoy");
  assert.equal(rastro.length, 0, "no se consulta ni se registra nada: no ha pasado nada");
  assert.equal(lecturasDeSaldo, 0);
});

test("apagado, ni siquiera con una verificación a medias en el hilo", async () => {
  const estado = { flow: "saldo", patientId: "p1", intentos: 0, updatedAt: Date.now() };
  const r = await correr("15/03/1990", estado as unknown as BotJson, config({ canAnswerBalance: false }));
  assert.equal(r, null);
  assert.equal(lecturasDeSaldo, 0);
});

/* ═══ 2. NI UN PESO SIN VERIFICAR ══════════════════════════════════════ */

test("a la primera pregunta NO dice dinero: pide la fecha de nacimiento", async () => {
  const r = await correr("¿cuánto debo?");
  assert.ok(r, "el flujo sí toma la pregunta");
  assert.equal(r!.reply, TEXTOS.pideFecha);
  sinCifras(r!.reply, "no puede haberse escapado ni un importe");
  assert.equal(lecturasDeSaldo, 0, "ni siquiera se CONSULTA el saldo antes de verificar");
  assert.equal(rastro[0].resultado, "verificacionPedida");
});

test("con la fecha correcta, y solo entonces, dice la mensualidad", async () => {
  const primero = await correr("¿cuánto debo?");
  const r = await correr("15/03/1990", primero!.newBotState ?? null);
  assert.ok(r!.reply!.includes("$2,000.00"), "la cuota");
  assert.ok(r!.reply!.includes("$18,000.00"), "y lo pendiente");
  assert.ok(r!.reply!.includes("7 de 24"), "por qué cuota va");
  assert.equal(lecturasDeSaldo, 1);
  assert.equal(r!.newBotState, null, "la verificación no se queda guardada");
});

test("con la fecha EQUIVOCADA no dice nada de dinero", async () => {
  const primero = await correr("¿cuánto debo?");
  const r = await correr("01/01/1980", primero!.newBotState ?? null);
  sinCifras(r!.reply, "una fecha que no cuadra no puede sacar un importe");
  assert.equal(r!.reply, TEXTOS.noCuadra);
  assert.equal(lecturasDeSaldo, 0, "el saldo no se consulta siquiera");
  assert.equal(rastro[1].resultado, "verificacionFallida");
});

test("no se reintenta en bucle: a los dos fallos, se deriva a una persona", async () => {
  let estado: BotJson | null = (await correr("¿cuánto debo?"))!.newBotState ?? null;
  for (let i = 0; i < MAX_INTENTOS - 1; i++) {
    const r = await correr("01/01/1980", estado);
    estado = r!.newBotState ?? null;
  }
  const ultimo = await correr("02/02/1970", estado);
  assert.equal(ultimo!.reply, TEXTOS.derivar);
  assert.equal(ultimo!.handoff, true, "el hilo se pausa y lo toma el equipo");
  assert.equal(ultimo!.newBotState, null, "y el intento se cierra: no se sigue probando");
  assert.equal(lecturasDeSaldo, 0);
  assert.equal(rastro.at(-1)!.resultado, "verificacionAgotada");
});

test("un texto que no es una fecha cuenta como intento fallido, no como pregunta nueva", async () => {
  const primero = await correr("¿cuánto debo?");
  const r = await correr("no me acuerdo", primero!.newBotState ?? null);
  sinCifras(r!.reply, "no hay atajo por no contestar");
  assert.equal(r!.reply, TEXTOS.noCuadra);
});

test("la verificación NO se hereda: la siguiente pregunta vuelve a pedir la fecha", async () => {
  const primero = await correr("¿cuánto debo?");
  const ok = await correr("15/03/1990", primero!.newBotState ?? null);
  assert.ok(ok!.reply!.includes("$2,000.00"));
  // El teléfono puede cambiar de manos entre una pregunta y la siguiente.
  const otraVez = await correr("¿y mi saldo?", ok!.newBotState ?? null);
  assert.equal(otraVez!.reply, TEXTOS.pideFecha, "se verifica otra vez, desde cero");
});

test("una verificación caducada no sirve para saltarse el paso", async () => {
  const viejo = {
    flow: "saldo",
    patientId: "p1",
    intentos: 0,
    updatedAt: Date.now() - 60 * 60 * 1000, // una hora
  };
  const r = await correr("15/03/1990", viejo as unknown as BotJson);
  // Caducado, deja de ser «estoy esperando una fecha»: «15/03/1990» ya no es
  // una pregunta de saldo, así que el flujo devuelve null y sigue el motor.
  assert.equal(r, null);
  assert.equal(lecturasDeSaldo, 0);
});

/* ═══ 3. EL TELÉFONO NO ES LA IDENTIDAD ════════════════════════════════ */

const DOS_PACIENTES: PacienteSaldo[] = [
  { id: "p1", firstName: "Ana", dob: DOB },
  { id: "p2", firstName: "Luis", dob: "2015-06-01" },
];

test("un teléfono con DOS pacientes no se adivina: nunca se dice un saldo", async () => {
  // Una mamá con dos hijos en la misma clínica es el caso NORMAL.
  pacientes = DOS_PACIENTES;
  const primero = await correr("¿cuánto debo?");
  sinCifras(primero!.reply, "el primer turno no puede soltar un importe");

  // Ni acertando la fecha de uno de los dos se contesta.
  const segundo = await correr("15/03/1990", primero!.newBotState ?? null);
  sinCifras(segundo!.reply, "no se dice el saldo de ninguno de los dos");
  assert.equal(lecturasDeSaldo, 0, "ni se consulta: elegir a uno sería enseñarle la deuda del otro");
  assert.ok(
    rastro.some((r) => r.resultado === "telefonoCompartido"),
    "y en el rastro consta POR QUÉ, aunque el paciente no lo vea",
  );
});

test("con dos pacientes se agotan los intentos y ahí sí lo ve una persona", async () => {
  pacientes = DOS_PACIENTES;
  // Insistir no sirve de nada: cada respuesta cuenta como intento gastado y al
  // segundo se acaba, igual que para cualquier otro que no acierte.
  const t1 = await correr("¿cuánto debo?");
  const t2 = await correr("15/03/1990", t1!.newBotState ?? null);
  assert.equal(t2!.reply, TEXTOS.noCuadra, "primer intento gastado");
  const t3 = await correr("15/03/1990", t2!.newBotState ?? null);
  assert.equal(t3!.reply, TEXTOS.derivar, "segundo: se acabó");
  assert.equal(t3!.handoff, true, "el hilo pasa al equipo");
  assert.equal(lecturasDeSaldo, 0, "y nunca se consultó el dinero de ninguno de los dos");
});

test("si el número pasa a ser de dos pacientes A MEDIA verificación, la fecha ya no basta", async () => {
  const primero = await correr("¿cuánto debo?");
  pacientes = DOS_PACIENTES;
  const r = await correr("15/03/1990", primero!.newBotState ?? null);
  sinCifras(r!.reply, "la fecha correcta ya no basta");
  assert.equal(lecturasDeSaldo, 0);
});

test("un número que no es de ningún paciente no se entera de que no lo es", async () => {
  pacientes = [];
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.reply, TEXTOS.pideFecha, "se le pide la fecha igual que a todo el mundo");
  assert.equal(rastro[0].resultado, "verificacionPedida");
  assert.equal(rastro[0].patientId, null, "pero no se atribuye a nadie");
});

test("sin fecha de nacimiento en el expediente no se inventa otra pregunta más débil", async () => {
  pacientes = [{ id: "p1", firstName: "Ana", dob: null }];
  const primero = await correr("¿cuánto debo?");
  const r = await correr("15/03/1990", primero!.newBotState ?? null);
  sinCifras(r!.reply, "sin con qué verificar, no se contesta");
  assert.equal(lecturasDeSaldo, 0);
  assert.ok(rastro.some((x) => x.resultado === "sinFechaDeNacimiento"));
});

test("EL ORÁCULO: el primer mensaje es idéntico exista o no el paciente", async () => {
  // Si el bot contestara «esto lo ve una persona» solo cuando el número NO es
  // de un paciente, cualquiera averiguaría con UN mensaje si el número que
  // acaba de heredar pertenece a un paciente de la clínica.
  const respuestas = new Set<string>();

  pacientes = [{ id: "p1", firstName: "Ana", dob: DOB }];
  respuestas.add((await correr("¿cuánto debo?"))!.reply!);
  pacientes = [];
  respuestas.add((await correr("¿cuánto debo?"))!.reply!);
  pacientes = [{ id: "p1", firstName: "Ana", dob: null }];
  respuestas.add((await correr("¿cuánto debo?"))!.reply!);
  pacientes = DOS_PACIENTES;
  respuestas.add((await correr("¿cuánto debo?"))!.reply!);

  assert.equal(respuestas.size, 1, "un solo texto para los cuatro casos");
});

test("y el segundo mensaje tampoco distingue: quien no es paciente «falla la fecha»", async () => {
  const respuestas = new Set<string>();
  for (const caso of [
    [{ id: "p1", firstName: "Ana", dob: DOB }] as PacienteSaldo[], // paciente real, fecha mal
    [] as PacienteSaldo[],
    [{ id: "p1", firstName: "Ana", dob: null }] as PacienteSaldo[],
    DOS_PACIENTES,
  ]) {
    rastro = [];
    fallosPrevios = 0;
    pacientes = caso;
    const primero = await correr("¿cuánto debo?");
    respuestas.add((await correr("01/01/1980", primero!.newBotState ?? null))!.reply!);
  }
  assert.equal(respuestas.size, 1, "todos reciben el mismo «esa fecha no me coincide»");
});

/* ═══ 3b. EL CONTADOR NO SE REINICIA SOLO ══════════════════════════════ */

test("esperar a que caduque la sesión NO regala intentos nuevos", async () => {
  // El agujero: el estado del hilo caduca a los 10 min. Si el contador viviera
  // solo ahí, bastaría esperar once minutos entre intento e intento para
  // probar fechas indefinidamente — 144 al día, para siempre.
  fallosPrevios = 1; // ya falló una vez hace rato; la sesión ya caducó
  const r = await correr("¿cuánto debo?"); // pregunta NUEVA, sin estado
  assert.equal(r!.reply, TEXTOS.noCuadra === r!.reply ? TEXTOS.noCuadra : TEXTOS.pideFecha);
  // Falla otra vez: con el previo ya son dos, y se acabó.
  const segundo = await correr("01/01/1980", r!.newBotState ?? null);
  assert.equal(segundo!.reply, TEXTOS.derivar, "el fallo viejo SÍ contaba");
  assert.equal(segundo!.handoff, true);
  assert.equal(lecturasDeSaldo, 0);
});

test("con los intentos ya agotados no se vuelve ni a preguntar", async () => {
  fallosPrevios = MAX_INTENTOS;
  const r = await correr("¿cuánto debo?");
  assert.equal(r!.reply, TEXTOS.derivar, "no se le da otra oportunidad de probar");
  assert.equal(r!.handoff, true);
  assert.equal(lecturasDeSaldo, 0);
});

test("pero un paciente que acierta a la primera no paga por fallos ajenos", async () => {
  fallosPrevios = MAX_INTENTOS - 1;
  const primero = await correr("¿cuánto debo?");
  const r = await correr("15/03/1990", primero!.newBotState ?? null);
  assert.ok(r!.reply!.includes("$2,000.00"), "acertar sigue funcionando");
});

/* ═══ 4. EL RASTRO ═════════════════════════════════════════════════════ */

test("la consulta de saldo deja rastro de quién preguntó y qué se contestó", async () => {
  const primero = await correr("¿cuánto debo?");
  await correr("15/03/1990", primero!.newBotState ?? null);

  assert.equal(rastro.length, 2, "se anota el intento y la entrega");
  const entrega = rastro[1];
  assert.equal(entrega.resultado, "saldoEntregado", "consta que SÍ se dijo el saldo");
  assert.equal(entrega.patientId, "p1", "de quién");
  assert.equal(entrega.clinicId, "c1");
  assert.equal(entrega.threadId, "t1", "y en qué conversación");
  assert.ok(entrega.telefono, "desde qué número");
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
  const cfg = config();
  const primero = await runSaldoTurn(turno("¿cuánto debo?"), cfg, espia);
  await runSaldoTurn(turno("15/03/1990", primero!.newBotState ?? null), cfg, espia);
  assert.deepEqual(orden, ["registra:verificacionPedida", "lee", "registra:saldoEntregado"]);
});

test("también queda rastro cuando NO hay nada que cobrar", async () => {
  resumen = null;
  const primero = await correr("¿cuánto debo?");
  const r = await correr("15/03/1990", primero!.newBotState ?? null);
  assert.equal(r!.reply, TEXTOS.sinPlan);
  assert.equal(rastro[1].resultado, "sinPlan");
});

/* ═══ 5. SE CONTESTA LO MÍNIMO ═════════════════════════════════════════ */

test("la respuesta lleva la cuota y lo pendiente, y nada más", async () => {
  const texto = textoDelSaldo(resumen!, { importe: (n) => `$${n}`, fecha: (f) => f });
  assert.ok(texto.includes("$2000"), "la cuota");
  assert.ok(texto.includes("$18000"), "lo pendiente");
  // Ni historial, ni tratamientos, ni procedimientos.
  assert.doesNotMatch(texto, /tratamiento|procedimiento|diagn|factura|expediente/i);
});

test("si va atrasado se le dice, sin regañarlo", async () => {
  const texto = textoDelSaldo(
    { ...resumen!, tieneVencidas: true },
    { importe: (n) => `$${n}`, fecha: (f) => f },
  );
  assert.match(texto, /atrasado/);
});

test("el enganche se llama enganche, no «mensualidad 0»", async () => {
  const texto = textoDelSaldo(
    { ...resumen!, esEnganche: true, numeroCuota: 0 },
    { importe: (n) => `$${n}`, fecha: (f) => f },
  );
  assert.match(texto, /enganche/);
  assert.doesNotMatch(texto, /mensualidad 0/);
});

/* ═══ 6. CUÁNDO SE DA POR ALUDIDO ══════════════════════════════════════ */

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
  // Un falso positivo aquí le pide a un paciente su fecha de nacimiento sin
  // venir a cuento, en mitad de otra cosa.
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

/* ═══ 7. LA FECHA DE NACIMIENTO, ESTRICTA ══════════════════════════════ */

test("acepta las formas en que la gente escribe una fecha", async () => {
  assert.equal(parseFechaNacimiento("15/03/1990"), "1990-03-15");
  assert.equal(parseFechaNacimiento("15-3-1990"), "1990-03-15");
  assert.equal(parseFechaNacimiento("1990-03-15"), "1990-03-15");
  assert.equal(parseFechaNacimiento("15 de marzo de 1990"), "1990-03-15");
  assert.equal(parseFechaNacimiento("nací el 15 de Marzo de 1990"), "1990-03-15");
});

test("exige el año completo: sin él no hay verificación que valga", async () => {
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
