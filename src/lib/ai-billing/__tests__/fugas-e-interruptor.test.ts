/**
 * Fugas de IA e interruptor por clínica (ws1-t1).
 *
 * Run: npm run test:ia-interruptor
 *
 * Dos cosas, las dos con las rutas DE VERDAD cargadas enteras:
 *
 *  1 · Las cinco rutas que llamaban a Claude sin dejar AiUsageEvent
 *      (weekly-insights, ai-insight, no-shows/predict, clinic-layout/optimize,
 *      homeopatia/suggest-remedies) ahora dejan su fila con el costo real y
 *      billedCents = 0. Quién paga NO cambia: las cuatro del cupo siguen
 *      moviendo aiTokensUsed y el resumen semanal no mueve nada. Y si el
 *      registro falla, la respuesta sale igual.
 *
 *  2 · Con la función apagada NO se llama a la IA. Se cuenta cada `fetch`
 *      que sale del proceso (Anthropic y OpenAI): tiene que ser cero. Esa es
 *      la prueba que importa, no que el botón se vea. El cron lo mira por
 *      clínica, a mitad de corrida.
 *
 * Lo único sustituido: Prisma (un doble en memoria), la sesión, los frenos de
 * gasto (failban/rate-limit), el permiso por pantalla y el monedero (con saldo
 * de sobra, para que nada que no sea el interruptor frene la llamada). Ni una
 * llamada real. Comprobado contra el código de antes: con las rutas viejas
 * fallan las cinco filas de gasto, los diez cortes y el cron por clínica.
 */

import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ── la base en memoria ─────────────────────────────────────────────── */

const RAIZ = path.resolve(__dirname, "../../../..");
type Fila = Record<string, any>;

const CLINICA = "clinica_a";

const db = {
  clinics: [] as Fila[],
  eventos: [] as Fila[],
  cupo: [] as Fila[],
  insights: [] as Fila[],
  citas: [] as Fila[],
  sillones: [] as Fila[],
  archivos: [] as Fila[],
  analisisRx: [] as Fila[],
  /** Si se pone, `aiUsageEvent.create` revienta: el registro falla. */
  eventoRevienta: false,
  /** Cuántas veces se leyó el interruptor (select aiSettings) y de qué clínica. */
  lecturasInterruptor: [] as string[],
};

function proyecta(fila: Fila | undefined, select?: Fila) {
  if (!fila) return null;
  if (!select) return { ...fila };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, fila[k]]));
}

function aplica(fila: Fila, data: Fila) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in v) fila[k] = (fila[k] ?? 0) + v.increment;
    else fila[k] = v;
  }
  return fila;
}

const candados = new Map<string, Promise<void>>();
async function tomaCandado(clave: string): Promise<() => void> {
  while (candados.has(clave)) await candados.get(clave);
  let suelta!: () => void;
  candados.set(clave, new Promise<void>((r) => { suelta = r; }));
  return () => { candados.delete(clave); suelta(); };
}

const prismaDoble: any = new Proxy(
  {
    clinic: {
      findUnique: async ({ where, select }: Fila) => {
        if (select?.aiSettings) db.lecturasInterruptor.push(where.id);
        return proyecta(db.clinics.find((c) => c.id === where.id), select);
      },
      findMany: async ({ select }: Fila = {}) => db.clinics.map((c) => proyecta(c, select)),
      update: async ({ where, data, select }: Fila) => {
        const fila = db.clinics.find((c) => c.id === where.id);
        if (!fila) throw new Error(`update: no existe la clínica ${where.id}`);
        return proyecta(aplica(fila, data), select);
      },
    },
    aiUsageEvent: {
      create: async ({ data }: Fila) => {
        if (db.eventoRevienta) throw new Error("se cayó la base al registrar");
        db.eventos.push({ ...data });
        return { id: `ev_${db.eventos.length}`, ...data };
      },
    },
    aiQuotaUsage: {
      create: async ({ data }: Fila) => {
        db.cupo.push({ ...data });
        return data;
      },
    },
    aiPricingConfig: { findMany: async () => [] },
    weeklyInsight: {
      findFirst: async ({ where }: Fila) =>
        db.insights.find((i) => i.clinicId === where.clinicId && +i.weekStart === +where.weekStart) ?? null,
      create: async ({ data }: Fila) => {
        db.insights.push({ ...data });
        return data;
      },
    },
    appointment: {
      findFirst: async ({ where }: Fila) => db.citas.find((c) => c.id === where.id && c.clinicId === where.clinicId) ?? null,
      findMany: async ({ where }: Fila) => db.citas.filter((c) => c.clinicId === where.clinicId),
    },
    appointmentTimeline: { findMany: async () => [] },
    resource: { findMany: async ({ where }: Fila) => db.sillones.filter((s) => s.clinicId === where.clinicId) },
    noShowPrediction: {
      upsert: async ({ create }: Fila) => ({ ...create, predictedAt: new Date() }),
    },
    patientFile: {
      findFirst: async ({ where }: Fila) => db.archivos.find((f) => f.id === where.id && f.clinicId === where.clinicId) ?? null,
    },
    xrayAnalysis: {
      findUnique: async ({ where }: Fila) => db.analisisRx.find((a) => a.fileId === where.fileId) ?? null,
    },
    // El candado SOLO existe si el código lo pide (`SELECT … FOR UPDATE` toma
    // una cola por clínica que se suelta al acabar la transacción), y dentro de
    // la transacción leer la clínica tarda un poco (barrera). Así, quitando el
    // FOR UPDATE, la prueba de «dos a la vez» falla.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const sueltas: Array<() => void> = [];
      const tx = new Proxy(
        {
          $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
            if (partes.join("?").includes("FOR UPDATE")) sueltas.push(await tomaCandado(String(valores[0])));
            return [];
          },
          clinic: {
            ...prismaDoble.clinic,
            findUnique: async (args: Fila) => {
              const fila = await prismaDoble.clinic.findUnique(args);
              await new Promise((r) => setTimeout(r, 15));
              return fila;
            },
          },
        } as Fila,
        { get: (t, k: string) => (k in t ? t[k] : prismaDoble[k]) },
      );
      try {
        return await fn(tx);
      } finally {
        sueltas.forEach((suelta) => suelta());
      }
    },
  },
  {
    get(t: Fila, k: string) {
      if (k in t) return t[k];
      // Un modelo que la prueba no previó es un error de la prueba, no un «no hay filas».
      throw new Error(`el doble de prisma no tiene «${String(k)}»`);
    },
  },
);

/* ── la sesión y los frenos ─────────────────────────────────────────── */

const sesion = {
  ctx: null as Fila | null,
  user: null as Fila | null,
};
function sesionAdmin() {
  const user = { id: "u_admin", clinicId: CLINICA, role: "ADMIN", permissionsOverride: [] };
  sesion.user = user;
  sesion.ctx = { userId: user.id, clinicId: CLINICA, role: "ADMIN", isAdmin: true, user };
}

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [path.join(RAIZ, "src/lib/auth-context.ts"), {
    getAuthContext: async () => sesion.ctx,
    // Como el de verdad: sin admin, 403.
    requireAdmin: (ctx: Fila | null) =>
      ctx?.isAdmin ? null : Response.json({ error: "Solo administradores" }, { status: 403 }),
  }],
  [path.join(RAIZ, "src/lib/auth.ts"), { getCurrentUser: async () => sesion.user }],
  [path.join(RAIZ, "src/lib/failban.ts"), { persistentRateLimit: async () => null }],
  [path.join(RAIZ, "src/lib/rate-limit.ts"), { rateLimit: () => null }],
  [path.join(RAIZ, "src/lib/auth/require-permission.ts"), { denyIfMissingPermission: () => null }],
  [path.join(RAIZ, "src/lib/patient-visibility.ts"), { assertPatientVisible: async () => null }],
  [path.join(RAIZ, "src/lib/menu-dos-niveles/interruptor.ts"), { menuDosNivelesEncendido: async () => true }],
  [path.join(RAIZ, "src/lib/audit.ts"), { logAudit: async () => {}, extractAuditMeta: () => ({}) }],
  // El monedero con saldo de sobra: así el bot y la redacción web llegarían
  // hasta Claude si nada los parara. Sin esto, la prueba del bot pasaba
  // también con el código viejo (canSpend reventaba contra el doble → null).
  [path.join(RAIZ, "src/lib/ai-billing/wallet.ts"), {
    canSpend: async () => true,
    estimarCostoCents: async () => 1,
    reservarSaldo: async (clinicId: string) => ({ id: "reserva", clinicId, amountCents: 1 }),
    liberarReserva: async () => {},
    chargeUsage: async () => ({ billedCents: 1, balanceAfterCents: 100, eventId: "ev" }),
  }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

/* ── la red: se cuenta TODO lo que sale ─────────────────────────────── */

const red = {
  llamadas: [] as Array<{ url: string; cuerpo: Fila | null }>,
  /** Texto que "contesta" Claude. */
  texto: "{}",
  /** Se ejecuta en cada llamada, antes de contestar (para cambiar la base a media corrida). */
  alLlamar: null as null | ((n: number) => void),
};
const USO = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
  const u = String(url);
  let cuerpo: Fila | null = null;
  try { cuerpo = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { cuerpo = null; }
  red.llamadas.push({ url: u, cuerpo });
  red.alLlamar?.(red.llamadas.length);
  if (!u.startsWith("https://api.anthropic.com/")) throw new Error(`la prueba no esperaba una llamada a ${u}`);
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: red.texto }], usage: USO, model: cuerpo?.model }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
process.env.OPENAI_API_KEY = "sk-prueba-no-es-real";
process.env.CRON_SECRET = "cron_de_prueba";

/* ── las rutas, cargadas DESPUÉS de los dobles ──────────────────────── */

type Handler = (req?: any, extra?: any) => Promise<Response>;
let NextRequestCtor: any;
let rutas: Record<string, Handler>;
let generateAiReply: typeof import("@/lib/whatsapp/bot/ai")["generateAiReply"];
let interruptores: typeof import("@/lib/ai-billing/interruptores");

before(async () => {
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  rutas = {
    weekly: (await import("@/app/api/cron/weekly-insights/route")).GET,
    aiInsight: (await import("@/app/api/analytics/ai-insight/route")).POST,
    noShows: (await import("@/app/api/analytics/no-shows/predict/route")).POST,
    optimize: (await import("@/app/api/clinic-layout/optimize/route")).POST,
    homeopatia: (await import("@/app/api/homeopatia/suggest-remedies/route")).POST,
    chat: (await import("@/app/api/ai/route")).POST,
    xray: (await import("@/app/api/xrays/[id]/analyze/route")).POST,
    dictado: (await import("@/app/api/ai/transcribe/route")).POST,
    consulta: (await import("@/app/api/consult/ai-assist/route")).POST,
    recetas: (await import("@/app/api/prescriptions/check-contraindications/route")).POST,
    paginaWeb: (await import("@/app/api/clinic-landing/autocompletar/route")).POST,
    funcionesGet: (await import("@/app/api/ai-wallet/funciones/route")).GET,
    funcionesPatch: (await import("@/app/api/ai-wallet/funciones/route")).PATCH,
  };
  ({ generateAiReply } = await import("@/lib/whatsapp/bot/ai"));
  interruptores = await import("@/lib/ai-billing/interruptores");
});

function clinica(id: string, extra: Fila = {}): Fila {
  return {
    id,
    name: `Clínica ${id}`,
    aiTokensUsed: 0,
    aiTokensLimit: 1_000_000,
    aiLastResetAt: new Date(),
    aiSettings: null,
    ...extra,
  };
}

beforeEach(() => {
  db.clinics.length = 0;
  db.eventos.length = 0;
  db.cupo.length = 0;
  db.insights.length = 0;
  db.citas.length = 0;
  db.sillones.length = 0;
  db.archivos.length = 0;
  db.analisisRx.length = 0;
  db.eventoRevienta = false;
  db.lecturasInterruptor.length = 0;
  red.llamadas.length = 0;
  red.texto = "{}";
  red.alLlamar = null;
  db.clinics.push(clinica(CLINICA));
  sesionAdmin();
});

function apagar(clinicId: string, ...ids: string[]) {
  const c = db.clinics.find((x) => x.id === clinicId)!;
  c.aiSettings = { apagadas: ids };
}

function post(url: string, body: unknown): any {
  return new NextRequestCtor(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cron(): any {
  return new NextRequestCtor("http://localhost/api/cron/weekly-insights", {
    headers: { authorization: "Bearer cron_de_prueba" },
  });
}

function citaDeHoy(clinicId: string, id = `cita_${clinicId}`): Fila {
  const inicio = new Date(Date.now() + 2 * 86400000);
  inicio.setHours(10, 0, 0, 0);
  return {
    id,
    clinicId,
    status: "COMPLETED",
    type: "Limpieza",
    doctorId: "d1",
    patientId: "p1",
    resourceId: "sillon_1",
    notes: null,
    startsAt: inicio,
    endsAt: new Date(inicio.getTime() + 45 * 60000),
    patient: { firstName: "Ana", lastName: "Pérez", dob: null },
    doctor: { firstName: "Luis", lastName: "Mora" },
  };
}

const JSON_SEMANAL = JSON.stringify({ summary: "Buena semana.", insights: [{ tone: "info", title: "t", detail: "d" }] });

/* ══════════════════════════════════════════════════════════════════════
 * 1 · Las cinco fugas dejan su fila, sin cambiar quién paga
 * ══════════════════════════════════════════════════════════════════════ */

/** Cada caso: cómo llamarla y qué feature/cupo esperar. */
const FUGAS: Array<{
  nombre: string;
  feature: string;
  mueveCupo: boolean;
  preparar: () => void;
  llamar: () => Promise<Response>;
  /** Lo que prueba que la función siguió su camino aunque el registro fallara. */
  entrego: (r: Response, cuerpo: any) => void;
}> = [
  {
    nombre: "cron/weekly-insights",
    feature: "weekly_insights",
    mueveCupo: false,
    preparar: () => {
      db.citas.push(citaDeHoy(CLINICA));
      red.texto = JSON_SEMANAL;
    },
    llamar: () => rutas.weekly(cron()),
    entrego: (_r, c) => {
      assert.equal(c.processed, 1);
      assert.equal(db.insights.length, 1, "el insight de la semana se guardó");
      assert.equal(db.insights[0].summary, "Buena semana.");
    },
  },
  {
    nombre: "analytics/ai-insight",
    feature: "ai_insight",
    mueveCupo: true,
    preparar: () => { red.texto = "El sillón 2 rinde menos."; },
    llamar: () => rutas.aiInsight(post("/api/analytics/ai-insight", { contextData: { a: 1 }, question: "¿qué ves?" })),
    entrego: (_r, c) => assert.equal(c.insight, "El sillón 2 rinde menos."),
  },
  {
    nombre: "analytics/no-shows/predict",
    feature: "no_show_prediction",
    mueveCupo: true,
    preparar: () => {
      db.citas.push(citaDeHoy(CLINICA, "cita_1"));
      red.texto = JSON.stringify({ probability: 0.42, factors: [{ label: "x", weight: 1, reason: "y" }] });
    },
    llamar: () => rutas.noShows(post("/api/analytics/no-shows/predict", { appointmentId: "cita_1" })),
    entrego: (_r, c) => {
      assert.equal(c.probability, 0.42);
      assert.equal(c.aiUsed, true);
    },
  },
  {
    nombre: "clinic-layout/optimize",
    feature: "clinic_layout",
    mueveCupo: true,
    preparar: () => {
      db.citas.push(citaDeHoy(CLINICA));
      db.sillones.push({ id: "sillon_1", clinicId: CLINICA, name: "Sillón 1" });
      red.texto = JSON.stringify({
        optimized: [{ resourceId: "sillon_1", patient: "Ana", treatment: "Limpieza", doctor: "Luis", startHour: 10, startMin: 0, durationMins: 45 }],
        stats: { deadTimeSavedMins: 0, extraPatientsCapacity: 0, efficiency: 100 },
        reasoning: "Ya estaba bien.",
      });
    },
    llamar: () => {
      const d = citaDeHoy(CLINICA).startsAt as Date;
      const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return rutas.optimize(post("/api/clinic-layout/optimize", { date: fecha }));
    },
    entrego: (_r, c) => assert.equal(c.result.reasoning, "Ya estaba bien."),
  },
  {
    nombre: "homeopatia/suggest-remedies",
    feature: "homeopathy",
    mueveCupo: true,
    preparar: () => {
      red.texto = JSON.stringify({ remedies: [{ name: "Nux-v.", score: 90, potency: "30CH", rationale: "irritable" }] });
    },
    llamar: () => rutas.homeopatia(post("/api/homeopatia/suggest-remedies", { symptoms: ["irritable"] })),
    entrego: (_r, c) => assert.equal(c.remedies[0].name, "Nux-v."),
  },
];

for (const f of FUGAS) {
  test(`${f.nombre}: deja UNA fila en ai_usage_events con el costo real y billedCents 0`, async () => {
    f.preparar();
    const res = await f.llamar();
    const cuerpo = await res.json();
    assert.equal(res.status, 200, JSON.stringify(cuerpo));
    f.entrego(res, cuerpo);

    assert.equal(red.llamadas.length, 1, "una llamada a Claude");
    assert.equal(db.eventos.length, 1, "una fila de gasto");
    const ev = db.eventos[0];
    assert.equal(ev.clinicId, CLINICA);
    assert.equal(ev.feature, f.feature);
    assert.equal(ev.billedCents, 0, "no se le cobra nada a la clínica");
    assert.equal(ev.inputTokens, USO.input_tokens);
    assert.equal(ev.outputTokens, USO.output_tokens);
    assert.ok(ev.costUsdMicros > 0, "el costo real queda registrado");
    // El modelo registrado es el que se mandó: el costo sale de SU precio.
    assert.equal(ev.model, red.llamadas[0].cuerpo?.model);

    // Quién paga NO cambió.
    const usados = db.clinics[0].aiTokensUsed;
    if (f.mueveCupo) {
      assert.equal(usados, USO.input_tokens + USO.output_tokens, "sigue descontando del cupo como antes");
      assert.equal(db.cupo.length, 1);
      assert.equal(db.cupo[0].feature, f.feature, "el desglose del cupo usa el mismo slug");
    } else {
      assert.equal(usados, 0, "el resumen semanal no descuenta del cupo, igual que antes");
      assert.equal(db.cupo.length, 0);
    }
  });

  test(`${f.nombre}: si el registro falla, la función responde igual`, async () => {
    f.preparar();
    db.eventoRevienta = true;
    const res = await f.llamar();
    const cuerpo = await res.json();
    assert.equal(res.status, 200, JSON.stringify(cuerpo));
    f.entrego(res, cuerpo);
    assert.equal(db.eventos.length, 0);
  });
}

test("una llamada mock (sin ANTHROPIC_API_KEY) no deja fila: no hubo gasto", async () => {
  const clave = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = await rutas.aiInsight(post("/api/analytics/ai-insight", { contextData: { a: 1 }, question: "¿qué ves?" }));
    assert.equal(res.status, 200);
    assert.equal(red.llamadas.length, 0);
    assert.equal(db.eventos.length, 0);
  } finally {
    process.env.ANTHROPIC_API_KEY = clave;
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · Apagada = no se llama a la IA
 * ══════════════════════════════════════════════════════════════════════ */

/** Las rutas que CORTAN con 403 cuando la clínica apagó su función. */
const CORTAN: Array<{ id: string; llamar: () => Promise<Response>; preparar?: () => void }> = [
  { id: "ai_insight", llamar: () => rutas.aiInsight(post("/api/analytics/ai-insight", { contextData: { a: 1 }, question: "¿?" })) },
  {
    id: "clinic_layout",
    preparar: () => {
      db.citas.push(citaDeHoy(CLINICA));
      db.sillones.push({ id: "sillon_1", clinicId: CLINICA, name: "Sillón 1" });
    },
    llamar: () => rutas.optimize(post("/api/clinic-layout/optimize", {})),
  },
  { id: "homeopathy", llamar: () => rutas.homeopatia(post("/api/homeopatia/suggest-remedies", { symptoms: ["x"] })) },
  { id: "chat", llamar: () => rutas.chat(post("/api/ai", { messages: [{ role: "user", content: "hola" }] })) },
  {
    id: "xray_analysis",
    preparar: () => { db.archivos.push({ id: "f1", clinicId: CLINICA, patientId: null, mimeType: "image/png" }); },
    llamar: () => rutas.xray(post("/api/xrays/f1/analyze", {}), { params: { id: "f1" } }),
  },
  {
    id: "dictation",
    llamar: () => {
      const form = new FormData();
      form.append("audio", new Blob([new Uint8Array(2000)], { type: "audio/webm" }), "a.webm");
      return rutas.dictado(new NextRequestCtor("http://localhost/api/ai/transcribe", { method: "POST", body: form }));
    },
  },
  { id: "consult_assist", llamar: () => rutas.consulta(post("/api/consult/ai-assist", { patientId: "p1" })) },
  {
    id: "contraindications",
    llamar: () => rutas.recetas(post("/api/prescriptions/check-contraindications", { patientId: "p1", items: [{ cumsKey: "k", name: "x" }] })),
  },
  { id: "landing_copy", llamar: () => rutas.paginaWeb(post("/api/clinic-landing/autocompletar", { servicios: [] })) },
];

for (const c of CORTAN) {
  test(`${c.id} apagada: 403 con el motivo y CERO llamadas a la IA`, async () => {
    c.preparar?.();
    apagar(CLINICA, c.id);
    const res = await c.llamar();
    const cuerpo = await res.json();
    assert.equal(res.status, 403, JSON.stringify(cuerpo));
    assert.equal(cuerpo.funcionApagada, c.id);
    assert.match(cuerpo.error, /Saldo de IA/, "el mensaje dice dónde se enciende");
    assert.equal(red.llamadas.length, 0, "no salió ni una llamada a la red");
    assert.equal(db.eventos.length, 0);
    assert.equal(db.clinics[0].aiTokensUsed, 0, "no se tocó el cupo");
  });
}

test("radiografías apagada: el análisis YA guardado se sigue entregando (no llama a la IA ni cuesta)", async () => {
  db.archivos.push({ id: "f1", clinicId: CLINICA, patientId: null, mimeType: "image/png" });
  db.analisisRx.push({
    fileId: "f1", mode: "GENERAL", summary: "Sin hallazgos.", findings: [], recommendations: [], measurements: null,
    severity: "none", confidence: 0.9, tokensUsed: 1200, modelUsed: "claude-sonnet-4-6", createdAt: new Date(),
  });
  apagar(CLINICA, "xray_analysis");
  const res = await rutas.xray(post("/api/xrays/f1/analyze", {}), { params: { id: "f1" } });
  const cuerpo = await res.json();
  assert.equal(res.status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.cached, true);
  assert.equal(red.llamadas.length, 0);
});

test("apagar UNA función no apaga las demás", async () => {
  apagar(CLINICA, "chat", "sabina", "weekly_insights");
  red.texto = "Todo en orden.";
  const res = await rutas.aiInsight(post("/api/analytics/ai-insight", { contextData: { a: 1 }, question: "¿?" }));
  assert.equal(res.status, 200);
  assert.equal(red.llamadas.length, 1);
});

test("no-shows apagada: la predicción sale de la heurística, sin llamar a Claude ni mirar el cupo", async () => {
  db.citas.push(citaDeHoy(CLINICA, "cita_1"));
  apagar(CLINICA, "no_show_prediction");
  // Cupo agotado: con la IA encendida esto daría 429; apagada no se mira.
  db.clinics[0].aiTokensUsed = db.clinics[0].aiTokensLimit;
  const res = await rutas.noShows(post("/api/analytics/no-shows/predict", { appointmentId: "cita_1" }));
  const cuerpo = await res.json();
  assert.equal(res.status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.aiUsed, false);
  assert.equal(cuerpo.aiDisabled, true);
  assert.ok(cuerpo.probability > 0 && cuerpo.probability < 1);
  assert.equal(red.llamadas.length, 0);
  assert.equal(db.eventos.length, 0);
  assert.equal(db.cupo.length, 0);
});

function preguntarAlBot() {
  return generateAiReply(
    { clinicId: CLINICA, threadId: "t1", incomingText: "¿Tienen estacionamiento?", history: [], patient: null } as any,
    { botName: "Asistente" } as any,
    [],
  );
}

test("bot de WhatsApp encendido (control): con saldo, sí llama a Claude y contesta", async () => {
  red.texto = "Sí, frente a la clínica.";
  const r = await preguntarAlBot();
  assert.equal(r?.reply, "Sí, frente a la clínica.");
  assert.equal(red.llamadas.length, 1);
});

test("bot de WhatsApp con la respuesta libre apagada: deriva a una persona sin llamar a Claude", async () => {
  apagar(CLINICA, "whatsapp_bot");
  red.texto = "Sí, frente a la clínica.";
  const r = await preguntarAlBot();
  assert.equal(r, null, "null = el motor hace handoff");
  assert.equal(red.llamadas.length, 0);
});

test("cron semanal: el interruptor se lee POR CLÍNICA y a mitad de corrida, no una vez al arrancar", async () => {
  // Seis clínicas con citas; el cron procesa de 5 en 5. La sexta la apagan
  // mientras el primer lote todavía está llamando a Claude.
  db.clinics.length = 0;
  for (let i = 1; i <= 6; i++) {
    db.clinics.push(clinica(`c${i}`));
    db.citas.push(citaDeHoy(`c${i}`));
  }
  apagar("c2", "weekly_insights"); // apagada desde antes
  red.texto = JSON_SEMANAL;
  red.alLlamar = (n) => { if (n === 1) apagar("c6", "weekly_insights"); };

  const res = await rutas.weekly(cron());
  const cuerpo = await res.json();
  assert.equal(res.status, 200);

  const llamadasPorClinica = db.eventos.map((e) => e.clinicId).sort();
  assert.deepEqual(llamadasPorClinica, ["c1", "c3", "c4", "c5"], "solo las encendidas gastan");
  assert.equal(red.llamadas.length, 4);
  assert.equal(cuerpo.processed, 4);
  assert.equal(cuerpo.disabled, 2);
  assert.deepEqual(db.insights.map((i) => i.clinicId).sort(), ["c1", "c3", "c4", "c5"], "apagada = sin resumen");
  assert.deepEqual([...db.lecturasInterruptor].sort(), ["c1", "c2", "c3", "c4", "c5", "c6"], "una lectura por clínica");
});

test("si no se puede leer el interruptor, la función sigue ENCENDIDA (como antes del despliegue)", async () => {
  const original = prismaDoble.clinic.findUnique;
  prismaDoble.clinic.findUnique = async (args: Fila) => {
    if (args.select?.aiSettings) throw new Error('column "aiSettings" does not exist');
    return original(args);
  };
  try {
    red.texto = "ok";
    const res = await rutas.aiInsight(post("/api/analytics/ai-insight", { contextData: { a: 1 }, question: "¿?" }));
    assert.equal(res.status, 200);
    assert.equal(red.llamadas.length, 1);
  } finally {
    prismaDoble.clinic.findUnique = original;
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · La config: todo encendido de fábrica, y solo lo apagado se guarda
 * ══════════════════════════════════════════════════════════════════════ */

test("sanitizeAiSettings: sin config, basura o ids desconocidos → TODO encendido", () => {
  const { sanitizeAiSettings, funcionIaEncendida, FUNCIONES_IA } = interruptores;
  for (const crudo of [null, undefined, "x", 3, [], {}, { apagadas: "chat" }, { apagadas: [1, null, "no_existe"] }]) {
    assert.deepEqual(sanitizeAiSettings(crudo), { apagadas: [] }, JSON.stringify(crudo));
    for (const f of FUNCIONES_IA) assert.equal(funcionIaEncendida(crudo, f.id), true, `${f.id} con ${JSON.stringify(crudo)}`);
  }
  // Repetidos se juntan, desconocidos se tiran, el orden es el del catálogo.
  assert.deepEqual(sanitizeAiSettings({ apagadas: ["weekly_insights", "sabina", "sabina", "zzz"] }), {
    apagadas: ["sabina", "weekly_insights"],
  });
});

test("el catálogo trae al menos lo que pidió Rafael, y cada una dice qué gasta", () => {
  const ids = interruptores.FUNCIONES_IA.map((f) => f.id);
  for (const minimo of [
    "weekly_insights", "ai_insight", "no_show_prediction", "clinic_layout", "homeopathy",
    "sabina", "whatsapp_bot", "landing_copy",
  ]) {
    assert.ok(ids.includes(minimo as any), `falta ${minimo}`);
  }
  assert.equal(new Set(ids).size, ids.length, "ids repetidos");
  for (const f of interruptores.FUNCIONES_IA) {
    assert.ok(["saldo", "cupo", "ninguno"].includes(f.gasta), f.id);
    assert.ok(f.siLaApagas.length > 10, `${f.id}: no dice qué se pierde`);
  }
});

test("PATCH /api/ai-wallet/funciones cambia UNA función y deja las demás; GET la devuelve", async () => {
  apagar(CLINICA, "sabina");
  let res = await rutas.funcionesPatch(
    new NextRequestCtor("http://localhost/api/ai-wallet/funciones", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ funcion: "weekly_insights", encendida: false }),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(db.clinics[0].aiSettings, { apagadas: ["sabina", "weekly_insights"] });

  res = await rutas.funcionesPatch(
    new NextRequestCtor("http://localhost/api/ai-wallet/funciones", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ funcion: "sabina", encendida: true }),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(db.clinics[0].aiSettings, { apagadas: ["weekly_insights"] });

  res = await rutas.funcionesGet();
  assert.deepEqual((await res.json()).apagadas, ["weekly_insights"]);

  // Dos administradores a la vez, cada uno una función distinta: las dos quedan
  // apagadas. Sin el FOR UPDATE, el segundo en escribir encendía la del primero.
  const patch = (funcion: string) =>
    rutas.funcionesPatch(
      new NextRequestCtor("http://localhost/api/ai-wallet/funciones", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funcion, encendida: false }),
      }),
    );
  const [r1, r2] = await Promise.all([patch("chat"), patch("dictation")]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(db.clinics[0].aiSettings, { apagadas: ["chat", "dictation", "weekly_insights"] });
  db.clinics[0].aiSettings = { apagadas: ["weekly_insights"] };

  // Sin ser administrador no se cambia nada.
  sesion.ctx = { ...sesion.ctx!, isAdmin: false, role: "DOCTOR" };
  res = await rutas.funcionesPatch(
    new NextRequestCtor("http://localhost/api/ai-wallet/funciones", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ funcion: "weekly_insights", encendida: true }),
    }),
  );
  assert.equal(res.status, 403);
  assert.deepEqual(db.clinics[0].aiSettings, { apagadas: ["weekly_insights"] });
  sesionAdmin();

  // Una función que no existe no se guarda.
  res = await rutas.funcionesPatch(
    new NextRequestCtor("http://localhost/api/ai-wallet/funciones", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ funcion: "todo", encendida: false }),
    }),
  );
  assert.equal(res.status, 400);
  assert.deepEqual(db.clinics[0].aiSettings, { apagadas: ["weekly_insights"] });
});
