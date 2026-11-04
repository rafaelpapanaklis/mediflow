/**
 * Seguridad ola 2b · lead 18 — el cupo de IA del plan se RESERVA antes de
 * llamar a Anthropic, no solo se lee.
 *
 * POST /api/analytics/ai-insight leía el contador (aiTokenLimitError) y cobraba
 * DESPUÉS de la respuesta (addAiTokens). Todas las peticiones que pasaban la
 * lectura antes de que la primera cobrara entraban: una ráfaga concurrente de
 * un admin (incluida una prueba gratis) gastaba muy por encima de
 * aiTokensLimit con la llave de DaleControl.
 *
 * Arreglo (como reservarSaldo del monedero): antes de llamar se aparta el techo
 * de la llamada (entrada a 2 caracteres por token + maxTokens) con un UPDATE
 * condicionado; al volver se ajusta a lo real; si falla, se suelta.
 *
 * Run: npm run test:seg-ola2b
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const RAIZ = process.cwd();
const LIMITE = 1_000_000;

const clinica = { id: "c1", aiTokensUsed: 0, aiTokensLimit: LIMITE, aiLastResetAt: new Date() };
const desglose: Array<{ tokens: number; feature: string }> = [];
let llamadasChat = 0;
let pendientes: Array<() => void> = [];
let respuesta: { text: string; inputTokens?: number; outputTokens?: number; error?: string } = { text: "ok", inputTokens: 100, outputTokens: 50 };

function cumple(v: number, cond: any): boolean {
  if (typeof cond === "number") return v === cond;
  if (cond.lte !== undefined && !(v <= cond.lte)) return false;
  if (cond.gte !== undefined && !(v >= cond.gte)) return false;
  if (cond.lt !== undefined && !(v < cond.lt)) return false;
  return true;
}
function aplicar(data: any) {
  for (const [k, v] of Object.entries<any>(data)) {
    if (v && typeof v === "object" && "increment" in v) (clinica as any)[k] += v.increment;
    else if (v && typeof v === "object" && "decrement" in v) (clinica as any)[k] -= v.decrement;
    else (clinica as any)[k] = v;
  }
}
const prismaFalso = {
  clinic: {
    findUnique: async ({ where }: any) => (where.id === clinica.id ? { ...clinica } : null),
    update: async ({ where, data }: any) => { assert.equal(where.id, clinica.id); aplicar(data); return { ...clinica }; },
    updateMany: async ({ where, data }: any) => {
      if (where.id !== clinica.id) return { count: 0 };
      if (where.aiTokensUsed !== undefined && !cumple(clinica.aiTokensUsed, where.aiTokensUsed)) return { count: 0 };
      aplicar(data);
      return { count: 1 };
    },
  },
  aiQuotaUsage: { create: async ({ data }: any) => { desglose.push({ tokens: data.tokens, feature: data.feature }); return data; } },
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaFalso }],
  [path.join(RAIZ, "src/lib/auth.ts"), { getCurrentUser: async () => ({ id: "u_admin", clinicId: "c1", role: "ADMIN" }) }],
  [path.join(RAIZ, "src/lib/ai-tokens-owner.ts"), { tokensDeLasOtrasSedes: async () => ({ tokens: 0, sedes: 1 }) }],
  [path.join(RAIZ, "src/lib/ai-billing/interruptores.server.ts"), { cortarSiIaApagada: async () => null }],
  [path.join(RAIZ, "src/lib/ai-billing/record-usage.ts"), { recordUsageNoCharge: async () => {} }],
  [path.join(RAIZ, "src/lib/integrations/claude.ts"), {
    chat: () => {
      llamadasChat++;
      return new Promise((resolve) => pendientes.push(() => resolve({ ...respuesta })));
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

let POST: (req: any) => Promise<Response>;
let NextRequestCtor: any;
before(async () => {
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  ({ POST } = await import("@/app/api/analytics/ai-insight/route"));
});
beforeEach(() => {
  clinica.aiTokensUsed = 0;
  clinica.aiLastResetAt = new Date();
  desglose.length = 0;
  llamadasChat = 0;
  pendientes = [];
  respuesta = { text: "ok", inputTokens: 100, outputTokens: 50 };
});

function pedir(contextData: unknown) {
  return POST(new NextRequestCtor("http://localhost/api/analytics/ai-insight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contextData, question: "¿qué ves?" }),
  }));
}

/** Lanza N a la vez, espera a que TODAS lleguen a Anthropic o respondan, y luego suelta a Anthropic. */
async function rafaga(n: number, contextData: unknown) {
  let respondidas = 0;
  const vuelos = Array.from({ length: n }, () => pedir(contextData).then((r) => { respondidas++; return r; }));
  for (let i = 0; i < 2000 && llamadasChat + respondidas < n; i++) await new Promise((r) => setImmediate(r));
  assert.equal(llamadasChat + respondidas, n, "todas llegaron a Anthropic o ya respondieron");
  for (const p of pendientes) p();
  return Promise.all(vuelos);
}

// ~380 000 caracteres: ~190 000 tokens de techo de entrada.
const GRANDE = { filas: "x".repeat(380_000) };

test("🔴 una ráfaga de 20 peticiones grandes no gasta por encima del cupo del plan", async () => {
  respuesta = { text: "ok", inputTokens: 120_000, outputTokens: 400 };
  const rs = await rafaga(20, GRANDE);
  const ok = rs.filter((r) => r.status === 200).length;
  assert.ok(ok >= 1, "el uso legítimo que cabe sigue pasando");
  assert.equal(llamadasChat, ok, "solo llega a Anthropic lo que se admitió");
  assert.ok(llamadasChat * 120_400 <= LIMITE, `gastó ${llamadasChat * 120_400} tokens con un cupo de ${LIMITE}`);
  assert.ok(clinica.aiTokensUsed <= LIMITE, `contador ${clinica.aiTokensUsed} > ${LIMITE}`);
  assert.equal(clinica.aiTokensUsed, ok * 120_400, "el contador queda en lo REAL de lo admitido");
  for (const r of rs.filter((x) => x.status !== 200)) assert.equal(r.status, 429);
});

test("🔴 con el cupo casi agotado, una petición enorme ya no pasa", async () => {
  clinica.aiTokensUsed = LIMITE - 1000;
  respuesta = { text: "ok", inputTokens: 120_000, outputTokens: 400 };
  const [r] = await rafaga(1, GRANDE);
  assert.equal(r.status, 429);
  assert.equal(llamadasChat, 0);
  assert.equal(clinica.aiTokensUsed, LIMITE - 1000);
});

test("uso normal: pasa y el contador y el desglose quedan en lo real", async () => {
  const [r] = await rafaga(1, { citas: 12, noShows: 3 });
  assert.equal(r.status, 200);
  assert.equal(clinica.aiTokensUsed, 150);
  assert.deepEqual(desglose, [{ tokens: 150, feature: "ai_insight" }]);
});

test("si Anthropic falla, la reserva se suelta y no se cobra nada", async () => {
  respuesta = { text: "", error: "overloaded" };
  const [r] = await rafaga(1, { citas: 12 });
  assert.equal(r.status, 502);
  assert.equal(clinica.aiTokensUsed, 0);
  assert.equal(desglose.length, 0);
});

test("plan sin IA (límite 0): 429 sin llamar, como siempre", async () => {
  clinica.aiTokensLimit = 0;
  try {
    const [r] = await rafaga(1, { citas: 1 });
    assert.equal(r.status, 429);
    assert.equal(llamadasChat, 0);
  } finally {
    clinica.aiTokensLimit = LIMITE;
  }
});
