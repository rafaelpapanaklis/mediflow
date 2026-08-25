// Integración del BOT contra Postgres REAL.
//
// Lo que esta ola promete no se puede fingir con mocks: "el bot nunca
// inventa un hueco" y "dos clientes no se llevan el mismo horario" son
// garantías de la BASE DE DATOS (candado por día + recálculo dentro de la
// transacción + la constraint EXCLUDE de T1). Por eso esto corre contra
// Postgres de verdad.
//
// El MODELO sí va guionado: se intercepta fetch y se le contesta con turnos
// preparados. Así la prueba es determinista y no gasta un peso de IA — pero
// TODO lo que el "modelo" ve (precios, horarios, resultados) sale de la base
// real, que es justo lo que hay que verificar.
//
//   docker run -d --name barber-bot-pg -e POSTGRES_USER=barber \
//     -e POSTGRES_PASSWORD=barber -e POSTGRES_DB=barberbot \
//     -p 54337:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://barber:barber@localhost:54337/barberbot \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   psql ... -f sql/barber_agenda.sql -f sql/barber_bot.sql
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test \
//     src/lib/barber/__tests__/bot-integration.test.ts
//
// Sin DATABASE_URL se SALTAN (no fallan). JAMÁS apuntarlas a producción:
// crean y borran barberías.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  getBarberBotSettings,
  listBarberBotBookings,
  listBarberBotPauses,
  resumeBarberBotThread,
  runBarberBotTurn,
  saveBarberBotSettings,
} from "../bot";
import { getPublicSlots } from "../booking";
import { barberTodayISO, addIsoDays, parseHhMm } from "../booking-core";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const RUN = `bot${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";

/* ═══════════════ El modelo guionado ═══════════════ */

interface CannedBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Un turno del "modelo": o pide herramientas, o contesta. */
type Canned = CannedBlock[] | ((seen: unknown[]) => CannedBlock[]);

let queue: Canned[] = [];
/** Todo lo que el bot le mandó al modelo (para inspeccionar el prompt). */
let requests: { system: string; messages: any[] }[] = [];
/** Resultados de herramienta que el modelo recibió, ya parseados. */
let toolResults: any[] = [];
let modelCalls = 0;

/**
 * Guion POR CONVERSACIÓN. Cuando dos clientes hablan A LA VEZ, una sola
 * cola compartida hace que un turno se robe los pasos del otro y la
 * prueba acabe midiendo el guion en vez de la base de datos. La llave es
 * un texto que aparece en el hilo de ese cliente (p.ej. "soy Luis").
 */
const scripts = new Map<string, { queue: Canned[]; results: any[] }>();

function scriptFor(key: string) {
  const found = scripts.get(key);
  if (found) return found;
  const fresh = { queue: [] as Canned[], results: [] as any[] };
  scripts.set(key, fresh);
  return fresh;
}

/** ¿A qué conversación pertenece esta petición? */
function keyOf(messages: any[]): string | null {
  const hilo = JSON.stringify(messages ?? []);
  // Array.from: el target de TS del repo no itera un MapIterator directo.
  for (const k of Array.from(scripts.keys())) if (hilo.includes(k)) return k;
  return null;
}

const realFetch = globalThis.fetch;

function installScriptedModel() {
  globalThis.fetch = (async (url: any, init: any) => {
    const href = String(url);
    if (!href.includes("api.anthropic.com")) return realFetch(url, init);

    modelCalls++;
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ system: body.system, messages: body.messages });

    // Cada conversación tiene su cola y sus resultados; sin guion por
    // llave se usa la cola global (los tests secuenciales).
    const key = keyOf(body.messages);
    const sink = key ? scriptFor(key) : { queue, results: toolResults };

    // Se guardan los tool_result que llegan, para poder afirmar sobre los
    // datos REALES que el modelo vio (huecos, precios, errores).
    for (const m of body.messages ?? []) {
      if (m.role !== "user" || !Array.isArray(m.content)) continue;
      for (const c of m.content) {
        if (c?.type === "tool_result") {
          try {
            sink.results.push(JSON.parse(c.content));
          } catch {
            sink.results.push(c.content);
          }
        }
      }
    }

    const next = sink.queue.shift();
    const blocks: CannedBlock[] = !next
      ? [{ type: "text", text: "Ahí te va." }]
      : typeof next === "function"
        ? next(sink.results)
        : next;

    const usesTools = blocks.some((b) => b.type === "tool_use");
    return new Response(
      JSON.stringify({
        content: blocks,
        stop_reason: usesTools ? "tool_use" : "end_turn",
        usage: { input_tokens: 900, output_tokens: 90 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}

function say(text: string): CannedBlock[] {
  return [{ type: "text", text }];
}
let toolSeq = 0;
function useTool(name: string, input: Record<string, unknown>): CannedBlock[] {
  return [{ type: "tool_use", id: `tu_${++toolSeq}`, name, input }];
}

function resetScript() {
  queue = [];
  requests = [];
  toolResults = [];
  modelCalls = 0;
  scripts.clear();
}

/** El último resultado de la herramienta `name` que vio el modelo. */
function lastResultWith(key: string): any {
  for (let i = toolResults.length - 1; i >= 0; i--) {
    if (toolResults[i] && typeof toolResults[i] === "object" && key in toolResults[i]) {
      return toolResults[i];
    }
  }
  return null;
}

/* ═══════════════ Semilla ═══════════════ */

interface Shop {
  id: string;
  barberId: string;
  corteId: string;
  barbaId: string;
}

const shops: Record<"A" | "B", Shop> = {} as any;
/** Sábado próximo, en la zona de la barbería. */
let SAT = "";
/** El transcript que se pega en el reporte. */
const dialogo: string[] = [];

function log(quien: string, texto: string) {
  dialogo.push(`${quien}: ${texto}`);
}

async function makeShop(tag: "A" | "B", plan: string): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbería ${tag}`,
      slug: `${RUN}-${tag.toLowerCase()}`,
      plan: plan as never,
      subscriptionStatus: "active",
      timezone: TZ,
    },
  });
  const barber = await prisma.barber.create({
    data: { barbershopId: shop.id, name: tag === "A" ? "Beto" : "Otro", isActive: true },
  });
  const corte = await prisma.barberService.create({
    data: {
      barbershopId: shop.id,
      name: tag === "A" ? "Corte de caballero" : "Corte B",
      durationMin: 30,
      price: tag === "A" ? 180 : 999,
      isActive: true,
    },
  });
  const barba = await prisma.barberService.create({
    data: {
      barbershopId: shop.id,
      name: "Barba",
      durationMin: 20,
      price: tag === "A" ? 120 : 888,
      isActive: true,
    },
  });

  // Beto trabaja SOLO por la tarde: 16:00 a 20:00. Es lo que permite probar
  // que el bot jamás ofrece un hueco fuera del horario del barbero.
  for (let d = 0; d < 7; d++) {
    await prisma.barberSchedule.create({
      data: {
        barbershopId: shop.id,
        barberId: barber.id,
        dayOfWeek: d,
        startMinute: 16 * 60,
        endMinute: 20 * 60,
        isActive: true,
      },
    });
  }

  return { id: shop.id, barberId: barber.id, corteId: corte.id, barbaId: barba.id };
}

before(async () => {
  if (!HAS_DB) return;
  process.env.BARBER_ANTHROPIC_API_KEY = "sk-test-guionado";
  installScriptedModel();

  shops.A = await makeShop("A", "PROFESIONAL");
  shops.B = await makeShop("B", "AVANZADO");

  const today = barberTodayISO(TZ);
  // El sábado que viene (nunca hoy: así el margen de 30 min no estorba).
  for (let i = 1; i <= 7; i++) {
    const d = addIsoDays(today, i);
    const [y, m, dd] = d.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() === 6) {
      SAT = d;
      break;
    }
  }

  await saveBarberBotSettings(shops.A.id, {
    enabled: true,
    tone: "relajado",
    aiDailyCapMxn: 50,
    hours: { mode: "always" },
  });
  await saveBarberBotSettings(shops.B.id, { enabled: true, aiDailyCapMxn: 50 });
});

after(async () => {
  globalThis.fetch = realFetch;
  if (!HAS_DB) return;
  for (const s of [shops.A, shops.B]) {
    if (!s) continue;
    await prisma.barberMessage.deleteMany({ where: { barbershopId: s.id } });
    await prisma.barberAppointmentService.deleteMany({
      where: { appointment: { barbershopId: s.id } },
    });
    await prisma.barberAppointment.deleteMany({ where: { barbershopId: s.id } });
    await prisma.barberSchedule.deleteMany({ where: { barbershopId: s.id } });
    await prisma.barberService.deleteMany({ where: { barbershopId: s.id } });
    await prisma.barberClient.deleteMany({ where: { barbershopId: s.id } });
    await prisma.barber.deleteMany({ where: { barbershopId: s.id } });
    await prisma.$executeRawUnsafe(
      `DELETE FROM "barber_bot_settings" WHERE "barbershopId" = '${s.id}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "barber_bot_usage" WHERE "barbershopId" = '${s.id}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "barber_bot_pauses" WHERE "barbershopId" = '${s.id}'`,
    );
    await prisma.barbershop.delete({ where: { id: s.id } });
  }
  await prisma.$disconnect();

  console.log("\n════════ TRANSCRIPT ════════");
  console.log(dialogo.join("\n"));
  console.log("════════════════════════════\n");
});

/** Simula que el cliente escribió: deja el INBOUND como lo haría el webhook. */
async function clienteEscribe(shopId: string, phone: string, texto: string) {
  await prisma.barberMessage.create({
    data: { barbershopId: shopId, direction: "INBOUND", phone, body: texto, status: "DELIVERED" },
  });
}

/** Un turno completo: entra el mensaje, sale la respuesta (y se registra). */
async function turno(shopId: string, phone: string, texto: string) {
  await clienteEscribe(shopId, phone, texto);
  const out = await runBarberBotTurn({ barbershopId: shopId, phone, text: texto });
  if (out.reply) {
    await prisma.barberMessage.create({
      data: { barbershopId: shopId, direction: "OUTBOUND", phone, body: out.reply, status: "SENT" },
    });
  }
  return out;
}

/* ═══════════════ 1. Agendar de cero ═══════════════ */

test("agenda una cita de cero, con precios y horarios REALES", { skip }, async () => {
  resetScript();
  const phone = "5511110001";

  // Turno 1: el modelo pregunta el catálogo y luego los huecos del sábado.
  queue.push(useTool("listar_servicios", {}));
  queue.push(() => useTool("buscar_horarios", { fecha: SAT, servicioIds: [shops.A.corteId] }));
  queue.push((seen) => {
    const h = (seen[seen.length - 1] as any)?.horarios ?? [];
    return say(
      `Va. Para el sábado en la tarde tengo ${h
        .slice(0, 3)
        .map((x: any) => x.comoSeDice)
        .join(", ")}. ¿Cuál te late?`,
    );
  });

  log("Cliente", "hola, quiero corte el sábado en la tarde");
  const r1 = await turno(shops.A.id, phone, "hola, quiero corte el sábado en la tarde");
  log("Bot", r1.reply ?? "(sin respuesta)");
  assert.ok(r1.reply, "el bot contestó");

  // Los servicios que vio el modelo son los de la BASE, con su precio real.
  const catalogo = lastResultWith("servicios");
  assert.ok(catalogo, "el modelo consultó el catálogo");
  const corte = catalogo.servicios.find((s: any) => s.id === shops.A.corteId);
  assert.equal(corte.precio, "$180", "el precio sale de BarberService, no del modelo");

  // 🔴 Los huecos ofrecidos son EXACTAMENTE los que da el motor de agenda.
  const huecos = lastResultWith("horarios");
  const reales = await getPublicSlots({
    shop: { id: shops.A.id, timezone: TZ },
    dateISO: SAT,
    durationMin: 30,
    barberId: null,
  });
  assert.deepEqual(
    huecos.horarios.map((h: any) => h.hora),
    reales.map((s) => s.time),
    "el bot ofrece los huecos del motor, ni uno más",
  );
  assert.ok(huecos.horarios.length > 0, "el sábado tiene huecos");

  // Turno 2: el cliente elige y el modelo agenda.
  const elegida = huecos.horarios[0].hora;
  queue.push(
    useTool("agendar", {
      fecha: SAT,
      hora: elegida,
      servicioIds: [shops.A.corteId],
      nombre: "Rafa",
    }),
  );
  queue.push((seen) => {
    const r = seen[seen.length - 1] as any;
    return say(
      `Listo Rafa. Quedas el ${r.fechaBonita} a las ${r.horaBonita} con ${r.barbero}. ` +
        `${r.aclaracion} Tu folio es ${r.referencia}.`,
    );
  });

  log("Cliente", `${huecos.horarios[0].comoSeDice} está bien, soy Rafa`);
  const r2 = await turno(shops.A.id, phone, `${huecos.horarios[0].comoSeDice} está bien, soy Rafa`);
  log("Bot", r2.reply ?? "(sin respuesta)");

  assert.equal(r2.effects.booked.length, 1, "se creó UNA cita");

  const cita = await prisma.barberAppointment.findFirst({
    where: { barbershopId: shops.A.id, clientPhone: phone },
    include: { services: true },
  });
  assert.ok(cita, "la cita existe en la base");
  assert.equal(cita.source, "WHATSAPP", "queda marcada como del canal WhatsApp");
  assert.equal(cita.clientName, "Rafa");
  assert.equal(Number(cita.services[0].priceAtBooking), 180);

  // El historial del panel la ve.
  const historial = await listBarberBotBookings(shops.A.id);
  assert.equal(historial.length, 1);
  assert.equal(historial[0].total, 180);
});

/* ═══════════════ 2. El horario del barbero se respeta ═══════════════ */

test("no ofrece un hueco fuera del horario ni encimado", { skip }, async () => {
  resetScript();
  const slots = await getPublicSlots({
    shop: { id: shops.A.id, timezone: TZ },
    dateISO: SAT,
    durationMin: 30,
    barberId: null,
  });

  // Beto trabaja 16:00-20:00. Ni un hueco antes, y ninguno que se pase de
  // las 20:00 contando la duración del servicio.
  for (const s of slots) {
    const min = parseHhMm(s.time)!;
    assert.ok(min >= 16 * 60, `${s.time} es antes de que entre el barbero`);
    assert.ok(min + 30 <= 20 * 60, `${s.time} termina después de que se va`);
  }

  // Y el hueco ya tomado por la cita del test 1 desapareció.
  const tomada = await prisma.barberAppointment.findFirst({
    where: { barbershopId: shops.A.id, source: "WHATSAPP" },
    select: { startAt: true },
  });
  const tomadaHHMM = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(tomada!.startAt);
  assert.ok(
    !slots.some((s) => s.time === tomadaHHMM),
    `el hueco ${tomadaHHMM} ya está ocupado y no se vuelve a ofrecer`,
  );
});

/* ═══════════════ 3. Consultar precio ═══════════════ */

test("el precio que dice es el de BarberService", { skip }, async () => {
  resetScript();
  const phone = "5511110002";
  queue.push(useTool("listar_servicios", {}));
  queue.push((seen) => {
    const c = seen[seen.length - 1] as any;
    const barba = c.servicios.find((s: any) => s.nombre === "Barba");
    return say(`La barba te sale en ${barba.precio} y nos lleva ${barba.duracionMin} minutos.`);
  });

  log("Cliente", "cuánto cuesta la barba?");
  const r = await turno(shops.A.id, phone, "cuánto cuesta la barba?");
  log("Bot", r.reply ?? "(sin respuesta)");

  assert.match(r.reply!, /\$120/, "dice el precio real de la base");
  assert.ok(!/\$888/.test(r.reply!), "y JAMÁS el de la otra barbería");
});

/* ═══════════════ 4. Reagendar y cancelar ═══════════════ */

test("mueve la cita del cliente a otro horario real", { skip }, async () => {
  resetScript();
  const phone = "5511110001";

  queue.push(useTool("mis_citas", {}));
  queue.push((seen) => {
    const c = (seen[seen.length - 1] as any).citas[0];
    return useTool("buscar_horarios", { fecha: SAT, servicioIds: [shops.A.corteId] });
  });
  queue.push((seen) => {
    const h = (seen[seen.length - 1] as any).horarios;
    const citas = lastResultWith("citas").citas;
    return useTool("reagendar", { citaId: citas[0].citaId, fecha: SAT, hora: h[0].hora });
  });
  queue.push((seen) => {
    const r = seen[seen.length - 1] as any;
    return say(`Hecho, te movimos al ${r.fechaBonita} a las ${r.horaBonita}.`);
  });

  log("Cliente", "puedo mover mi cita más tarde?");
  const r = await turno(shops.A.id, phone, "puedo mover mi cita más tarde?");
  log("Bot", r.reply ?? "(sin respuesta)");

  assert.equal(r.effects.rescheduled.length, 1, "se movió UNA cita");
  const citas = await prisma.barberAppointment.findMany({
    where: { barbershopId: shops.A.id, clientPhone: phone },
  });
  assert.equal(citas.length, 1, "sigue siendo la MISMA cita, no se duplicó");
});

test("cancela la cita del cliente", { skip }, async () => {
  resetScript();
  const phone = "5511110001";

  queue.push(useTool("mis_citas", {}));
  queue.push((seen) => {
    const c = (seen[seen.length - 1] as any).citas[0];
    return useTool("cancelar", { citaId: c.citaId });
  });
  queue.push(() => say("Listo, tu cita quedó cancelada. Cuando quieras te reagendamos."));

  log("Cliente", "mejor cancélala porfa");
  const r = await turno(shops.A.id, phone, "mejor cancélala porfa");
  log("Bot", r.reply ?? "(sin respuesta)");

  assert.equal(r.effects.cancelled.length, 1);
  const cita = await prisma.barberAppointment.findFirst({
    where: { barbershopId: shops.A.id, clientPhone: phone },
  });
  assert.equal(cita!.status, "CANCELLED");
});

/* ═══════════════ 5. Dos clientes, el mismo hueco ═══════════════ */

test("dos clientes a la vez: el segundo recibe alternativas, no una cita fantasma", { skip }, async () => {
  resetScript();

  const libres = await getPublicSlots({
    shop: { id: shops.A.id, timezone: TZ },
    dateISO: SAT,
    durationMin: 30,
    barberId: null,
  });
  const hueco = libres[0].time;

  // Los dos piden EXACTAMENTE el mismo horario y hay UN solo barbero. Cada
  // conversación lleva su propio guion (la llave es su nombre en el hilo),
  // porque con una cola compartida un turno se roba los pasos del otro.
  const guionar = (nombre: string) => {
    const s = scriptFor(`soy ${nombre}`);
    s.queue.push(
      useTool("agendar", { fecha: SAT, hora: hueco, servicioIds: [shops.A.corteId], nombre }),
    );
    s.queue.push((seen) => {
      const r = seen[seen.length - 1] as any;
      return r?.ok
        ? say(`Listo ${nombre}, quedas a las ${r.horaBonita}.`)
        : say(
            `Uy, ese horario se acaba de apartar. Te quedan ${(r?.alternativas ?? [])
              .slice(0, 3)
              .map((a: any) => a.comoSeDice)
              .join(", ")}.`,
          );
    });
  };
  guionar("Luis");
  guionar("Memo");

  const textoLuis = `quiero corte el sábado a las ${hueco}, soy Luis`;
  const textoMemo = `quiero corte el sábado a las ${hueco}, soy Memo`;
  await clienteEscribe(shops.A.id, "5511110003", textoLuis);
  await clienteEscribe(shops.A.id, "5511110004", textoMemo);

  const [a, b] = await Promise.all([
    runBarberBotTurn({ barbershopId: shops.A.id, phone: "5511110003", text: textoLuis }),
    runBarberBotTurn({ barbershopId: shops.A.id, phone: "5511110004", text: textoMemo }),
  ]);

  assert.equal(
    a.effects.booked.length + b.effects.booked.length,
    1,
    "SOLO uno se llevó el hueco",
  );

  // Y en la base no quedaron dos citas encimadas para ese barbero.
  const enEseHueco = await prisma.barberAppointment.count({
    where: {
      barbershopId: shops.A.id,
      barberId: shops.A.barberId,
      status: { in: ["PENDING", "CONFIRMED"] },
      clientPhone: { in: ["5511110003", "5511110004"] },
    },
  });
  assert.equal(enEseHueco, 1, "no quedó ninguna cita fantasma");

  // El que perdió NO se queda en silencio: recibe alternativas REALES.
  const gano = a.effects.booked.length === 1 ? a : b;
  const perdio = a.effects.booked.length === 1 ? b : a;
  const perdedor = a.effects.booked.length === 1 ? "Memo" : "Luis";
  assert.ok(perdio.reply, "al segundo cliente SÍ se le contesta");

  const suyo = scriptFor(`soy ${perdedor}`).results;
  const err = suyo.find((r: any) => r && typeof r === "object" && r.error);
  assert.ok(err, "el modelo recibió el error como DATO, no un silencio");
  assert.equal(err.error, "ocupado");
  assert.ok(Array.isArray(err.alternativas), "y con alternativas del motor de agenda");
  // Las alternativas son huecos de verdad: ninguna es la que acaban de tomar.
  assert.ok(
    !err.alternativas.some((x: any) => x.hora === hueco),
    "no le vuelve a ofrecer el horario que ya se ocupó",
  );

  log("Cliente Luis", textoLuis);
  log("Cliente Memo", `${textoMemo}  (al mismo tiempo)`);
  log("Bot → quien ganó", gano.reply ?? "");
  log("Bot → quien perdió", perdio.reply ?? "");
});

/* ═══════════════ 6. Pasar con una persona ═══════════════ */

test("pedir una persona pausa el bot y marca el hilo, SIN gastar IA", { skip }, async () => {
  resetScript();
  const phone = "5511110005";

  log("Cliente", "quiero hablar con una persona");
  const r = await turno(shops.A.id, phone, "quiero hablar con una persona");
  log("Bot", r.reply ?? "(sin respuesta)");

  assert.equal(r.skipped, "handoff");
  assert.equal(modelCalls, 0, "ni una llamada al modelo: se detecta por reglas");
  assert.ok(r.reply, "el cliente NO se queda sin respuesta");

  const pausas = await listBarberBotPauses(shops.A.id);
  assert.ok(
    pausas.some((p) => p.phone === phone),
    "el hilo queda marcado en el panel",
  );

  // Y mientras está pausado, el bot ya no contesta ahí.
  resetScript();
  const r2 = await turno(shops.A.id, phone, "bueno, y a qué hora abren?");
  assert.equal(r2.reply, null, "con el hilo pausado el bot se calla");
  assert.equal(r2.skipped, "paused");
  assert.equal(modelCalls, 0);

  // El mostrador lo devuelve al bot.
  await resumeBarberBotThread({ barbershopId: shops.A.id, phone });
  const pausas2 = await listBarberBotPauses(shops.A.id);
  assert.ok(!pausas2.some((p) => p.phone === phone));
});

/* ═══════════════ 7. El plan manda, en el servidor ═══════════════ */

test("un plan Avanzado NO tiene bot", { skip }, async () => {
  resetScript();
  const phone = "5522220001";
  const r = await turno(shops.B.id, phone, "quiero corte mañana");

  assert.equal(r.reply, null, "no contesta");
  assert.equal(r.skipped, "planLocked");
  assert.equal(modelCalls, 0, "ni siquiera se llama al modelo");

  // Y la configuración guardada NO lo habilita: el gate es del plan.
  const { settings } = await getBarberBotSettings(shops.B.id);
  assert.equal(settings.enabled, true, "el interruptor estaba encendido…");
  // …y aun así no contestó. Ese es el punto.
});

/* ═══════════════ 8. Aislamiento entre barberías ═══════════════ */

test("el bot de una barbería nunca ve datos de la otra", { skip }, async () => {
  resetScript();
  const phone = "5511110006";

  queue.push(useTool("listar_servicios", {}));
  queue.push(() => say("Esos son."));
  await turno(shops.A.id, phone, "qué servicios tienen?");

  const catalogo = lastResultWith("servicios");
  const ids = catalogo.servicios.map((s: any) => s.id);
  assert.ok(ids.includes(shops.A.corteId));
  assert.ok(!ids.includes(shops.B.corteId), "ni un servicio de la barbería B");
  assert.ok(
    !catalogo.servicios.some((s: any) => s.precio === "$999"),
    "ni un precio de la barbería B",
  );
  const barberos = catalogo.barberos.map((b: any) => b.id);
  assert.ok(!barberos.includes(shops.B.barberId), "ni un barbero de la barbería B");

  // Intentar agendar un servicio AJENO no crea nada.
  resetScript();
  queue.push(
    useTool("agendar", {
      fecha: SAT,
      hora: "17:00",
      servicioIds: [shops.B.corteId],
      nombre: "Intruso",
    }),
  );
  queue.push(() => say("No pude con eso."));
  const r = await turno(shops.A.id, phone, "quiero el corte B");

  assert.equal(r.effects.booked.length, 0, "no se creó ninguna cita");
  const fuga = await prisma.barberAppointment.count({
    where: { barbershopId: shops.A.id, clientName: "Intruso" },
  });
  assert.equal(fuga, 0);
});

/* ═══════════════ 9. El prompt lleva datos reales ═══════════════ */

test("al cliente conocido lo saluda por su nombre y le ofrece lo de siempre", { skip }, async () => {
  resetScript();
  const phone = "5511110007";

  // Un cliente con historia: ya vino, con Beto, a cortarse.
  const cliente = await prisma.barberClient.create({
    data: { barbershopId: shops.A.id, name: "Toño Ramírez", phone, totalVisits: 4 },
  });
  const pasada = await prisma.barberAppointment.create({
    data: {
      barbershopId: shops.A.id,
      clientId: cliente.id,
      clientName: "Toño Ramírez",
      clientPhone: phone,
      barberId: shops.A.barberId,
      startAt: new Date(Date.now() - 30 * 86_400_000),
      endAt: new Date(Date.now() - 30 * 86_400_000 + 1_800_000),
      status: "DONE",
      source: "PANEL",
      services: { create: [{ serviceId: shops.A.corteId, priceAtBooking: 180 }] },
    },
  });

  queue.push(() => say("¡Qué onda, Toño! ¿Lo de siempre con Beto?"));
  log("Cliente", "hola");
  const r = await turno(shops.A.id, phone, "hola");
  log("Bot", r.reply ?? "(sin respuesta)");

  const sys = requests[0].system;
  assert.match(sys, /Se llama Toño/, "el prompt lleva su nombre");
  assert.match(sys, /Corte de caballero/, "y su último servicio");
  assert.match(sys, /con Beto/, "y con quién se lo hizo");
  assert.ok(sys.includes(shops.A.corteId), "con los ids para poder agendarlo");

  await prisma.barberAppointmentService.deleteMany({ where: { appointmentId: pasada.id } });
  await prisma.barberAppointment.delete({ where: { id: pasada.id } });
});

/* ═══════════════ 10. El tope de gasto frena de verdad ═══════════════ */

test("al llegar al tope de IA el bot deja de llamar al modelo", { skip }, async () => {
  resetScript();
  const phone = "5511110008";

  // Tope de 0 pesos = sin IA. El bot NO se calla: avisa y pasa el hilo.
  await saveBarberBotSettings(shops.A.id, {
    enabled: true,
    tone: "relajado",
    aiDailyCapMxn: 0,
    hours: { mode: "always" },
  });

  const r = await turno(shops.A.id, phone, "quiero corte el sábado");
  assert.equal(r.skipped, "aiCapReached");
  assert.equal(modelCalls, 0, "no se llama al modelo");
  assert.ok(r.reply, "pero el cliente SÍ recibe respuesta");
  const pausas = await listBarberBotPauses(shops.A.id);
  assert.ok(pausas.some((p) => p.phone === phone), "y el hilo queda para una persona");

  log("Cliente", "quiero corte el sábado  [con el tope de IA agotado]");
  log("Bot", r.reply ?? "");

  await saveBarberBotSettings(shops.A.id, {
    enabled: true,
    tone: "relajado",
    aiDailyCapMxn: 50,
    hours: { mode: "always" },
  });
});

/* ═══════════════ 11. Apagado es apagado ═══════════════ */

test("con el bot apagado no contesta nada", { skip }, async () => {
  resetScript();
  await saveBarberBotSettings(shops.A.id, { enabled: false });
  const r = await turno(shops.A.id, "5511110009", "quiero corte");
  assert.equal(r.reply, null);
  assert.equal(r.skipped, "disabled");
  assert.equal(modelCalls, 0);
  await saveBarberBotSettings(shops.A.id, {
    enabled: true,
    tone: "relajado",
    aiDailyCapMxn: 50,
    hours: { mode: "always" },
  });
});
