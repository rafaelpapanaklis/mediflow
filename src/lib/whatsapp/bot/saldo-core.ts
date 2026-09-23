// ═══════════════════════════════════════════════════════════════════════════
// «¿CUÁNTO DEBO?» POR WHATSAPP — máquina de estados pura (ws1-t3, ws1-t5).
//
// El cliente lo pidió así, y las comillas son suyas: «consultar de forma segura
// la próxima mensualidad del paciente».
//
// ── Por qué el teléfono NO es la identidad ────────────────────────────────
// Un número de teléfono se presta, se hereda, se reasigna y se recicla. El
// WhatsApp que escribe «¿cuánto debo?» prueba que alguien tiene ESE TELÉFONO,
// no que sea el paciente. De ahí salen las reglas:
//
//   1. INTERRUPTOR de la clínica, apagado de fábrica. Sin él, el bot no habla
//      de dinero ni aunque le pregunten (`reminderSettings.cobranza.bot`).
//   2. UN PACIENTE EN EL NÚMERO ⇒ SE CONTESTA DE UNA. Un mensaje, una
//      respuesta, sin pedir ningún dato.
//   3. TELÉFONO COMPARTIDO ⇒ NO SE ADIVINA: SE DESAMBIGUA. Una mamá con tres
//      hijos en la misma clínica es el caso NORMAL. Con dos pacientes o más en
//      ese número se pide la fecha de nacimiento, y SOLO para saber a cuál de
//      ellos contestarle: si cuadra con exactamente uno, se le contesta a ese.
//      Si no cuadra con ninguno (o con más de uno: gemelos), se deriva a una
//      persona y el bot se calla en ese hilo (`handoff`) hasta que la clínica
//      lo reactive. Elegir al primero le enseñaría a uno la deuda del otro, y
//      eso no se puede deshacer. Por lo mismo, para decidir si el número es
//      compartido cuentan TODOS sus pacientes, también los dados de baja: si
//      solo contaran los activos, el hijo dado de baja que escribe desde el
//      teléfono de su mamá recibiría la deuda de ella como si fuera suya. A
//      un paciente dado de baja no se le contesta nunca (se deriva).
//   4. NO SE REINTENTA EN BUCLE. Dos fallos al día por hilo y se deriva, y se
//      cuentan sobre el rastro, no sobre la sesión (ver `VENTANA_FALLOS_MS`):
//      sin ese tope, el número compartido sería un oráculo para adivinar las
//      fechas de nacimiento de los demás pacientes que cuelgan de él.
//      ⚠️ No es un candado: varias fechas mandadas en el mismo instante leen
//      el mismo recuento antes de que se escriba ninguna nota (el webhook no
//      serializa por hilo). Frena el goteo, no una ráfaga.
//   5. LO MÍNIMO. La próxima cuota y lo que falta. Ni el historial, ni los
//      tratamientos, ni el nombre de los procedimientos: quien pregunta por su
//      saldo no está pidiendo su expediente.
//   6. QUEDA RASTRO. Contestar un saldo es un acceso a datos del paciente, y
//      se registra como tal (lo hace el shell, `saldo.ts`).
//
// ── Lo que cambió el 23-sep-2026, y por qué ───────────────────────────────
// Esto nació pidiéndole la fecha de nacimiento a TODO el que preguntara, como
// control de seguridad, antes de decir un peso. Rafael lo quitó ese día como
// DECISIÓN DE PRODUCTO, no por descuido: «no es necesario que pregunte fecha
// de nacimiento para consultar la próxima mensualidad». Cada consulta costaba
// el doble de mensajes de WhatsApp, y esa fricción no la pidió el cliente:
// pidió «de forma segura», y el cómo lo elegimos nosotros. Ese mismo día
// decidió también que, en un número compartido, la fecha se siga pidiendo,
// pero como DESAMBIGUACIÓN (¿de cuál de ellos hablamos?), no como control.
// ⛔ No vuelvas a convertirla en un control para todos sin hablarlo con él.
//
// Lo que se acepta con eso, dicho claro para que nadie lo descubra después:
// quien tenga el teléfono de un paciente único (prestado, heredado o
// reciclado) sabrá su próxima cuota y lo pendiente con un solo mensaje, y la
// respuesta delata que ese número es de un paciente de la clínica. Por eso las
// demás reglas no se aflojan: son lo que queda entre el dato y quien no es su
// dueño.
//
// Si algún día se desambigua por otro dato (el correo, por ejemplo), valen las
// mismas reglas: el dato sirve para elegir a UNO entre los pacientes de ese
// número y nada más; si no elige a exactamente uno, se deriva; y los fallos
// cuentan contra el mismo tope. Se enchufa como otro `elegirPor…` con los
// mismos cuatro desenlaces que `elegirPorFecha`.
//
// Puro y sin I/O: todo lo que toca base de datos entra por `SaldoDeps`, que las
// pruebas rellenan con dobles. Aquí no se manda ni un WhatsApp.
//
// Las cuotas NO se calculan aquí: salen de `lib/invoices/plan-de-pagos.ts`
// (ws1-t2), igual que en la ficha y que en el aviso. Una sola verdad.
// ═══════════════════════════════════════════════════════════════════════════

import { BotIntent } from "./types";
import type { BotConfigDTO, BotJson, BotTurnInput, BotTurnResult } from "./types";
import { foldAccents } from "./booking-parse";

/** Lo que el bot puede llegar a decir de dinero. Nada más que esto. */
export interface ResumenSaldo {
  /** "YYYY-MM-DD" de la próxima cuota por vencer. null = no hay ninguna. */
  vencimiento: string | null;
  /** Lo que falta de esa cuota, en pesos. */
  importeCuota: number;
  /** El «7» de «cuota 7 de 24». 0 = enganche. */
  numeroCuota: number;
  esEnganche: boolean;
  totalCuotas: number;
  /** Lo que falta del plan entero, en pesos. */
  pendiente: number;
  /** Ya venció alguna cuota y sigue debiendo. */
  tieneVencidas: boolean;
}

/** Un paciente candidato de ese teléfono. */
export interface PacienteSaldo {
  id: string;
  /** false = dado de baja (INACTIVE/ARCHIVED): cuenta para desambiguar, pero no se le contesta. */
  activo: boolean;
  /**
   * Fecha de nacimiento "YYYY-MM-DD", o null si la clínica no la tiene. Solo
   * se usa para elegir entre varios pacientes del mismo número.
   */
  dob: string | null;
}

export interface SaldoDeps {
  /**
   * TODOS los pacientes de la clínica con ese teléfono, activos o no. Nunca
   * solo el primero, y nunca solo los activos (ver regla 3).
   */
  buscarPacientesPorTelefono(clinicId: string, phone: string): Promise<PacienteSaldo[]>;
  /** El resumen de dinero del paciente. null = no tiene plan a plazos vivo. */
  resumenDeSaldo(clinicId: string, patientId: string): Promise<ResumenSaldo | null>;
  /** Deja constancia de que se consultó (y de si se contestó). No lanza. */
  registrarConsulta(datos: RastroConsulta): Promise<void>;
  /**
   * Cuántas desambiguaciones han fallado ya en este hilo dentro de la ventana
   * larga (`VENTANA_FALLOS_MS`), leídas de lo ya registrado.
   *
   * Existe porque el contador NO puede vivir solo en `botState`: ese estado
   * caduca a los 10 minutos, y cada «¿cuánto debo?» nuevo empieza sin estado.
   * Si solo contara la sesión, preguntar otra vez regalaría intentos nuevos.
   */
  fallosRecientes(clinicId: string, threadId: string): Promise<number>;
  /** Formatea un importe en pesos mexicanos. */
  formatearImporte(pesos: number): string;
  /** Formatea "YYYY-MM-DD" como «3 de marzo de 2026». */
  formatearFecha(iso: string): string;
}

/** Lo que se registra de cada consulta de saldo. */
export interface RastroConsulta {
  clinicId: string;
  threadId: string;
  /** null cuando no se pudo identificar a nadie. */
  patientId: string | null;
  telefono: string;
  resultado: ResultadoConsulta;
}

export type ResultadoConsulta =
  /** Se contestó el saldo. ESTE es el acceso a datos. */
  | "saldoEntregado"
  /** Se identificó al paciente, pero no hay plan a plazos que contar. */
  | "sinPlan"
  /** El teléfono no es de ningún paciente. */
  | "pacienteNoEncontrado"
  /** El paciente identificado está dado de baja: no se le habla de dinero. */
  | "pacienteDeBaja"
  /** Número compartido: se pidió la fecha para saber de cuál se trata. */
  | "fechaPedida"
  /** Lo que respondió no es una fecha. Cuenta como fallo; se le pide otra vez. */
  | "fechaIlegible"
  /** La fecha no es de ninguno de los pacientes del número. Fallo; se deriva. */
  | "fechaSinCoincidencia"
  /** La fecha es de más de uno (gemelos): no hay a quién elegir. Se deriva. */
  | "fechaAmbigua"
  /** Segundo fallo, o ya los había gastado: se deriva sin volver a preguntar. */
  | "intentosAgotados";

/** Los resultados que cuentan contra el tope de `MAX_FALLOS`. */
export const RESULTADOS_FALLIDOS: readonly ResultadoConsulta[] = [
  "fechaIlegible",
  "fechaSinCoincidencia",
  "intentosAgotados",
];

/**
 * El final del `externalId` de la nota que deja cada consulta. Lo usan tanto
 * quien la escribe como quien cuenta los fallos (`saldo.ts`): si cada lado
 * armara el suyo, un cambio en uno dejaría el tope contando cero en silencio.
 */
export function sufijoDelRastro(resultado: ResultadoConsulta): string {
  return `:saldo-${resultado}`;
}

/**
 * Dos fallos. Uno solo castiga el dedazo honesto; muchos convierten al bot en
 * un oráculo para adivinar la fecha de nacimiento de los otros pacientes de un
 * número compartido. Agotados, se deriva a una persona.
 */
export const MAX_FALLOS = 2;

/**
 * Y los fallos se cuentan dentro de UN DÍA, no dentro de la sesión: el estado
 * del hilo caduca a los 10 minutos y cada pregunta nueva empieza sin él.
 */
export const VENTANA_FALLOS_MS = 24 * 60 * 60 * 1000;

/**
 * La pregunta de desambiguación caduca en 10 minutos: una fecha que llega
 * mañana ya no es la respuesta a la pregunta de hoy.
 */
export const SALDO_TTL_MS = 10 * 60 * 1000;

/** ¿Hay una desambiguación de saldo a medias en este hilo? */
export function isSaldoInProgress(state: BotJson | null | undefined): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const s = state as { flow?: unknown; updatedAt?: unknown };
  if (s.flow !== "saldo") return false;
  if (typeof s.updatedAt === "number" && Date.now() - s.updatedAt > SALDO_TTL_MS) return false;
  return true;
}

/**
 * ¿Están preguntando por dinero?
 *
 * Deliberadamente ESTRECHO. Un falso positivo aquí secuestra una conversación
 * normal y le suelta al paciente su deuda sin que la haya pedido, así que se
 * exige una palabra de dinero de verdad. Lo que no case cae al flujo de
 * siempre (FAQ, agenda, IA), que es el comportamiento de hoy.
 */
export function detectaIntencionDeSaldo(texto: string): boolean {
  const n = foldAccents(texto ?? "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return false;
  const patrones = [
    // El pronombre en medio ("cuánto ME falta", "cuánto LE debo") es la forma
    // más común de preguntarlo, no la rara.
    /\bcuanto\s+(me|le|te|nos)?\s*(debo|debemos|resta|falta|queda|restan|faltan|quedan)\b/,
    /\bcuanto\s+(es|seria)\s+(mi|el)\s+(pago|abono|mensualidad)\b/,
    /\bmi\s+(saldo|adeudo|deuda|mensualidad|abono)\b/,
    /\b(saldo|adeudo)\s+(pendiente|actual|restante)\b/,
    /\b(proxima|siguiente)\s+(mensualidad|cuota|pago|letra)\b/,
    /\bcuando\s+(vence|pago|toca)\b.*\b(mensualidad|cuota|pago|letra)\b/,
    /\b(mensualidad|cuota|letra)\s+.*\b(vence|pendiente|debo)\b/,
    /\bestado\s+de\s+cuenta\b/,
  ];
  return patrones.some((r) => r.test(n));
}

/**
 * Fecha de nacimiento, ESTRICTA: día, mes y año de cuatro cifras.
 *
 * No se reutiliza `parseDateInput` (el de agendar) a propósito: aquel entiende
 * «mañana» y «lunes» y, sin año, asume el actual — perfecto para una cita,
 * inservible y peligroso para elegir entre pacientes, porque daría por buena
 * una fecha que el paciente nunca quiso decir y podría elegir al que no es.
 * Aquí, o está el año completo, o no hay fecha.
 *
 * Acepta «15/03/1990», «15-3-1990», «1990-03-15» y «15 de marzo de 1990».
 */
export function parseFechaNacimiento(texto: string): string | null {
  const t = foldAccents(texto ?? "");
  if (!t) return null;

  const iso = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return armaFecha(+iso[1], +iso[2], +iso[3]);

  const dmy = t.match(/\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})\b/);
  if (dmy) return armaFecha(+dmy[3], +dmy[2], +dmy[1]);

  const MESES: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
    noviembre: 11, diciembre: 12,
  };
  const nombrada = t.match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+|del\s+)?(\d{4})\b/);
  if (nombrada) {
    const mes = MESES[nombrada[2]];
    if (mes) return armaFecha(+nombrada[3], mes, +nombrada[1]);
  }
  return null;
}

/** Valida el calendario de verdad: el 31 de febrero no existe. */
function armaFecha(anio: number, mes: number, dia: number): string | null {
  if (!(anio >= 1900 && anio <= 2100)) return null;
  if (!(mes >= 1 && mes <= 12)) return null;
  if (!(dia >= 1 && dia <= 31)) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Elige a UNO de los pacientes del número por su fecha de nacimiento.
 *
 * Los cuatro desenlaces son los únicos posibles, y un dato distinto (el correo)
 * tendría los mismos: o elige a uno, o no elige a nadie, o elige a varios, o
 * lo que llegó ni siquiera es el dato.
 */
export type Eleccion =
  | { tipo: "uno"; paciente: PacienteSaldo }
  | { tipo: "ninguno" }
  | { tipo: "varios" }
  | { tipo: "ilegible" };

export function elegirPorFecha(candidatos: PacienteSaldo[], texto: string): Eleccion {
  const fecha = parseFechaNacimiento(texto);
  if (!fecha) return { tipo: "ilegible" };
  const cuadran = candidatos.filter((p) => p.dob !== null && p.dob === fecha);
  if (cuadran.length === 1) return { tipo: "uno", paciente: cuadran[0] };
  return cuadran.length === 0 ? { tipo: "ninguno" } : { tipo: "varios" };
}

/* ── Los textos, en español de México y cortos ────────────────────────────
   Los lee un paciente en el teléfono, no un dentista: sin tecnicismos, sin
   «verificación de identidad» ni «registro no encontrado». Lo que no se puede
   contestar termina igual —«escríbenos y te ayudamos»—, sea un número sin
   paciente o una fecha que no cuadra: así no se puede sondear qué fechas
   existen detrás de un número.                                             */

export const TEXTOS = {
  pideFecha:
    "Con gusto te digo. En este número tengo a más de un paciente: para saber de quién " +
    "me preguntas, respóndeme su *fecha de nacimiento* (por ejemplo: 15/03/1990).",
  fechaIlegible:
    "No logré leer la fecha. Escríbela así, por favor: día/mes/año (por ejemplo: 15/03/1990).",
  derivar:
    "Por seguridad, esto mejor lo vemos contigo directamente. Escríbenos por aquí y " +
    "en un momento te atiende una persona del consultorio. 🙌",
  sinPlan:
    "No tienes mensualidades pendientes por ahora. Si tienes dudas de un pago, " +
    "escríbenos y con gusto lo revisamos.",
} as const;

/** Arma la respuesta del saldo. Lo mínimo: la próxima cuota y lo pendiente. */
export function textoDelSaldo(
  r: ResumenSaldo,
  fmt: { importe: (n: number) => string; fecha: (iso: string) => string },
): string {
  const cual = r.esEnganche
    ? "tu *enganche*"
    : r.totalCuotas > 0
      ? `tu *mensualidad ${r.numeroCuota} de ${r.totalCuotas}*`
      : "tu *próxima mensualidad*";

  const lineas: string[] = [];
  if (r.vencimiento) {
    lineas.push(`${cap(cual)} es de *${fmt.importe(r.importeCuota)}* y vence el *${fmt.fecha(r.vencimiento)}*.`);
  } else {
    lineas.push(`${cap(cual)} es de *${fmt.importe(r.importeCuota)}*.`);
  }
  lineas.push(`Te queda pendiente *${fmt.importe(r.pendiente)}* en total.`);
  if (r.tieneVencidas) {
    lineas.push("Tienes un pago atrasado. Si ya lo hiciste, mándanos tu comprobante.");
  }
  lineas.push("Si ya pagaste, no hagas caso a este mensaje. 🙌");
  return lineas.join("\n");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Un turno del flujo de saldo.
 *
 * Devuelve `null` cuando esto no va con él (interruptor apagado, o no están
 * preguntando por dinero y no hay una desambiguación a medias): el motor sigue
 * con FAQ, agenda e IA exactamente como hoy.
 */
export async function runSaldoTurn(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: SaldoDeps,
): Promise<BotTurnResult | null> {
  // 1. El interruptor de la clínica manda, y va ANTES que nada: con esto
  //    apagado el bot no consulta, no busca al paciente y no deja rastro,
  //    porque no ha pasado nada que registrar.
  if (!config.canAnswerBalance) return null;

  const enCurso = isSaldoInProgress(input.botState);
  const texto = (input.incomingText ?? "").trim();

  // 2. ¿Va conmigo? O hay una desambiguación a medias, o están preguntando.
  if (!enCurso && !detectaIntencionDeSaldo(texto)) return null;

  const telefono = (input.patient?.phone ?? "").trim();
  const clinicId = input.clinicId;
  // (c) de la casa: sin clinicId no se consulta.
  if (!clinicId || !telefono) {
    return derivar(deps, clinicId, input, null, telefono, "pacienteNoEncontrado");
  }

  // 3. Siempre la lista de HOY: si el número cambió entre la pregunta y la
  //    fecha, manda lo que hay ahora, no lo que había.
  const pacientes = await deps.buscarPacientesPorTelefono(clinicId, telefono);
  if (pacientes.length === 0) {
    return derivar(deps, clinicId, input, null, telefono, "pacienteNoEncontrado");
  }

  // Un solo paciente: se contesta de una, sin preguntar nada (regla 2).
  if (pacientes.length === 1) {
    if (enCurso) {
      // Quedó una pregunta a medias (el número tenía más pacientes, o es un
      // estado de antes del 23-sep-2026). Si lo que llega es una fecha, TIENE
      // que ser la de este paciente: una fecha de otro es alguien preguntando
      // por otra persona, y contestarle con esta deuda sería la fuga que la
      // regla 3 existe para impedir.
      const eleccion = elegirPorFecha(pacientes, texto);
      if (eleccion.tipo === "ninguno") {
        return derivar(deps, clinicId, input, null, telefono, "fechaSinCoincidencia");
      }
      // Ni fecha ni pregunta de dinero: esto ya no va conmigo.
      if (eleccion.tipo === "ilegible" && !detectaIntencionDeSaldo(texto)) return null;
    }
    return contesta(deps, clinicId, input, pacientes[0], telefono);
  }

  // ── Número compartido (regla 3) ──────────────────────────────────────────
  // ¿Ya gastó sus intentos? Sobre el rastro, no sobre la sesión.
  const fallosPrevios = await deps.fallosRecientes(clinicId, input.threadId);
  if (fallosPrevios >= MAX_FALLOS) {
    return derivar(deps, clinicId, input, null, telefono, "intentosAgotados");
  }

  if (!enCurso) {
    await deps.registrarConsulta({
      clinicId, threadId: input.threadId, patientId: null, telefono, resultado: "fechaPedida",
    });
    return esperaFecha(TEXTOS.pideFecha);
  }

  // Lo que llega es (o debería ser) la fecha.
  const eleccion = elegirPorFecha(pacientes, texto);
  switch (eleccion.tipo) {
    case "uno":
      return contesta(deps, clinicId, input, eleccion.paciente, telefono);
    case "varios":
      // Gemelos: la fecha no elige. No es un fallo de quien pregunta.
      return derivar(deps, clinicId, input, null, telefono, "fechaAmbigua");
    case "ninguno":
      // Una fecha bien escrita que no es de nadie: se deriva ya. Dejarle probar
      // otra en el acto es justo lo que haría falta para sondear fechas.
      return derivar(deps, clinicId, input, null, telefono, "fechaSinCoincidencia");
    case "ilegible":
      // Cuenta como fallo. Si era el segundo, se acabó.
      if (fallosPrevios + 1 >= MAX_FALLOS) {
        return derivar(deps, clinicId, input, null, telefono, "intentosAgotados");
      }
      await deps.registrarConsulta({
        clinicId, threadId: input.threadId, patientId: null, telefono, resultado: "fechaIlegible",
      });
      return esperaFecha(TEXTOS.fechaIlegible);
  }
}

/** Se pregunta (o se repregunta) la fecha y el hilo queda esperándola. */
function esperaFecha(reply: string): BotTurnResult {
  return {
    reply,
    intent: BotIntent.UNKNOWN,
    newBotState: { flow: "saldo", updatedAt: Date.now() } as unknown as BotJson,
  };
}

/** Se contesta lo mínimo y queda el rastro del acceso. */
async function contesta(
  deps: SaldoDeps,
  clinicId: string,
  input: BotTurnInput,
  paciente: PacienteSaldo,
  telefono: string,
): Promise<BotTurnResult> {
  // Dado de baja: si la clínica decidió que a esta persona no se le cobra por
  // WhatsApp, el bot tampoco le habla de dinero (mismo criterio que el aviso,
  // `cobranza/core.ts`). Ni se lee su saldo.
  if (!paciente.activo) {
    return derivar(deps, clinicId, input, paciente.id, telefono, "pacienteDeBaja");
  }

  const resumen = await deps.resumenDeSaldo(clinicId, paciente.id);

  if (!resumen) {
    await deps.registrarConsulta({
      clinicId, threadId: input.threadId, patientId: paciente.id, telefono, resultado: "sinPlan",
    });
    return { reply: TEXTOS.sinPlan, intent: BotIntent.UNKNOWN, newBotState: null };
  }

  // El rastro se escribe ANTES de devolver la respuesta: si registrar fallara,
  // que falle antes de que el dato salga, no después. `registrarConsulta` no
  // lanza (lo garantiza el shell), así que esto no puede tumbar la respuesta.
  await deps.registrarConsulta({
    clinicId, threadId: input.threadId, patientId: paciente.id, telefono, resultado: "saldoEntregado",
  });

  return {
    reply: textoDelSaldo(resumen, { importe: deps.formatearImporte, fecha: deps.formatearFecha }),
    intent: BotIntent.UNKNOWN,
    // Se limpia el estado: la siguiente pregunta en un número compartido
    // vuelve a preguntar de quién se trata.
    newBotState: null,
  };
}

/**
 * Los desenlaces de una desambiguación que no eligió a nadie. Aquí el bot se
 * calla en el hilo (`handoff` → `botActive = false` en el webhook) para que lo
 * que escriba después lo lea una persona y no la IA: es lo que quiere decir
 * «se deriva a una persona».
 */
const CALLAN_AL_BOT: readonly ResultadoConsulta[] = [
  "fechaSinCoincidencia",
  "fechaAmbigua",
  "intentosAgotados",
];

/**
 * Todo lo que no se puede contestar sale por aquí, y SIEMPRE con el mismo
 * texto: quien pregunta no puede distinguir «no eres paciente» de «esa fecha
 * no es de nadie» ni de «ya no te quedan intentos».
 *
 * ⚠️ `handoff` no vuelve solo: hasta que alguien reactive el bot a mano, ese
 * hilo se queda sin FAQ y sin poder agendar. Por eso solo se apaga cuando falló
 * una desambiguación (`CALLAN_AL_BOT`), y no por un número sin paciente o un
 * paciente dado de baja, que no han hecho nada que una persona tenga que mirar.
 */
async function derivar(
  deps: SaldoDeps,
  clinicId: string,
  input: BotTurnInput,
  patientId: string | null,
  telefono: string,
  resultado: ResultadoConsulta,
): Promise<BotTurnResult> {
  if (clinicId) {
    await deps.registrarConsulta({
      clinicId, threadId: input.threadId, patientId, telefono, resultado,
    });
  }
  const apagarElBot = CALLAN_AL_BOT.includes(resultado);
  return {
    reply: TEXTOS.derivar,
    intent: apagarElBot ? BotIntent.HANDOFF : BotIntent.UNKNOWN,
    ...(apagarElBot ? { handoff: true } : {}),
    newBotState: null,
  };
}
