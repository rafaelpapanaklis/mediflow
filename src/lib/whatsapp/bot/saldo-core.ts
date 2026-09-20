// ═══════════════════════════════════════════════════════════════════════════
// «¿CUÁNTO DEBO?» POR WHATSAPP — máquina de estados pura (ws1-t3).
//
// El cliente lo pidió así, y las comillas son suyas: «consultar de forma segura
// la próxima mensualidad del paciente». El «de forma segura» es la mitad del
// encargo, así que está escrito aquí arriba y no al final.
//
// ── Por qué el teléfono NO es la identidad ────────────────────────────────
// Un número de teléfono se presta, se hereda, se reasigna y se recicla. El
// WhatsApp que escribe «¿cuánto debo?» prueba que alguien tiene ESE TELÉFONO,
// no que sea el paciente. Todo el resto de este archivo sale de ahí:
//
//   1. INTERRUPTOR de la clínica, apagado de fábrica. Sin él, el bot no habla
//      de dinero ni aunque le pregunten (`reminderSettings.cobranza.bot`).
//   2. SEGUNDO DATO. Antes de decir un peso, se pide la fecha de nacimiento:
//      es el dato que la clínica SIEMPRE tiene y que quien toma prestado el
//      teléfono normalmente no sabe. Se pide siempre, en cada consulta: no se
//      guarda «este hilo ya está verificado», porque el teléfono puede cambiar
//      de manos entre una pregunta y la siguiente.
//   3. NO SE REINTENTA EN BUCLE. Dos intentos (un dedazo en una fecha es
//      humano) y se acabó: se deriva a la clínica. Un bucle infinito sobre un
//      dato de baja entropía es un oráculo para adivinar fechas de nacimiento.
//   4. TELÉFONO COMPARTIDO ⇒ NO SE ADIVINA. Una mamá con tres hijos en la
//      misma clínica es el caso NORMAL. Con dos pacientes o más en ese número
//      se deriva a la clínica: elegir al primero le enseñaría a uno la deuda
//      del otro, y eso no se puede deshacer.
//   5. LO MÍNIMO. La próxima cuota y lo que falta. Ni el historial, ni los
//      tratamientos, ni el nombre de los procedimientos: quien pregunta por su
//      saldo no está pidiendo su expediente.
//   6. QUEDA RASTRO. Contestar un saldo es un acceso a datos del paciente, y
//      se registra como tal (lo hace el shell, `saldo.ts`).
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
  firstName: string;
  /** Fecha de nacimiento "YYYY-MM-DD", o null si la clínica no la tiene. */
  dob: string | null;
}

export interface SaldoDeps {
  /** TODOS los pacientes de la clínica con ese teléfono. Nunca solo el primero. */
  buscarPacientesPorTelefono(clinicId: string, phone: string): Promise<PacienteSaldo[]>;
  /** El resumen de dinero del paciente. null = no tiene plan a plazos vivo. */
  resumenDeSaldo(clinicId: string, patientId: string): Promise<ResumenSaldo | null>;
  /** Deja constancia de que se consultó (y de si se contestó). No lanza. */
  registrarConsulta(datos: RastroConsulta): Promise<void>;
  /**
   * Cuántas verificaciones han fallado ya en este hilo dentro de la ventana
   * larga (`VENTANA_FALLOS_MS`).
   *
   * Existe porque el contador NO puede vivir solo en `botState`: ese estado
   * caduca a los 10 minutos, así que quien esperase 11 minutos entre intento e
   * intento volvería a empezar de cero y podría probar fechas indefinidamente.
   * Este recuento se lee de lo ya registrado, que no caduca con la sesión.
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
  /** Se pidió la fecha de nacimiento. Todavía no se dijo nada de dinero. */
  | "verificacionPedida"
  /** La fecha no cuadró. */
  | "verificacionFallida"
  /** Se agotaron los intentos y se derivó. */
  | "verificacionAgotada"
  /** Cuadró y se contestó el saldo. ESTE es el acceso a datos. */
  | "saldoEntregado"
  /** Cuadró, pero no hay plan a plazos que contar. */
  | "sinPlan"
  /** El teléfono no es de ningún paciente. */
  | "pacienteNoEncontrado"
  /** El teléfono es de dos o más pacientes: se derivó sin adivinar. */
  | "telefonoCompartido"
  /** La clínica no guarda la fecha de nacimiento: no hay con qué verificar. */
  | "sinFechaDeNacimiento";

/** Estado multi-turno mientras se espera la fecha de nacimiento. */
export interface SaldoState {
  flow: "saldo";
  patientId: string;
  intentos: number;
  updatedAt: number;
}

/**
 * Dos intentos. Uno solo castiga el dedazo honesto; muchos convierten al bot en
 * un oráculo para adivinar la fecha de nacimiento de alguien probando por
 * WhatsApp. Agotados, se deriva a una persona.
 */
export const MAX_INTENTOS = 2;

/**
 * Y los dos intentos se cuentan dentro de UN DÍA, no dentro de la sesión.
 *
 * El contador de `botState` caduca con la sesión (10 min). Si fuera el único,
 * bastaría con esperar once minutos entre intento e intento para volver a
 * empezar de cero: 144 pruebas al día, para siempre, sin llegar nunca al
 * límite. Por eso el corte real se cuenta sobre el rastro ya escrito, que no
 * caduca cuando expira la sesión.
 */
export const VENTANA_FALLOS_MS = 24 * 60 * 60 * 1000;

/**
 * La verificación caduca en 10 minutos. Es una sesión de identidad, no un
 * carrito de compra: el teléfono puede cambiar de manos, y una pregunta
 * contestada mañana sobre una verificación de hoy no prueba nada.
 */
export const SALDO_TTL_MS = 10 * 60 * 1000;

/** ¿Hay una verificación de saldo a medias en este hilo? */
export function isSaldoInProgress(state: BotJson | null | undefined): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const s = state as { flow?: unknown; updatedAt?: unknown };
  if (s.flow !== "saldo") return false;
  if (typeof s.updatedAt === "number" && Date.now() - s.updatedAt > SALDO_TTL_MS) return false;
  return true;
}

function leerEstado(state: BotJson | null | undefined): SaldoState | null {
  if (!isSaldoInProgress(state)) return null;
  const s = state as unknown as SaldoState;
  return {
    flow: "saldo",
    patientId: typeof s.patientId === "string" ? s.patientId : "",
    intentos: typeof s.intentos === "number" ? s.intentos : 0,
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
  };
}

/**
 * ¿Están preguntando por dinero?
 *
 * Deliberadamente ESTRECHO. Un falso positivo aquí secuestra una conversación
 * normal y le pide al paciente la fecha de nacimiento sin venir a cuento, así
 * que se exige una palabra de dinero de verdad. Lo que no case cae al flujo de
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
 * inservible y peligroso para verificar una identidad, porque aceptaría como
 * válido algo que el paciente nunca quiso decir. Aquí, o está el año completo,
 * o no hay fecha.
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

/* ── Los textos, en español de México y cortos ────────────────────────────
   Los lee un paciente en el teléfono, no un dentista: sin tecnicismos, sin
   «verificación de identidad» ni «registro no encontrado». Y NUNCA se dice si
   el teléfono está o no registrado: eso ya sería información de quién es
   paciente de la clínica. Todo lo que no se puede contestar termina igual —
   «escríbenos y te ayudamos»— para que las respuestas no se puedan comparar
   entre sí y delaten quién existe.                                          */

export const TEXTOS = {
  pideFecha:
    "Con gusto te digo. Para confirmar que eres tú, respóndeme tu *fecha de nacimiento* " +
    "(por ejemplo: 15/03/1990).",
  noCuadra:
    "Esa fecha no me coincide. Inténtalo una vez más, por favor: tu *fecha de nacimiento* " +
    "en formato día/mes/año.",
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
 * preguntando por dinero y no hay verificación a medias): el motor sigue con
 * FAQ, agenda e IA exactamente como hoy.
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

  const enCurso = leerEstado(input.botState);
  const texto = (input.incomingText ?? "").trim();

  // 2. ¿Va conmigo? O hay una verificación a medias, o están preguntando.
  if (!enCurso && !detectaIntencionDeSaldo(texto)) return null;

  const telefono = (input.patient?.phone ?? "").trim();
  const clinicId = input.clinicId;
  // (c) de la casa: sin clinicId no se consulta.
  if (!clinicId || !telefono) {
    return derivar(deps, clinicId, input, null, telefono, "pacienteNoEncontrado");
  }

  // 3. ¿Ya gastó sus intentos HOY? Se comprueba lo primero y sobre el rastro
  //    escrito, no sobre la sesión: si no, esperar a que caduque el estado
  //    sería un modo gratis de volver a empezar.
  const fallosPrevios = await deps.fallosRecientes(clinicId, input.threadId);
  if (fallosPrevios >= MAX_INTENTOS) {
    return derivar(deps, clinicId, input, enCurso?.patientId || null, telefono, "verificacionAgotada");
  }

  const pacientes = await deps.buscarPacientesPorTelefono(clinicId, telefono);
  // Un solo paciente, vivo y con fecha de nacimiento en el expediente: es el
  // único caso en el que se puede llegar a contestar algo.
  const unico = pacientes.length === 1 && pacientes[0].dob ? pacientes[0] : null;

  // ── Verificación a medias: lo que llega es (o debería ser) la fecha ──────
  if (enCurso) {
    // Cuadra solo si sigue habiendo UN paciente, es el MISMO del que se partió
    // y la fecha es la suya. Cualquier otra cosa es un intento fallido.
    const fecha = parseFechaNacimiento(texto);
    const mismo = unico !== null && (!enCurso.patientId || unico.id === enCurso.patientId);
    if (mismo && fecha && fecha === unico!.dob) {
      return await contesta(deps, clinicId, input, unico!, telefono);
    }

    // Por qué falló, para el rastro de la clínica. El paciente ve lo mismo en
    // todos los casos: si cada motivo tuviera su texto, comparar respuestas
    // diría si un número es de un paciente, de dos o de ninguno.
    const motivo: ResultadoConsulta =
      pacientes.length > 1
        ? "telefonoCompartido"
        : pacientes.length === 0
          ? "pacienteNoEncontrado"
          : unico === null
            ? "sinFechaDeNacimiento"
            : "verificacionFallida";

    const fallos = fallosPrevios + 1;
    if (fallos >= MAX_INTENTOS) {
      // Agotado: aquí SÍ se deriva de verdad y el hilo pasa a una persona.
      return derivar(deps, clinicId, input, unico?.id ?? null, telefono, "verificacionAgotada");
    }
    await deps.registrarConsulta({
      clinicId, threadId: input.threadId, patientId: unico?.id ?? null, telefono,
      resultado: motivo,
    });
    return {
      reply: TEXTOS.noCuadra,
      intent: BotIntent.UNKNOWN,
      newBotState: { ...enCurso, intentos: fallos, updatedAt: Date.now() } as unknown as BotJson,
    };
  }

  // ── Primera vez: se pide el segundo dato, SIEMPRE ────────────────────────
  //
  // Y se pide aunque ese número no sea de ningún paciente, o sea de tres. Si
  // el bot contestara «esto lo ve una persona» solo en esos casos, cualquiera
  // averiguaría con UN mensaje si el número que acaba de heredar pertenece a
  // un paciente de la clínica. Pidiendo siempre lo mismo, quien pregunta no
  // aprende nada: un número sin paciente, sencillamente, nunca acierta.
  await deps.registrarConsulta({
    clinicId, threadId: input.threadId, patientId: unico?.id ?? null, telefono,
    resultado: "verificacionPedida",
  });
  return {
    reply: TEXTOS.pideFecha,
    intent: BotIntent.UNKNOWN,
    newBotState: {
      flow: "saldo",
      patientId: unico?.id ?? "",
      intentos: fallosPrevios,
      updatedAt: Date.now(),
    } as unknown as BotJson,
  };
}

/** Cuadró la fecha: se contesta lo mínimo y queda el rastro del acceso. */
async function contesta(
  deps: SaldoDeps,
  clinicId: string,
  input: BotTurnInput,
  paciente: PacienteSaldo,
  telefono: string,
): Promise<BotTurnResult> {
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
    // Se limpia el estado: la siguiente pregunta vuelve a verificar desde cero.
    newBotState: null,
  };
}

/**
 * Todo lo que no se puede contestar sale por aquí, y SIEMPRE con el mismo
 * texto: quien pregunta no puede distinguir «no eres paciente» de «fallaste la
 * fecha» de «ese número es de dos personas». Si cada caso tuviera su mensaje,
 * el bot contestaría a ciegas preguntas que nadie le hizo.
 *
 * ⚠️ `handoff` apaga el bot en el hilo (`botActive = false` en el webhook) y no
 * vuelve solo: hasta que alguien lo reactive a mano, ese paciente se queda sin
 * FAQ y sin poder agendar. Eso es lo que se quiere cuando alguien agotó sus
 * intentos de verificación —ahí queremos a una persona mirando—, pero sería un
 * castigo absurdo para la mamá que pregunta por el saldo desde el teléfono que
 * comparte con sus hijos, que es el caso NORMAL. Por eso solo se apaga el bot
 * en `verificacionAgotada`.
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
  const apagarElBot = resultado === "verificacionAgotada";
  return {
    reply: TEXTOS.derivar,
    intent: apagarElBot ? BotIntent.HANDOFF : BotIntent.UNKNOWN,
    ...(apagarElBot ? { handoff: true } : {}),
    newBotState: null,
  };
}
