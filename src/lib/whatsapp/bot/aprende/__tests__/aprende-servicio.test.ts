/**
 * El bot aprende de cada clínica (ws1-t11) — servicio con una base FALSA en
 * memoria: escaneo → sugerencias, aprobar/descartar, 👍/👎 con corrección,
 * ejemplos de tono, aislamiento entre clínicas y el modo «SQL sin pegar».
 *
 * Run: npm run test:bot-aprende
 *
 * Prisma, el motor del bot y la config del bot son dobles; lo demás es el
 * código de verdad. Datos inventados: «clinica_a» y «clinica_b».
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../../../..");
type Fila = Record<string, any>;

// ── Base falsa ────────────────────────────────────────────────────────────────

const db = {
  clinicas: [] as Fila[],
  hilos: [] as Fila[],
  mensajes: [] as Fila[],
  faqs: [] as Fila[],
  sugerencias: [] as Fila[],
  valoraciones: [] as Fila[],
  tono: [] as Fila[],
  /** [modelo, where] de cada consulta, para revisar el filtro de clínica. */
  consultas: [] as Array<[string, Fila]>,
  sinSql: false,
};
let seq = 0;
const nuevoId = (p: string) => `${p}_${++seq}`;

function hiloDe(threadId: string) {
  return db.hilos.find((h) => h.id === threadId);
}

/** Matcher mínimo de `where` de Prisma (lo que usa el servicio). */
function cumple(fila: Fila, where: Fila | undefined, modelo: string): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === "OR") {
      if (!(cond as Fila[]).some((c) => cumple(fila, c, modelo))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(cond as Fila[]).every((c) => cumple(fila, c, modelo))) return false;
      continue;
    }
    if (k === "NOT") {
      if (cumple(fila, cond as Fila, modelo)) return false;
      continue;
    }
    if (k === "thread" && modelo === "inboxMessage") {
      const h = hiloDe(fila.threadId);
      if (!h || !cumple(h, cond as Fila, "inboxThread")) return false;
      continue;
    }
    const v = fila[k];
    if (cond === null) {
      if (v !== null && v !== undefined) return false;
      continue;
    }
    if (typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Fila;
      if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
      if ("not" in c && (c.not === null ? v === null || v === undefined : v === c.not)) return false;
      if ("gte" in c && !(v >= c.gte)) return false;
      if ("gt" in c && !(v > c.gt)) return false;
      if ("lte" in c && !(v <= c.lte)) return false;
      if ("startsWith" in c && !(typeof v === "string" && v.startsWith(c.startsWith))) return false;
      if ("contains" in c) {
        const a = String(v ?? "");
        const ok = c.mode === "insensitive" ? a.toLowerCase().includes(String(c.contains).toLowerCase()) : a.includes(c.contains);
        if (!ok) return false;
      }
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function ordenar(filas: Fila[], orderBy: any): Fila[] {
  const reglas = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Fila[];
  return [...filas].sort((a, b) => {
    for (const r of reglas) {
      const [campo, dir] = Object.entries(r)[0] as [string, string];
      if (a[campo] < b[campo]) return dir === "asc" ? -1 : 1;
      if (a[campo] > b[campo]) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

function proyectar(f: Fila, select: Fila | undefined, modelo: string): Fila {
  if (!select) return { ...f };
  const out: Fila = {};
  for (const [k, v] of Object.entries(select)) {
    if (k === "thread" && modelo === "inboxMessage") {
      const h = hiloDe(f.threadId)!;
      out.thread = proyectar(h, (v as Fila).select, "inboxThread");
    } else if (k === "patient" && modelo === "inboxThread") {
      out.patient = f.patient ? proyectar(f.patient, (v as Fila).select, "patient") : null;
    } else if (v) out[k] = f[k];
  }
  return out;
}

function tabla(nombre: string, filas: () => Fila[], opciones: { tenant?: boolean; nuevo?: boolean } = {}) {
  const sonda = (where: Fila | undefined) => {
    db.consultas.push([nombre, where ?? {}]);
    if (opciones.nuevo && db.sinSql) {
      throw Object.assign(new Error(`The table \`public.${nombre}\` does not exist in the current database.`), { code: "P2021" });
    }
  };
  return {
    findMany: async (a: Fila = {}) => {
      sonda(a.where);
      const r = ordenar(filas().filter((f) => cumple(f, a.where, nombre)), a.orderBy);
      return r.slice(0, a.take ?? r.length).map((f) => proyectar(f, a.select, nombre));
    },
    findFirst: async (a: Fila = {}) => {
      sonda(a.where);
      const f = ordenar(filas().filter((x) => cumple(x, a.where, nombre)), a.orderBy)[0];
      return f ? proyectar(f, a.select, nombre) : null;
    },
    findUnique: async (a: Fila) => {
      sonda(a.where);
      const f = filas().find((x) => cumple(x, a.where, nombre));
      return f ? proyectar(f, a.select, nombre) : null;
    },
    count: async (a: Fila = {}) => {
      sonda(a.where);
      return filas().filter((f) => cumple(f, a.where, nombre)).length;
    },
    create: async (a: Fila) => {
      sonda({ clinicId: a.data.clinicId });
      const f = { id: nuevoId(nombre), createdAt: new Date(), updatedAt: new Date(), ...a.data };
      filas().push(f);
      return proyectar(f, a.select, nombre);
    },
    createMany: async (a: Fila) => {
      sonda({ clinicId: a.data[0]?.clinicId });
      let count = 0;
      for (const d of a.data as Fila[]) {
        if (a.skipDuplicates && filas().some((f) => f.clinicId === d.clinicId && f.fuenteId === d.fuenteId)) continue;
        filas().push({ id: nuevoId(nombre), createdAt: new Date(), updatedAt: new Date(), ...d });
        count++;
      }
      return { count };
    },
    updateMany: async (a: Fila) => {
      sonda(a.where);
      const hits = filas().filter((f) => cumple(f, a.where, nombre));
      for (const f of hits) Object.assign(f, a.data);
      return { count: hits.length };
    },
    upsert: async (a: Fila) => {
      const llave = Object.values(a.where)[0] as Fila;
      sonda(llave);
      const f = filas().find((x) => cumple(x, llave, nombre));
      if (f) {
        Object.assign(f, a.update);
        return proyectar(f, a.select, nombre);
      }
      const nueva = { id: nuevoId(nombre), createdAt: new Date(), updatedAt: new Date(), ...a.create };
      filas().push(nueva);
      return proyectar(nueva, a.select, nombre);
    },
    groupBy: async (a: Fila) => {
      sonda(a.where);
      const grupos = new Map<string, number>();
      for (const f of filas().filter((x) => cumple(x, a.where, nombre))) {
        const k = f[a.by[0]];
        grupos.set(k, (grupos.get(k) ?? 0) + 1);
      }
      return Array.from(grupos.entries()).map(([k, n]) => ({ [a.by[0]]: k, _count: { _all: n } }));
    },
  };
}

const prismaDoble: Fila = {
  clinic: tabla("clinic", () => db.clinicas),
  inboxThread: tabla("inboxThread", () => db.hilos),
  inboxMessage: tabla("inboxMessage", () => db.mensajes),
  whatsAppBotFaq: tabla("whatsAppBotFaq", () => db.faqs),
  whatsAppBotSugerencia: tabla("whatsAppBotSugerencia", () => db.sugerencias, { nuevo: true }),
  whatsAppBotValoracion: tabla("whatsAppBotValoracion", () => db.valoraciones, { nuevo: true }),
  whatsAppBotEjemploTono: tabla("whatsAppBotEjemploTono", () => db.tono, { nuevo: true }),
};
prismaDoble.$transaction = async (fn: (tx: Fila) => Promise<unknown>) => fn(prismaDoble);

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [
    path.join(RAIZ, "src/lib/whatsapp/bot/engine.ts"),
    {
      matchFaq: (texto: string, faqs: Array<{ question: string }>) =>
        faqs.find((f) => texto.toLowerCase().includes(f.question.toLowerCase())) ?? null,
    },
  ],
  [path.join(RAIZ, "src/app/api/whatsapp/bot/service.ts"), { getOrCreateBotConfig: async (clinicId: string) => ({ id: `cfg_${clinicId}`, clinicId }) }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = M._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let sv: typeof import("../servicio");
let tonoPrompt: typeof import("../tono-prompt");
before(async () => {
  sv = await import("../servicio");
  tonoPrompt = await import("../tono-prompt");
});

// ── Escenario ────────────────────────────────────────────────────────────────

const HACE = (min: number) => new Date(Date.now() - min * 60_000);
const NOTA = "🙋 El bot pasó esta conversación a una persona del equipo: el paciente espera respuesta.";

function hilo(clinicId: string, id: string, patient: Fila | null) {
  db.hilos.push({ id, clinicId, channel: "WHATSAPP", patient });
}
function m(threadId: string, minAtras: number, p: Fila): Fila {
  const f = {
    id: nuevoId("msg"),
    threadId,
    direction: "IN",
    body: "",
    sentAt: HACE(minAtras),
    sentById: null,
    externalId: `wamid.${seq}`,
    isInternal: false,
    attachments: null,
    ...p,
  };
  db.mensajes.push(f);
  return f;
}

let botEstacionamiento: Fila;
let respuestaEquipoA: Fila;
let mensajeDeB: Fila;

beforeEach(() => {
  for (const k of ["clinicas", "hilos", "mensajes", "faqs", "sugerencias", "valoraciones", "tono", "consultas"] as const) {
    (db[k] as unknown[]).length = 0;
  }
  db.sinSql = false;
  sv.__reiniciarEstado();

  db.clinicas.push({ id: "clinica_a", phone: "5588889999", email: "hola@clinica-a.test" });
  db.clinicas.push({ id: "clinica_b", phone: "5511112222", email: "hola@clinica-b.test" });

  // Clínica A — handoff con respuesta del equipo (apta).
  hilo("clinica_a", "hA1", { firstName: "Marta", lastName: "Gómez" });
  m("hA1", 120, { body: "Hola, soy Marta Gómez. ¿Tienen estacionamiento?" });
  botEstacionamiento = m("hA1", 119, { direction: "OUT", body: "Te comunico con el equipo de la clínica, en breve te responden. 🙋", externalId: "sys:bot:w1" });
  m("hA1", 119, { direction: "OUT", isInternal: true, body: NOTA, externalId: "sys:system:n1" });
  respuestaEquipoA = m("hA1", 100, { direction: "OUT", body: "Hola Marta, sí: estacionamiento gratis en el sótano. Dudas al 55 8888 9999.", sentById: "u_a", externalId: null });

  // Clínica A — handoff clínico (no apto).
  hilo("clinica_a", "hA2", { firstName: "Raúl", lastName: "Soto" });
  m("hA2", 90, { body: "Me duele mucho la muela, ¿qué me tomo?" });
  m("hA2", 89, { direction: "OUT", isInternal: true, body: NOTA, externalId: "sys:system:n2" });
  m("hA2", 80, { direction: "OUT", body: "Tómate ibuprofeno y ven hoy a las 5", sentById: "u_a", externalId: null });

  // Clínica A — handoff sin respuesta (solo reporte).
  hilo("clinica_a", "hA3", null);
  m("hA3", 60, { body: "¿Hacen carillas de porcelana?" });
  m("hA3", 59, { direction: "OUT", isInternal: true, body: NOTA, externalId: "sys:system:n3" });

  // Clínica B — nunca debe aparecer en A.
  hilo("clinica_b", "hB1", { firstName: "Secreto", lastName: "DeB" });
  m("hB1", 50, { body: "¿Aceptan el seguro de la clínica B?" });
  m("hB1", 49, { direction: "OUT", isInternal: true, body: NOTA, externalId: "sys:system:nb" });
  mensajeDeB = m("hB1", 40, { direction: "OUT", body: "Sí, con reembolso de aseguradora, en la clínica B.", sentById: "u_b", externalId: null });
});

function sinFugaDeClinica(clinicId: string) {
  for (const [modelo, where] of db.consultas) {
    const texto = JSON.stringify(where);
    if (modelo === "whatsAppBotSugerencia" && texto.includes("__sonda__")) continue;
    if (modelo === "clinic") {
      assert.equal(where.id, clinicId, `clinic sin id de la sesión: ${texto}`);
      continue;
    }
    assert.ok(texto.includes(`"clinicId":"${clinicId}"`), `${modelo} sin filtro de clínica: ${texto}`);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sin el SQL pegado", () => {
  test("la pantalla carga: reporte sí, lo demás oculto; nada se escribe", async () => {
    db.sinSql = true;
    const p = await sv.panelAprende("clinica_a");
    assert.equal(p.disponible, false);
    assert.ok(p.reporte.length > 0);
    assert.deepEqual(p.sugerencias, []);
    assert.equal(db.sugerencias.length, 0);
  });

  test("escribir responde 503 con el nombre del SQL; el prompt recibe bloque vacío", async () => {
    db.sinSql = true;
    await assert.rejects(
      sv.decidirSugerencia({ clinicId: "clinica_a", userId: "u_a", id: "x", accion: "descartar" }),
      (e: any) => e.status === 503 && e.code === "sql_pendiente",
    );
    assert.equal(await tonoPrompt.bloqueDeTonoDeLaClinica("clinica_a"), "");
  });

  test("«Agregar respuesta» del reporte funciona sin las tablas nuevas", async () => {
    db.sinSql = true;
    const r = await sv.crearFaqDesdeReporte({ clinicId: "clinica_a", pregunta: "¿Hacen carillas?", respuesta: "Sí, de resina y de porcelana." });
    assert.ok(r.faqId);
    assert.equal(db.faqs[0].clinicId, "clinica_a");
    assert.equal(db.faqs[0].configId, "cfg_clinica_a");
  });
});

describe("escaneo y pantalla", () => {
  test("crea la sugerencia anonimizada, aparta lo clínico SIN texto y no toca a la otra clínica", async () => {
    const p = await sv.panelAprende("clinica_a");
    assert.equal(p.disponible, true);
    assert.equal(p.sugerencias.length, 1);
    const sg = p.sugerencias[0];
    assert.ok(!/Marta|G[oó]mez/.test(sg.pregunta + sg.respuesta), JSON.stringify(sg));
    // El teléfono público de la clínica se queda.
    assert.match(sg.respuesta, /55 8888 9999/);
    assert.match(sg.respuesta, /estacionamiento gratis/);

    const noApta = db.sugerencias.find((s) => s.estado === "no_apto");
    assert.ok(noApta);
    assert.equal(noApta!.motivoNoApto, "clinico");
    assert.equal(noApta!.pregunta, null);
    assert.equal(noApta!.respuesta, null);
    assert.deepEqual(p.apartadas, { clinico: 1 });

    assert.ok(db.sugerencias.every((s) => s.clinicId === "clinica_a"));
    assert.ok(!JSON.stringify(p).includes("clínica B") && !JSON.stringify(p).includes("Secreto"));
    sinFugaDeClinica("clinica_a");
  });

  test("el reporte agrupa por tema; lo clínico solo se cuenta", async () => {
    const p = await sv.panelAprende("clinica_a");
    const temas = Object.fromEntries(p.reporte.map((g) => [g.tema, g.total]));
    assert.deepEqual(temas, { ubicacion: 1, tratamientos: 1, clinico: 1 });
    assert.deepEqual(p.reporte.find((g) => g.tema === "clinico")!.preguntas, []);
  });

  test("una pregunta que ya tiene respuesta frecuente sale del reporte", async () => {
    db.faqs.push({ id: "f1", clinicId: "clinica_a", question: "carillas", answer: "Sí", enabled: true, order: 0 });
    const p = await sv.panelAprende("clinica_a");
    assert.equal(p.reporte.find((g) => g.tema === "tratamientos"), undefined);
  });

  test("escanear dos veces no duplica; descartada no vuelve", async () => {
    await sv.panelAprende("clinica_a");
    const antes = db.sugerencias.length;
    const sg = db.sugerencias.find((s) => s.estado === "pendiente")!;
    await sv.decidirSugerencia({ clinicId: "clinica_a", userId: "u_a", id: sg.id, accion: "descartar" });
    const eventos = await sv.cargarEventos("clinica_a", HACE(60 * 24 * 30));
    await sv.escanearSugerencias("clinica_a", eventos, { forzar: true });
    assert.equal(db.sugerencias.length, antes);
    assert.equal(db.sugerencias.find((s) => s.id === sg.id)!.estado, "descartada");
    const p = await sv.panelAprende("clinica_a");
    assert.equal(p.sugerencias.length, 0);
  });

  test("sin clínica en la sesión no se consulta nada", async () => {
    await assert.rejects(sv.panelAprende(""), (e: any) => e.status === 401);
    assert.equal(db.consultas.length, 0);
  });
});

describe("aprobar", () => {
  test("crea la FAQ de la clínica con el texto editado y solo una vez", async () => {
    await sv.panelAprende("clinica_a");
    const sg = db.sugerencias.find((s) => s.estado === "pendiente")!;
    const r = await sv.decidirSugerencia({
      clinicId: "clinica_a",
      userId: "u_a",
      id: sg.id,
      accion: "aprobar",
      pregunta: "¿Tienen estacionamiento?",
      respuesta: "Sí, gratis en el sótano. Dudas al 55 8888 9999.",
    });
    assert.equal(r.estado, "aprobada");
    assert.equal(db.faqs.length, 1);
    assert.deepEqual(
      { c: db.faqs[0].clinicId, cfg: db.faqs[0].configId, q: db.faqs[0].question, on: db.faqs[0].enabled },
      { c: "clinica_a", cfg: "cfg_clinica_a", q: "¿Tienen estacionamiento?", on: true },
    );
    assert.equal(db.sugerencias.find((s) => s.id === sg.id)!.faqId, r.faqId);
    await assert.rejects(
      sv.decidirSugerencia({ clinicId: "clinica_a", userId: "u_a", id: sg.id, accion: "aprobar" }),
      (e: any) => e.status === 409,
    );
    assert.equal(db.faqs.length, 1);
  });

  test("otra clínica no puede decidir una sugerencia ajena (404)", async () => {
    await sv.panelAprende("clinica_a");
    const sg = db.sugerencias.find((s) => s.estado === "pendiente")!;
    await assert.rejects(
      sv.decidirSugerencia({ clinicId: "clinica_b", userId: "u_b", id: sg.id, accion: "aprobar" }),
      (e: any) => e.status === 404,
    );
    assert.equal(db.faqs.length, 0);
  });

  test("con [marcadores] o contenido clínico no se aprueba (422)", async () => {
    await sv.panelAprende("clinica_a");
    const sg = db.sugerencias.find((s) => s.estado === "pendiente")!;
    await assert.rejects(
      sv.decidirSugerencia({ clinicId: "clinica_a", userId: "u_a", id: sg.id, accion: "aprobar", pregunta: "¿Me llaman?", respuesta: "Hola [nombre], sí" }),
      (e: any) => e.status === 422 && e.code === "marcadores",
    );
    await assert.rejects(
      sv.decidirSugerencia({ clinicId: "clinica_a", userId: "u_a", id: sg.id, accion: "aprobar", pregunta: "¿Qué tomo?", respuesta: "Paracetamol cada 8 horas" }),
      (e: any) => e.status === 422 && e.code === "clinico",
    );
    assert.equal(db.faqs.length, 0);
    assert.equal(db.sugerencias.find((s) => s.id === sg.id)!.estado, "pendiente");
  });
});

describe("👍 / 👎", () => {
  test("👎 con corrección → valoración + sugerencia anonimizada (con la pregunta del paciente)", async () => {
    const r = await sv.valorarRespuesta({
      clinicId: "clinica_a",
      userId: "u_a",
      messageId: botEstacionamiento.id,
      valor: "mal",
      correccion: "Hola Marta, sí hay estacionamiento gratis en el sótano.",
    });
    assert.equal(r.sugerencia, "creada");
    assert.equal(db.valoraciones.length, 1);
    assert.equal(db.valoraciones[0].valor, "mal");
    const sg = db.sugerencias.find((s) => s.origen === "correccion")!;
    assert.equal(sg.estado, "pendiente");
    assert.equal(sg.fuenteId, `mal:${botEstacionamiento.id}`);
    assert.ok(!/Marta/.test(sg.pregunta + sg.respuesta));
    assert.match(sg.pregunta, /estacionamiento/);
    sinFugaDeClinica("clinica_a");
  });

  test("👍 cambia la valoración sin crear sugerencia", async () => {
    await sv.valorarRespuesta({ clinicId: "clinica_a", userId: "u_a", messageId: botEstacionamiento.id, valor: "bien" });
    assert.equal(db.valoraciones[0].valor, "bien");
    assert.equal(db.sugerencias.length, 0);
  });

  test("corrección clínica: se guarda el 👎 pero NO el texto, y queda no apta", async () => {
    const r = await sv.valorarRespuesta({
      clinicId: "clinica_a",
      userId: "u_a",
      messageId: botEstacionamiento.id,
      valor: "mal",
      correccion: "Debió decirle que tome amoxicilina 500 mg",
    });
    assert.equal(r.sugerencia, "no_apta");
    assert.equal(db.valoraciones[0].correccion, null);
    const sg = db.sugerencias[0];
    assert.deepEqual([sg.estado, sg.pregunta, sg.respuesta], ["no_apto", null, null]);
  });

  test("solo respuestas del bot, y solo de la propia clínica", async () => {
    await assert.rejects(
      sv.valorarRespuesta({ clinicId: "clinica_a", userId: "u_a", messageId: respuestaEquipoA.id, valor: "bien" }),
      (e: any) => e.status === 400,
    );
    await assert.rejects(
      sv.valorarRespuesta({ clinicId: "clinica_b", userId: "u_b", messageId: botEstacionamiento.id, valor: "mal", correccion: "x" }),
      (e: any) => e.status === 404,
    );
    assert.equal(db.valoraciones.length, 0);
  });
});

describe("ejemplos de tono", () => {
  test("marcar anonimiza; el bloque del prompt solo trae los activos de la clínica", async () => {
    const e = await sv.marcarEjemploDeTono({ clinicId: "clinica_a", userId: "u_a", messageId: respuestaEquipoA.id });
    assert.ok(!/Marta/.test(e.texto), e.texto);
    db.tono.push({ id: "tb", clinicId: "clinica_b", texto: "Ejemplo de la clínica B", fuenteId: "x", activo: true, createdAt: new Date() });
    const bloque = await tonoPrompt.bloqueDeTonoDeLaClinica("clinica_a");
    assert.match(bloque, /estacionamiento gratis/);
    assert.ok(!bloque.includes("clínica B"));
    await sv.quitarEjemploDeTono({ clinicId: "clinica_a", id: e.id });
    assert.equal(db.tono.find((t) => t.id === e.id)!.activo, false); // se desactiva, no se borra
    assert.equal(await tonoPrompt.bloqueDeTonoDeLaClinica("clinica_a"), "");
    assert.equal(await tonoPrompt.bloqueDeTonoDeLaClinica(undefined), "");
  });

  test("tope de 8, no apto clínico, y ajeno = 404", async () => {
    for (let i = 0; i < 8; i++) {
      db.tono.push({ id: `t${i}`, clinicId: "clinica_a", texto: "x", fuenteId: `f${i}`, activo: true, createdAt: new Date() });
    }
    await assert.rejects(
      sv.marcarEjemploDeTono({ clinicId: "clinica_a", userId: "u_a", messageId: respuestaEquipoA.id }),
      (e: any) => e.status === 409,
    );
    const clinico = db.mensajes.find((x) => x.body.startsWith("Tómate ibuprofeno"))!;
    db.tono.length = 0;
    await assert.rejects(
      sv.marcarEjemploDeTono({ clinicId: "clinica_a", userId: "u_a", messageId: clinico.id }),
      (e: any) => e.status === 422 && e.code === "tono_clinico",
    );
    await assert.rejects(
      sv.marcarEjemploDeTono({ clinicId: "clinica_a", userId: "u_a", messageId: mensajeDeB.id }),
      (e: any) => e.status === 404,
    );
    await assert.rejects(sv.quitarEjemploDeTono({ clinicId: "clinica_b", id: "t0" }), (e: any) => e.status === 404);
  });
});
