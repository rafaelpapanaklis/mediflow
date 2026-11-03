/**
 * Seguridad ola 2b · v2 (DECISIÓN 5 de Rafael) — las rutas hermanas de IA
 * RESERVAN el cupo del plan antes de llamar, como ai-insight y el dictado.
 *
 * Todas leían el contador antes de llamar y cobraban DESPUÉS: una ráfaga a la
 * vez entraba entera aunque solo cupieran unas pocas. Para cada ruta:
 *   1. se calibra lo que cuesta UNA llamada (el proveedor de mentira cobra
 *      tokens realistas: entrada a ~3,5 caracteres por token + la salida
 *      máxima),
 *   2. se deja un cupo de ~3,5 llamadas y se lanzan 10 a la vez,
 *   3. no se puede gastar más que el cupo, y alguna tiene que pasar.
 *
 * Fuera (las toca feat/seg-archivos-permisos; van después de la unión):
 * consult/ai-assist y xrays/[id]/analyze.
 *
 * Run: npm run test:seg-ola2b
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const RAIZ = process.cwd();
process.env.ANTHROPIC_API_KEY = "sk-de-prueba";

const clinica = { id: "c1", aiTokensUsed: 0, aiTokensLimit: 10_000_000, aiLastResetAt: new Date() };
let llamadas = 0;
let pendientes: Array<() => void> = [];
let soltarYa = false;

function cumple(v: number, cond: any): boolean {
  if (typeof cond === "number") return v === cond;
  if (cond.lte !== undefined && !(v <= cond.lte)) return false;
  if (cond.gte !== undefined && !(v >= cond.gte)) return false;
  return true;
}
function aplicar(data: any) {
  for (const [k, v] of Object.entries<any>(data)) {
    if (v && typeof v === "object" && "increment" in v) (clinica as any)[k] += v.increment;
    else if (v && typeof v === "object" && "decrement" in v) (clinica as any)[k] -= v.decrement;
    else (clinica as any)[k] = v;
  }
}
const HOY = new Date();
const prismaFalso: any = {
  clinic: {
    findUnique: async () => ({ ...clinica }),
    update: async ({ data }: any) => { aplicar(data); return { ...clinica }; },
    updateMany: async ({ where, data }: any) => {
      if (where.aiTokensUsed !== undefined && !cumple(clinica.aiTokensUsed, where.aiTokensUsed)) return { count: 0 };
      aplicar(data);
      return { count: 1 };
    },
  },
  aiQuotaUsage: { create: async ({ data }: any) => data },
  patient: {
    findFirst: async () => ({ dob: null, gender: "F", isChild: false, allergies: [], chronicConditions: [], currentMedications: [] }),
  },
  prescriptionAiCheck: { findFirst: async () => null, create: async () => ({}) },
  appointment: {
    findFirst: async () => ({ id: "apt1", type: "Limpieza", startsAt: new Date(HOY.getTime() + 86400000), patientId: "p1", patient: { firstName: "Ana", lastName: "P", dob: null } }),
    findMany: async ({ where }: any) => (where.startsAt?.gte
      ? [{ id: "a1", resourceId: "s1", startsAt: new Date(`${HOY.toISOString().slice(0, 10)}T10:00:00`), endsAt: new Date(`${HOY.toISOString().slice(0, 10)}T10:30:00`), type: "Limpieza", notes: null, patient: { firstName: "Ana", lastName: "P" }, doctor: { firstName: "Dr", lastName: "X" } }]
      : []),
  },
  resource: { findMany: async () => [{ id: "s1", name: "Sillón 1" }] },
  noShowPrediction: { upsert: async ({ create }: any) => ({ id: "np1", predictedAt: new Date(), ...create }) },
};

/** Tokens «reales» de una llamada: la entrada a ~3,5 caracteres por token y toda la salida. */
function tokensDe(caracteres: number, salida: number) {
  return { entrada: Math.ceil(caracteres / 3.5), salida };
}
function esperarTurno<T>(valor: () => T): Promise<T> {
  llamadas++;
  if (soltarYa) return Promise.resolve(valor());
  return new Promise((resolve) => pendientes.push(() => resolve(valor())));
}

const ctx = { userId: "u_admin", clinicId: "c1", role: "ADMIN", permissionsOverride: [], clinicCategory: "DENTAL", isDoctor: true,
  user: { id: "u_admin", clinicId: "c1", role: "ADMIN", permissionsOverride: [] } };

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaFalso }],
  [path.join(RAIZ, "src/lib/auth-context.ts"), { getAuthContext: async () => ctx }],
  [path.join(RAIZ, "src/lib/auth.ts"), { getCurrentUser: async () => ({ id: "u_admin", clinicId: "c1", role: "ADMIN" }) }],
  [path.join(RAIZ, "src/lib/failban.ts"), { persistentRateLimit: async () => null }],
  [path.join(RAIZ, "src/lib/ai-billing/interruptores.server.ts"), { cortarSiIaApagada: async () => null, funcionIaApagada: async () => false }],
  [path.join(RAIZ, "src/lib/auth/guardia-clinica.ts"), { denyIfNotClinical: () => null }],
  [path.join(RAIZ, "src/lib/auth/require-permission.ts"), { denyIfMissingPermission: () => null, denyIfMissingAnyPermission: () => null }],
  [path.join(RAIZ, "src/lib/patient-visibility.ts"), { assertPatientVisible: async () => null }],
  [path.join(RAIZ, "src/lib/ai-billing/record-usage.ts"), { recordUsageNoCharge: async () => {} }],
  [path.join(RAIZ, "src/lib/ai-tokens-owner.ts"), { tokensDeLasOtrasSedes: async () => ({ tokens: 0, sedes: 1 }) }],
  [path.join(RAIZ, "src/lib/integrations/claude.ts"), {
    chat: (input: any) => {
      const caracteres = JSON.stringify(input.system ?? "").length + JSON.stringify(input.messages ?? []).length;
      const t = tokensDe(caracteres, input.maxTokens ?? 1024);
      return esperarTurno(() => ({ text: "{}", inputTokens: t.entrada, outputTokens: t.salida }));
    },
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

// Anthropic por fetch (las rutas que lo llaman directo).
(globalThis as any).fetch = async (url: string, init: any) => {
  assert.match(String(url), /api\.anthropic\.com/);
  const body = JSON.parse(init.body);
  const caracteres = JSON.stringify(body.system ?? "").length + JSON.stringify(body.messages ?? []).length + JSON.stringify(body.tools ?? "").length;
  const t = tokensDe(caracteres, body.max_tokens ?? 1024);
  return esperarTurno(() => ({
    ok: true,
    json: async () => ({ usage: { input_tokens: t.entrada, output_tokens: t.salida }, content: [{ type: "text", text: "{\"remedies\":[]}" }] }),
  }));
};

let NextRequestCtor: any;
before(async () => {
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
});
beforeEach(() => {
  clinica.aiTokensUsed = 0;
  clinica.aiTokensLimit = 10_000_000;
  llamadas = 0;
  pendientes = [];
  soltarYa = false;
});

const GRANDE = "x".repeat(60_000);

const RUTAS: Array<{ nombre: string; modulo: string; url: string; cuerpo: () => unknown }> = [
  { nombre: "/api/ai (chat)", modulo: "@/app/api/ai/route", url: "/api/ai", cuerpo: () => ({ message: GRANDE }) },
  { nombre: "check-contraindications", modulo: "@/app/api/prescriptions/check-contraindications/route", url: "/api/prescriptions/check-contraindications",
    cuerpo: () => ({ patientId: "p1", items: [{ name: `Amoxicilina ${GRANDE}`, dosage: "500 mg" }] }) },
  { nombre: "homeopatía", modulo: "@/app/api/homeopatia/suggest-remedies/route", url: "/api/homeopatia/suggest-remedies", cuerpo: () => ({ symptoms: [GRANDE] }) },
  { nombre: "no-shows/predict", modulo: "@/app/api/analytics/no-shows/predict/route", url: "/api/analytics/no-shows/predict", cuerpo: () => ({ appointmentId: "apt1" }) },
  { nombre: "clinic-layout/optimize", modulo: "@/app/api/clinic-layout/optimize/route", url: "/api/clinic-layout/optimize", cuerpo: () => ({}) },
];

async function pedir(r: (typeof RUTAS)[number]): Promise<Response> {
  const { POST } = await import(r.modulo);
  return POST(new NextRequestCtor(`http://localhost${r.url}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r.cuerpo()),
  }));
}

for (const r of RUTAS) {
  test(`🔴 ${r.nombre}: una ráfaga de 10 no gasta más que el cupo del plan`, async () => {
    // 1) Calibración: lo que cuesta UNA llamada.
    soltarYa = true;
    const una = await pedir(r);
    assert.equal(una.status, 200, `calibración: ${await una.text()}`);
    const porLlamada = clinica.aiTokensUsed;
    assert.ok(porLlamada > 0, "la llamada cobra al cupo");

    // 2) Cupo para ~3,5 llamadas; 10 a la vez.
    clinica.aiTokensUsed = 0;
    clinica.aiTokensLimit = Math.floor(porLlamada * 3.5);
    llamadas = 0;
    soltarYa = false;
    let respondidas = 0;
    const vuelos = Array.from({ length: 10 }, () => pedir(r).then((x) => { respondidas++; return x; }));
    for (let i = 0; i < 3000 && llamadas + respondidas < 10; i++) await new Promise((res) => setImmediate(res));
    assert.equal(llamadas + respondidas, 10, "todas llegaron al proveedor o ya respondieron");
    for (const p of pendientes) p();
    const rs = await Promise.all(vuelos);

    // 3) Nada por encima del cupo, y lo legítimo que cabe sigue pasando.
    assert.ok(llamadas >= 1, "al menos una cabe");
    assert.ok(clinica.aiTokensUsed <= clinica.aiTokensLimit, `${r.nombre}: contador ${clinica.aiTokensUsed} > cupo ${clinica.aiTokensLimit} (${llamadas} llamadas)`);
    assert.equal(clinica.aiTokensUsed, llamadas * porLlamada, "el contador queda en lo REAL de lo que se llamó");
    for (const x of rs) assert.ok(x.status === 200 || x.status === 429, `status ${x.status}`);
  });

  test(`${r.nombre}: si el proveedor falla, la reserva se suelta`, async () => {
    const fetchBueno = (globalThis as any).fetch;
    const chatBueno = (dobles.get(path.join(RAIZ, "src/lib/integrations/claude.ts")) as any).chat;
    (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({ error: { message: "overloaded" } }) });
    (dobles.get(path.join(RAIZ, "src/lib/integrations/claude.ts")) as any).chat = async () => ({ text: "", error: "overloaded" });
    try {
      const x = await pedir(r);
      assert.ok(x.status >= 200, String(x.status));
      assert.equal(clinica.aiTokensUsed, 0, `${r.nombre}: quedó reservado ${clinica.aiTokensUsed}`);
    } finally {
      (globalThis as any).fetch = fetchBueno;
      (dobles.get(path.join(RAIZ, "src/lib/integrations/claude.ts")) as any).chat = chatBueno;
    }
  });
}
