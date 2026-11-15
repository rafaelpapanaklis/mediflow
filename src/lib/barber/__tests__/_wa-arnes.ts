// ═══════════════════════════════════════════════════════════════════════
// Arnés de las pruebas de integración de WhatsApp y del bot de barber.
//
// QUÉ ES REAL Y QUÉ NO:
//   · REAL → Postgres (candados, transacciones, índices), Prisma y TODO el
//     código del vertical: la ingesta del webhook, la cola, los
//     recordatorios, el bot y sus herramientas contra la agenda.
//   · SIMULADO → lo que vive fuera: Meta (Graph API), Claude y Whisper. Se
//     intercepta `fetch` y NADA sale a la red: una llamada que no esté
//     prevista aquí revienta la prueba en vez de escaparse.
//
// 🔴 ESTAS PRUEBAS CREAN Y BORRAN BARBERÍAS. Solo corren contra una base
// LOCAL (127.0.0.1 / localhost). Con cualquier otro DATABASE_URL se saltan.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/whatsapp-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { prisma } from "@/lib/prisma";

const URL_DB = process.env.DATABASE_URL ?? "";
/** true = hay base y es local. */
export const BASE_LOCAL = /@(127\.0\.0\.1|localhost)[:/]/.test(URL_DB);
export const skip = BASE_LOCAL
  ? false
  : URL_DB
    ? "DATABASE_URL no es local: estas pruebas crean y borran barberías, se saltan"
    : "DATABASE_URL no definido: se salta la integración";

export const TZ = "America/Mexico_City";
export const RUN = `wa${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/* ═══════════════════════ Meta simulado ═══════════════════════ */

export interface GraphCall {
  url: string;
  method: string;
  body: any;
}

/** Todo lo que el código le pidió a la Graph API, en orden. */
export let graph: GraphCall[] = [];
/** Respuesta forzada para una llamada (un rechazo de Meta, por ejemplo). */
let graphOverride: ((call: GraphCall) => { status: number; json: unknown } | null) | null = null;
let wamidSeq = 0;
/** Retraso artificial de cada envío, para abrir la ventana de las carreras. */
let graphDelayMs = 0;

export function onGraph(fn: typeof graphOverride): void {
  graphOverride = fn;
}
export function graphDelay(ms: number): void {
  graphDelayMs = ms;
}

/** Los mensajes que de verdad se le mandaron a un cliente (no los "leído"). */
export function enviados(): GraphCall[] {
  return graph.filter(
    (c) => c.method === "POST" && c.url.endsWith("/messages") && c.body?.status !== "read",
  );
}

/* ═══════════════════════ Claude simulado ═══════════════════════ */

export interface CannedBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
export type Canned = CannedBlock[] | ((seen: any[]) => CannedBlock[]);

export let modelQueue: Canned[] = [];
export let modelRequests: { model: string; system: string; messages: any[]; raw: any }[] = [];
export let toolResults: any[] = [];
let toolSeq = 0;
/** Tokens que "gasta" cada llamada al modelo simulado. */
export const TOKENS_POR_LLAMADA = { input_tokens: 900, output_tokens: 90 };

export function say(text: string): CannedBlock[] {
  return [{ type: "text", text }];
}
export function useTool(name: string, input: Record<string, unknown>): CannedBlock[] {
  return [{ type: "tool_use", id: `tu_${++toolSeq}`, name, input }];
}
export function lastResultWith(key: string): any {
  for (let i = toolResults.length - 1; i >= 0; i--) {
    const r = toolResults[i];
    if (r && typeof r === "object" && key in r) return r;
  }
  return null;
}

/* ═══════════════════════ Whisper simulado ═══════════════════════ */

/** Lo que "oye" Whisper en la siguiente nota de voz. null = error 500. */
export let whisper: { text: string; duration?: number } | null = { text: "", duration: 4 };
export let whisperCalls = 0;
export function setWhisper(next: { text: string; duration?: number } | null): void {
  whisper = next;
}

/* ═══════════════════════ fetch ═══════════════════════ */

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Un OGG/Opus mínimo y válido de `segundos` de duración (solo cabeceras). */
export function oggDe(segundos: number): Buffer {
  const pagina = (granule: number, datos: Buffer): Buffer => {
    const cab = Buffer.alloc(27 + 1);
    cab.write("OggS", 0, "ascii");
    cab.writeUInt32LE(granule >>> 0, 6);
    cab.writeUInt32LE(Math.floor(granule / 2 ** 32), 10);
    cab[26] = 1; // un segmento
    cab[27] = datos.length;
    return Buffer.concat([cab, datos]);
  };
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "ascii");
  opusHead[8] = 1;
  opusHead[9] = 1;
  return Buffer.concat([pagina(0, opusHead), pagina(Math.round(segundos * 48000), Buffer.alloc(8))]);
}

/** Bytes que devuelve la "descarga" del audio desde Meta. */
export let audioBytes: Buffer = oggDe(4);
export function setAudio(buf: Buffer): void {
  audioBytes = buf;
}

export function instalarFetch(): void {
  globalThis.fetch = (async (url: any, init: any) => {
    const href = String(url);

    if (href.includes("graph.facebook.com")) {
      let body: any = null;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : null;
      } catch {
        body = null;
      }
      const call: GraphCall = { url: href.split("?")[0], method: init?.method ?? "GET", body };
      graph.push(call);
      const forced = graphOverride?.({ ...call, url: href });
      if (forced) return json(forced.json, forced.status);
      if (call.url.endsWith("/messages")) {
        if (body?.status === "read") return json({ success: true });
        if (graphDelayMs > 0) await new Promise((r) => setTimeout(r, graphDelayMs));
        return json({ messages: [{ id: `wamid.OUT.${RUN}.${++wamidSeq}` }] });
      }
      // Metadatos de un adjunto: GET /{media-id}
      if (/\/media-[\w-]+$/.test(call.url)) {
        return json({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
          mime_type: "audio/ogg; codecs=opus",
          file_size: audioBytes.length,
        });
      }
      return json({});
    }

    if (href.includes("lookaside.fbsbx.com")) {
      return new Response(new Uint8Array(audioBytes), {
        status: 200,
        headers: { "content-length": String(audioBytes.length) },
      });
    }

    if (href.includes("api.openai.com")) {
      whisperCalls++;
      if (!whisper) return json({ error: { message: "boom" } }, 500);
      return json({ text: whisper.text, duration: whisper.duration ?? 4, language: "es" });
    }

    if (href.includes("api.anthropic.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      modelRequests.push({
        model: body.model,
        system: typeof body.system === "string" ? body.system : JSON.stringify(body.system),
        messages: body.messages,
        raw: body,
      });
      for (const m of body.messages ?? []) {
        if (m.role !== "user" || !Array.isArray(m.content)) continue;
        for (const c of m.content) {
          if (c?.type !== "tool_result") continue;
          try {
            toolResults.push(JSON.parse(c.content));
          } catch {
            toolResults.push(c.content);
          }
        }
      }
      const next = modelQueue.shift();
      const blocks: CannedBlock[] = !next
        ? [{ type: "text", text: "Ahí te va." }]
        : typeof next === "function"
          ? next(toolResults)
          : next;
      return json({
        content: blocks,
        stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
        usage: TOKENS_POR_LLAMADA,
      });
    }

    throw new Error(`fetch no previsto en la prueba (nada sale a la red): ${href}`);
  }) as typeof fetch;
}

export function restaurarFetch(): void {
  globalThis.fetch = realFetch;
}

/** Deja limpio lo simulado entre una prueba y la siguiente. */
export function limpiar(): void {
  graph = [];
  graphOverride = null;
  graphDelayMs = 0;
  modelQueue = [];
  modelRequests = [];
  toolResults = [];
  whisper = { text: "", duration: 4 };
  whisperCalls = 0;
  audioBytes = oggDe(4);
}

/* ═══════════════════════ Semilla ═══════════════════════ */

export interface Tienda {
  id: string;
  phoneNumberId: string;
  wabaId: string;
  barberId: string;
  corteId: string;
  barbaId: string;
}

const creadas: string[] = [];
let tiendaSeq = 0;

export async function crearTienda(
  opts: { plan?: string; conectada?: boolean; address?: string | null; name?: string } = {},
): Promise<Tienda> {
  const n = ++tiendaSeq;
  const phoneNumberId = `pn-${RUN}-${n}`;
  const wabaId = `waba-${RUN}-${n}`;
  const conectada = opts.conectada !== false;
  const shop = await prisma.barbershop.create({
    data: {
      name: opts.name ?? `Barbería ${n}`,
      slug: `${RUN}-${n}`,
      plan: (opts.plan ?? "PROFESIONAL") as never,
      subscriptionStatus: "active",
      timezone: TZ,
      address: opts.address === undefined ? "Av. Juárez 120" : opts.address,
      city: "Centro",
      ...(conectada
        ? {
            whatsappSenderMode: "OWN_WABA" as never,
            phoneNumberId,
            wabaId,
            // En claro a propósito: decryptField devuelve tal cual lo que no
            // lleva el prefijo del sobre, y la llave real solo vive en Vercel.
            whatsappToken: `token-de-prueba-${n}`,
          }
        : {}),
    },
  });
  creadas.push(shop.id);

  const barber = await prisma.barber.create({
    data: { barbershopId: shop.id, name: "Beto", isActive: true },
  });
  const corte = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Corte de caballero", durationMin: 30, price: 180, isActive: true },
  });
  const barba = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Barba", durationMin: 20, price: 120, isActive: true },
  });
  // Beto trabaja todos los días de 10:00 a 20:00.
  await prisma.barberSchedule.createMany({
    data: Array.from({ length: 7 }, (_, d) => ({
      barbershopId: shop.id,
      barberId: barber.id,
      dayOfWeek: d,
      startMinute: 10 * 60,
      endMinute: 20 * 60,
      isActive: true,
    })),
  });

  return {
    id: shop.id,
    phoneNumberId,
    wabaId,
    barberId: barber.id,
    corteId: corte.id,
    barbaId: barba.id,
  };
}

let telSeq = 0;
/** Un celular mexicano de 10 dígitos que no se repite dentro de la corrida. */
export function telefono(): string {
  telSeq++;
  return `55${String(10000000 + ((Date.now() + telSeq * 7919) % 89999999)).padStart(8, "0")}`;
}

export async function crearCliente(t: Tienda, phone: string, name = "Luis Pérez") {
  return prisma.barberClient.create({ data: { barbershopId: t.id, name, phone } });
}

/**
 * Una visita que empieza dentro de `enMinutos` (negativo = ya pasó).
 *
 * Nace SIN barbero salvo que se pida `conBarbero`: la base local tiene la
 * constraint real de no-empalme (barber_appt_no_overlap) y varias pruebas
 * siembran visitas a la misma hora.
 */
export async function crearCita(
  t: Tienda,
  args: {
    phone: string;
    enMinutos: number;
    status?: string;
    clientId?: string | null;
    name?: string;
    conBarbero?: boolean;
  },
) {
  const startAt = new Date(Date.now() + args.enMinutos * 60_000);
  return prisma.barberAppointment.create({
    data: {
      barbershopId: t.id,
      clientId: args.clientId ?? null,
      clientName: args.name ?? "Luis Pérez",
      clientPhone: args.phone,
      barberId: args.conBarbero ? t.barberId : null,
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      status: (args.status ?? "PENDING") as never,
      services: { create: [{ serviceId: t.corteId, priceAtBooking: 180 }] },
    },
  });
}

let inSeq = 0;
/** Lo que Meta manda al webhook cuando un cliente escribe texto. */
export function entrante(t: Tienda, phone: string, texto: string, id?: string) {
  return {
    value: { messaging_product: "whatsapp", metadata: { phone_number_id: t.phoneNumberId } },
    msg: {
      from: `521${phone}`,
      id: id ?? `wamid.IN.${RUN}.${++inSeq}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "text",
      text: { body: texto },
    },
  };
}

/** Lo que Meta manda cuando el cliente manda una nota de voz. */
export function entranteVoz(t: Tienda, phone: string, mediaId = `media-${RUN}-${++inSeq}`) {
  return {
    value: { messaging_product: "whatsapp", metadata: { phone_number_id: t.phoneNumberId } },
    msg: {
      from: `521${phone}`,
      id: `wamid.IN.${RUN}.${++inSeq}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "audio",
      audio: { id: mediaId, mime_type: "audio/ogg; codecs=opus", voice: true },
    },
  };
}

/** Lo que Meta manda cuando el cliente toca un botón o una fila de lista. */
export function entranteToque(
  t: Tienda,
  phone: string,
  toque: { id: string; title: string },
  tipo: "button_reply" | "list_reply" = "button_reply",
) {
  return {
    value: { messaging_product: "whatsapp", metadata: { phone_number_id: t.phoneNumberId } },
    msg: {
      from: `521${phone}`,
      id: `wamid.IN.${RUN}.${++inSeq}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "interactive",
      interactive: { type: tipo, [tipo]: toque },
    },
  };
}

export async function mensajes(t: Tienda, phone: string) {
  return prisma.barberMessage.findMany({
    where: { barbershopId: t.id, phone },
    orderBy: { createdAt: "asc" },
  });
}

export async function borrarTodo(): Promise<void> {
  for (const id of creadas) {
    await prisma.barberMessage.deleteMany({ where: { barbershopId: id } });
    await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: id } } });
    await prisma.barberAppointment.deleteMany({ where: { barbershopId: id } });
    await prisma.barberWalkIn.deleteMany({ where: { barbershopId: id } });
    await prisma.barberSchedule.deleteMany({ where: { barbershopId: id } });
    await prisma.barberService.deleteMany({ where: { barbershopId: id } });
    await prisma.barberClient.deleteMany({ where: { barbershopId: id } });
    await prisma.barber.deleteMany({ where: { barbershopId: id } });
    await prisma.barberBotSettings.deleteMany({ where: { barbershopId: id } });
    await prisma.barberBotUsage.deleteMany({ where: { barbershopId: id } });
    await prisma.barberBotPause.deleteMany({ where: { barbershopId: id } });
    await prisma.barbershop.delete({ where: { id } });
  }
  creadas.length = 0;
  await prisma.$disconnect();
}

export { prisma };
