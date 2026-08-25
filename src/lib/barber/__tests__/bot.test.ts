/**
 * DaleControl BARBER — pruebas OFFLINE del bot que agenda.
 *
 * Run (sin BD, sin red, sin Anthropic):
 *   npx tsx --test src/lib/barber/__tests__/bot.test.ts
 *
 * Qué fijan estas pruebas — todas salen de algo que, si se rompe, le cuesta
 * dinero o clientes a una barbería de verdad:
 *
 *  1. El bot NACE APAGADO y una configuración corrupta lo deja apagado. Un
 *     bot que se enciende solo contesta en nombre de alguien que no lo pidió.
 *  2. El tope de gasto de IA no se puede burlar desde el navegador ni se
 *     regala por redondeo, y un modelo desconocido se cobra al precio más
 *     caro (frenar de más es mejor que gastar de más).
 *  3. "Quiero hablar con una persona" se detecta ANTES de gastar en IA, y
 *     "quiero un corte con Pedro" NO se confunde con eso.
 *  4. 🔴 ARQUITECTURA: el bot no tiene forma de inventar disponibilidad ni
 *     de crear una cita por su cuenta. Se verifica leyendo el código: los
 *     huecos solo salen del motor de agenda y la cita solo la crea
 *     createPublicBooking (candado + recálculo dentro de la transacción).
 *  5. El bot jamás manda plantillas de marketing: dentro de la ventana de
 *     24 h todo va como texto de servicio, que es gratis.
 *  6. Terminología del vertical: cero "paciente", "doctor", "clínica"…
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BARBER_BOT_AI_CAP_DEFAULT,
  BARBER_BOT_AI_CAP_MAX,
  DEFAULT_BARBER_BOT_SETTINGS,
  MICROS_PER_MXN,
  asksForHuman,
  botAnswersNow,
  botModelPrice,
  botTurnCostMicros,
  normalizeBotSettings,
  quotaIsTight,
} from "../bot-core";

const ROOT = join(__dirname, "..", "..", "..", "..");
const BOT_TS = readFileSync(join(ROOT, "src", "lib", "barber", "bot.ts"), "utf8");
const BOT_CORE_TS = readFileSync(join(ROOT, "src", "lib", "barber", "bot-core.ts"), "utf8");

/* ═══════════════ 1. Nace apagado y aguanta basura ═══════════════ */

test("el bot nace APAGADO", () => {
  assert.equal(DEFAULT_BARBER_BOT_SETTINGS.enabled, false);
  assert.equal(normalizeBotSettings(null).enabled, false);
  assert.equal(normalizeBotSettings({}).enabled, false);
  // Solo un true explícito lo enciende: ni "true", ni 1, ni "on".
  assert.equal(normalizeBotSettings({ enabled: "true" }).enabled, false);
  assert.equal(normalizeBotSettings({ enabled: 1 }).enabled, false);
  assert.equal(normalizeBotSettings({ enabled: true }).enabled, true);
});

test("una configuración corrupta cae a los defaults sin lanzar", () => {
  for (const raw of [undefined, null, 0, "", "texto", [], [1, 2], true, NaN]) {
    const s = normalizeBotSettings(raw);
    assert.equal(s.enabled, false);
    assert.equal(s.tone, "relajado");
    assert.equal(s.aiDailyCapMxn, BARBER_BOT_AI_CAP_DEFAULT);
  }
});

test("un tono inventado no llega a la base", () => {
  assert.equal(normalizeBotSettings({ tone: "pirata" }).tone, "relajado");
  assert.equal(normalizeBotSettings({ tone: "formal" }).tone, "formal");
});

test("mover una cita sin poder agendar no significa nada: se apaga solo", () => {
  const s = normalizeBotSettings({
    abilities: { agendar: false, reagendar: true, cancelar: true },
  });
  assert.equal(s.abilities.agendar, false);
  assert.equal(s.abilities.reagendar, false);
  // Cancelar SÍ sobrevive: no depende de agendar.
  assert.equal(s.abilities.cancelar, true);
});

test("una ventana invertida no deja al bot mudo todo el día", () => {
  // 21:00 → 09:00 no es "de noche": es una ventana vacía. Se corrige a
  // "hasta el final del día" en vez de dejar un bot que no contesta nunca.
  const s = normalizeBotSettings({
    hours: { mode: "custom", startMinute: 21 * 60, endMinute: 9 * 60, days: [1] },
  });
  assert.equal(s.hours.startMinute, 21 * 60);
  assert.equal(s.hours.endMinute, 1440);
  assert.ok(botAnswersNow(s.hours, 1, 22 * 60));
});

test("los días se limpian: nada de 9 ni de duplicados", () => {
  const s = normalizeBotSettings({
    hours: { mode: "custom", days: [1, 1, 9, -3, 6, "2"] },
  });
  assert.deepEqual(s.hours.days, [1, 2, 6]);
});

/* ═══════════════ 2. Horario en el que contesta ═══════════════ */

test("modo 'always' contesta cualquier día y a cualquier hora", () => {
  const hours = { mode: "always" as const, startMinute: 600, endMinute: 700, days: [] };
  assert.ok(botAnswersNow(hours, 0, 0));
  assert.ok(botAnswersNow(hours, 3, 23 * 60 + 59));
});

test("modo 'custom' respeta la ventana y los días", () => {
  const hours = {
    mode: "custom" as const,
    startMinute: 10 * 60,
    endMinute: 20 * 60,
    days: [1, 2, 3, 4, 5],
  };
  assert.ok(botAnswersNow(hours, 3, 10 * 60), "el inicio SÍ entra");
  assert.ok(botAnswersNow(hours, 3, 19 * 60 + 59));
  assert.ok(!botAnswersNow(hours, 3, 20 * 60), "el fin NO entra");
  assert.ok(!botAnswersNow(hours, 3, 9 * 60 + 59));
  assert.ok(!botAnswersNow(hours, 0, 12 * 60), "domingo no está en la lista");
});

test("sin días marcados el bot no contesta nunca (y la pantalla avisa)", () => {
  const hours = { mode: "custom" as const, startMinute: 0, endMinute: 1440, days: [] };
  for (let d = 0; d < 7; d++) assert.ok(!botAnswersNow(hours, d, 12 * 60));
});

/* ═══════════════ 3. Pasar con una persona ═══════════════ */

test("se detecta a quien pide una persona", () => {
  const si = [
    "quiero hablar con una persona",
    "Me pueden comunicar con un humano?",
    "pasame con alguien",
    "quiero hablar con el barbero",
    "necesito una persona real",
    "no quiero hablar con un bot",
    "eres un robot?",
    "quiero hablar con el dueño",
    "atención a clientes por favor",
  ];
  for (const t of si) assert.ok(asksForHuman(t), `debió detectarse: ${t}`);
});

test("pedir una cita NO se confunde con pedir una persona", () => {
  // Este es el falso positivo caro: cada uno de estos mandaría a un cliente
  // que solo quería cortarse el pelo a una cola de espera humana.
  const no = [
    "quiero un corte",
    "quiero corte el sábado en la tarde",
    "cuánto cuesta el corte con Pedro",
    "me agendas con Luis el barbero mañana",
    "hola buenas tardes",
    "a qué hora abren",
    "quiero cita para barba",
    "",
    "   ",
  ];
  for (const t of no) assert.ok(!asksForHuman(t), `NO debió detectarse: ${t}`);
});

/* ═══════════════ 4. El tope de gasto de IA ═══════════════ */

test("el tope se recorta a un rango sensato venga de donde venga", () => {
  assert.equal(normalizeBotSettings({ aiDailyCapMxn: -50 }).aiDailyCapMxn, 0);
  assert.equal(normalizeBotSettings({ aiDailyCapMxn: 999999 }).aiDailyCapMxn, BARBER_BOT_AI_CAP_MAX);
  assert.equal(normalizeBotSettings({ aiDailyCapMxn: "31" }).aiDailyCapMxn, 31);
  assert.equal(normalizeBotSettings({ aiDailyCapMxn: NaN }).aiDailyCapMxn, BARBER_BOT_AI_CAP_DEFAULT);
});

test("un modelo desconocido se cobra al precio MÁS CARO", () => {
  const caro = botModelPrice("modelo-que-no-existe");
  const opus = botModelPrice("claude-opus-5");
  assert.equal(caro.inputPerMTokUsd, opus.inputPerMTokUsd);
  assert.equal(caro.outputPerMTokUsd, opus.outputPerMTokUsd);
});

test("el costo se redondea HACIA ARRIBA: mil turnos no regalan el tope", () => {
  // Un turno diminuto no puede costar 0: si costara, un cliente insistente
  // haría infinitos turnos gratis y el tope no protegería de nada.
  const micros = botTurnCostMicros({
    model: "claude-sonnet-4-6",
    inputTokens: 1,
    outputTokens: 0,
    usdMxn: 18,
  });
  assert.ok(micros >= 1, "un turno con tokens SIEMPRE cuesta al menos 1 micro");
});

test("el costo crece con los tokens y usa la tarifa del modelo", () => {
  const base = { inputTokens: 100_000, outputTokens: 10_000, usdMxn: 18 };
  const haiku = botTurnCostMicros({ ...base, model: "claude-haiku-4-5" });
  const sonnet = botTurnCostMicros({ ...base, model: "claude-sonnet-4-6" });
  const opus = botTurnCostMicros({ ...base, model: "claude-opus-5" });
  assert.ok(haiku < sonnet && sonnet < opus, "más caro el modelo, más caro el turno");

  // 1M de entrada en sonnet ($3/MTok) a 18 MXN/USD = 54 pesos.
  const unMillon = botTurnCostMicros({
    model: "claude-sonnet-4-6",
    inputTokens: 1_000_000,
    outputTokens: 0,
    usdMxn: 18,
  });
  assert.equal(unMillon, 54 * MICROS_PER_MXN);
});

test("un tipo de cambio inválido cae al de referencia en vez de cobrar 0", () => {
  const malo = botTurnCostMicros({
    model: "claude-sonnet-4-6",
    inputTokens: 1_000_000,
    outputTokens: 0,
    usdMxn: 0,
  });
  assert.ok(malo > 0, "un usdMxn de 0 no puede volver la IA gratis");
});

/* ═══════════════ 5. Cupo de mensajes ═══════════════ */

test("el cupo ilimitado (-1) nunca se marca como apretado", () => {
  assert.equal(quotaIsTight(999_999, -1), false);
});

test("el cupo avisa ANTES de acabarse, no cuando ya se acabó", () => {
  assert.equal(quotaIsTight(0, 200), false);
  assert.equal(quotaIsTight(169, 200), false);
  assert.equal(quotaIsTight(170, 200), true, "al 85% ya se avisa");
  assert.equal(quotaIsTight(200, 200), true);
  // Un plan con cupo 0 está apretado por definición.
  assert.equal(quotaIsTight(0, 0), true);
});

/* ═══════════════ 6. 🔴 El bot NO puede inventar disponibilidad ═══════════════ */

test("los huecos SOLO salen del motor de agenda", () => {
  // Si alguien mete aquí un cálculo de horarios propio, esta prueba truena.
  assert.ok(
    BOT_TS.includes("getPublicSlots"),
    "el bot tiene que preguntarle los huecos a booking.ts",
  );
  assert.ok(BOT_TS.includes("getOpenDays"), "y los días abiertos también");
  assert.ok(
    !/barberSchedule\.findMany[\s\S]{0,400}slot/i.test(BOT_TS),
    "el bot no arma su propia rejilla de huecos",
  );
});

test("la cita SOLO la crea createPublicBooking (candado + recálculo)", () => {
  assert.ok(BOT_TS.includes("createPublicBooking"), "tiene que usar el creador del contrato");
  assert.ok(
    !BOT_TS.includes("barberAppointment.create"),
    "el bot NUNCA inserta una cita por su cuenta: se saltaría el candado por día " +
      "y el recálculo dentro de la transacción, que es lo único que impide un empalme",
  );
});

test("reagendar toma el mismo candado por día que la reserva pública", () => {
  assert.ok(
    BOT_TS.includes("pg_advisory_xact_lock"),
    "mover una cita compite por el hueco igual que crearla",
  );
  assert.ok(
    BOT_TS.includes("advisoryLockKey(`barber:booking:"),
    "y tiene que ser LA MISMA llave que usa createPublicBooking, o no se serializan entre sí",
  );
});

test("la cita del bot queda marcada como del canal WHATSAPP", () => {
  assert.ok(/source:\s*"WHATSAPP"/.test(BOT_TS));
});

/* ═══════════════ 7. Nada de plantillas de marketing ═══════════════ */

test("el bot no manda plantillas: dentro de las 24 h todo es texto gratis", () => {
  for (const prohibido of ["sendTemplate", "MARKETING", "provisionBarberTemplates"]) {
    assert.ok(
      !BOT_TS.includes(prohibido),
      `el bot no puede usar ${prohibido}: conversar se hace con texto de servicio`,
    );
  }
});

test("el bot no manda nada por su cuenta: devuelve el texto y lo manda whatsapp.ts", () => {
  assert.ok(
    !BOT_TS.includes("api.whatsapp.com") && !BOT_TS.includes("/messages`"),
    "el transporte es de whatsapp.ts; el bot solo decide QUÉ decir",
  );
});

/* ═══════════════ 8. Aislamiento e inquilino ═══════════════ */

test("toda consulta del bot filtra por barbershopId", () => {
  // Un `barbershopId: undefined` en Prisma BORRA el filtro de inquilino y
  // deja leer la agenda de otra barbería. requireShop corta antes.
  assert.ok(BOT_TS.includes("function requireShop"));

  const re = /prisma\.(\w+)\.(?:findMany|findFirst|findUnique|count)\(/g;
  const fugas: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(BOT_TS)) !== null) {
    const modelo = m[1];
    const cabeza = BOT_TS.slice(m.index + m[0].length, m.index + m[0].length + 320);
    // En barber_shops el inquilino ES el id de la fila; en todo lo demás
    // hace falta barbershopId explícito (un undefined ahí borra el filtro).
    const ok = modelo === "barbershop" ? /where:\s*\{\s*id:/.test(cabeza) : cabeza.includes("barbershopId");
    if (!ok) fugas.push(`${modelo} (car. ${m.index})`);
  }
  assert.ok(re.lastIndex === 0, "el regex global queda limpio");
  assert.deepEqual(fugas, [], "hay consultas sin filtro de inquilino");
});

test("el bot es del plan Profesional y el candado está en el servidor", () => {
  assert.ok(BOT_TS.includes('barberPlanHasFeature(plan, "whatsappBot")'));
  const api = readFileSync(join(ROOT, "src", "app", "api", "barber", "bot", "route.ts"), "utf8");
  assert.ok(api.includes('"whatsappBot"'), "la API también valida el plan");
  assert.ok(api.includes("openWaGate"), "y pasa por la puerta común del vertical");
});

/* ═══════════════ 9. Terminología del vertical ═══════════════ */

test("cero vocabulario del dental en el bot", () => {
  const prohibidas = [
    /\bpacientes?\b/i,
    /\bdoctor(a|es)?\b/i,
    /\bDr\./,
    /\bcl[ií]nicas?\b/i,
    /\bexpedientes?\b/i,
    /\bodont[oó]log/i,
    /\bconsultorio/i,
  ];
  const archivos: [string, string][] = [
    ["bot.ts", BOT_TS],
    ["bot-core.ts", BOT_CORE_TS],
    [
      "bot-screen.tsx",
      readFileSync(join(ROOT, "src", "components", "barber", "bot", "bot-screen.tsx"), "utf8"),
    ],
    [
      "bot.es.json",
      readFileSync(join(ROOT, "src", "i18n", "dictionaries", "barber", "bot.es.json"), "utf8"),
    ],
    [
      "bot.en.json",
      readFileSync(join(ROOT, "src", "i18n", "dictionaries", "barber", "bot.en.json"), "utf8"),
    ],
    ["barber_bot.sql", readFileSync(join(ROOT, "sql", "barber_bot.sql"), "utf8")],
  ];

  for (const [nombre, contenido] of archivos) {
    for (const re of prohibidas) {
      const hit = contenido.match(re);
      assert.equal(hit ? hit[0] : null, null, `${nombre} usa vocabulario del dental`);
    }
  }
});

test("el bot habla de tú y nunca vosea", () => {
  // El voseo argentino en un WhatsApp mexicano suena a estafa. La ÚNICA
  // línea donde pueden aparecer esas formas es la que se las prohíbe al
  // modelo; se quita antes de buscar, o la regla se delataría a sí misma.
  const sinLaRegla = BOT_TS.split(/\r?\n/)
    .filter((l) => !/nada de voseo/i.test(l))
    .join("\n");
  for (const re of [/\btenés\b/i, /\bpodés\b/i, /\bquerés\b/i, /\bsos\b/i, /\bvos\b/i]) {
    const hit = sinLaRegla.match(re);
    // Se afirma sobre el texto encontrado, no sobre el match: si truena,
    // el mensaje cabe en la pantalla en vez de volcar el archivo entero.
    assert.equal(hit ? hit[0] : null, null, `el prompt no puede vosear: ${re}`);
  }
  assert.ok(BOT_TS.includes("tuteando"), "el prompt lo dice explícitamente");
  assert.ok(/nada de voseo/i.test(BOT_TS), "y se lo prohíbe al modelo con ejemplos");
});
