/**
 * Handoff con aviso y reactivación a las 12 h (#4, ws1-t5).
 *
 * Run: npm run test:wa-bot-ia
 *
 * Prisma es un doble en memoria; lo demás es el código de verdad.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../../..");
type Fila = Record<string, any>;

const db = {
  mensajes: [] as Fila[],
  hilos: [] as Fila[],
  consultas: [] as Fila[],
};

function cumple(m: Fila, where: Fila): boolean {
  if (where.threadId && m.threadId !== where.threadId) return false;
  if (where.direction && m.direction !== where.direction) return false;
  if (where.isInternal === false && m.isInternal) return false;
  if (where.sentAt?.gt && !(m.sentAt > where.sentAt.gt)) return false;
  if (where.OR) {
    const ok = m.sentById != null || (m.externalId != null && !String(m.externalId).startsWith("sys:"));
    if (!ok) return false;
  }
  return true;
}

const prismaDoble = {
  inboxMessage: {
    findFirst: async ({ where }: { where: Fila }) => {
      db.consultas.push(where);
      return db.mensajes.find((m) => cumple(m, where)) ?? null;
    },
    create: async ({ data }: { data: Fila }) => {
      db.mensajes.push({ ...data });
      return data;
    },
  },
  inboxThread: {
    updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
      const h = db.hilos.find((x) => x.id === where.id && x.clinicId === where.clinicId && x.botActive === where.botActive);
      if (!h) return { count: 0 };
      Object.assign(h, data);
      return { count: 1 };
    },
  },
};

const dobles = new Map<string, unknown>([[path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }]]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let h: typeof import("../handoff");
before(async () => {
  h = await import("../handoff");
});

const AT = new Date("2026-10-01T10:00:00Z");
const HORA = 60 * 60 * 1000;

beforeEach(() => {
  db.mensajes.length = 0;
  db.consultas.length = 0;
  db.hilos.length = 0;
  db.hilos.push({ id: "t1", clinicId: "c1", botActive: false, botState: h.marcaDeHandoff(AT, "modelo") });
});

test("la marca se escribe y se lee", () => {
  assert.equal(h.leerHandoff(h.marcaDeHandoff(AT, "modelo"))?.toISOString(), AT.toISOString());
  assert.equal(h.leerHandoff(null), null);
  assert.equal(h.leerHandoff({ step: "date" }), null);
  assert.equal(h.leerHandoff({ handoff: { at: "basura" } }), null);
});

test("qué cuenta como respuesta del equipo", () => {
  const base = { direction: "OUT", isInternal: false, sentById: null, externalId: null };
  assert.equal(h.esRespuestaDelEquipo({ ...base, sentById: "u1" }), true); // desde el panel
  assert.equal(h.esRespuestaDelEquipo({ ...base, externalId: "wamid.HBg" }), true); // desde el celular
  assert.equal(h.esRespuestaDelEquipo(base), false); // respuesta del bot (vieja)
  assert.equal(h.esRespuestaDelEquipo({ ...base, externalId: "sys:bot:wamid.x" }), false); // bot (nueva)
  assert.equal(h.esRespuestaDelEquipo({ ...base, externalId: "sys:reminder:x" }), false);
  assert.equal(h.esRespuestaDelEquipo({ ...base, sentById: "u1", isInternal: true }), false); // nota interna
  assert.equal(h.esRespuestaDelEquipo({ ...base, direction: "IN", sentById: null }), false);
});

test("antes de 12 h no se reactiva", async () => {
  const r = await h.reactivarBotSiVencioHandoff({
    clinicId: "c1", threadId: "t1", botState: db.hilos[0].botState, now: new Date(AT.getTime() + 11 * HORA),
  });
  assert.equal(r, false);
  assert.equal(db.hilos[0].botActive, false);
});

test("a las 12 h sin respuesta del equipo se reactiva y se limpia la marca", async () => {
  // El aviso del bot y la nota interna no cuentan como respuesta.
  db.mensajes.push({ threadId: "t1", direction: "OUT", isInternal: false, sentById: null, externalId: null, sentAt: new Date(AT.getTime() + 1000) });
  db.mensajes.push({ threadId: "t1", direction: "OUT", isInternal: true, sentById: null, externalId: "sys:system:x", sentAt: new Date(AT.getTime() + 2000) });
  const r = await h.reactivarBotSiVencioHandoff({
    clinicId: "c1", threadId: "t1", botState: db.hilos[0].botState, now: new Date(AT.getTime() + 12 * HORA),
  });
  assert.equal(r, true);
  assert.equal(db.hilos[0].botActive, true);
  assert.match(String(db.hilos[0].botState), /DbNull/);
  // La consulta va acotada a la clínica (regla c).
  assert.deepEqual(db.consultas[0].thread, { clinicId: "c1" });
});

test("si alguien del equipo contestó, NO se reactiva aunque pasen 12 h", async () => {
  db.mensajes.push({ threadId: "t1", direction: "OUT", isInternal: false, sentById: "u_recepcion", externalId: null, sentAt: new Date(AT.getTime() + HORA) });
  const r = await h.reactivarBotSiVencioHandoff({
    clinicId: "c1", threadId: "t1", botState: db.hilos[0].botState, now: new Date(AT.getTime() + 20 * HORA),
  });
  assert.equal(r, false);
  assert.equal(db.hilos[0].botActive, false);
});

test("una respuesta desde el celular de la clínica también cuenta", async () => {
  db.mensajes.push({ threadId: "t1", direction: "OUT", isInternal: false, sentById: null, externalId: "wamid.ECO", sentAt: new Date(AT.getTime() + HORA) });
  assert.equal(
    await h.reactivarBotSiVencioHandoff({ clinicId: "c1", threadId: "t1", botState: db.hilos[0].botState, now: new Date(AT.getTime() + 13 * HORA) }),
    false,
  );
});

test("una pausa sin marca (la puso una persona) nunca se quita sola", async () => {
  db.hilos[0].botState = null;
  assert.equal(
    await h.reactivarBotSiVencioHandoff({ clinicId: "c1", threadId: "t1", botState: null, now: new Date(AT.getTime() + 100 * HORA) }),
    false,
  );
  assert.equal(db.consultas.length, 0);
});

test("sin clinicId no consulta nada", async () => {
  assert.equal(
    await h.reactivarBotSiVencioHandoff({ clinicId: "", threadId: "t1", botState: db.hilos[0].botState, now: new Date(AT.getTime() + 13 * HORA) }),
    false,
  );
  assert.equal(db.consultas.length, 0);
});

test("la nota interna queda fuera del tope del bot y del historial", async () => {
  await h.anotarHandoffEnInbox({ threadId: "t1" });
  const nota = db.mensajes[0];
  assert.equal(nota.isInternal, true);
  assert.match(nota.externalId, /^sys:system:/);
  assert.match(nota.body, /espera respuesta/);
});

test("«espera a una persona» en la lista del Inbox", () => {
  const marca = h.marcaDeHandoff(AT, "modelo");
  assert.equal(h.esperaPersona({ botActive: false, botState: marca, lastMessage: { direction: "IN" } }), true);
  assert.equal(h.esperaPersona({ botActive: false, botState: marca, lastMessage: { direction: "OUT", sentById: null, externalId: null } }), true);
  assert.equal(h.esperaPersona({ botActive: false, botState: marca, lastMessage: { direction: "OUT", sentById: "u1" } }), false);
  assert.equal(h.esperaPersona({ botActive: true, botState: marca, lastMessage: { direction: "IN" } }), false);
  assert.equal(h.esperaPersona({ botActive: false, botState: null, lastMessage: { direction: "IN" } }), false);
});
