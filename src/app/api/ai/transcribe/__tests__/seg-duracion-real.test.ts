/**
 * Seguridad ola 2b · lead 19 — el dictado cobra la duración REAL del audio.
 *
 * POST /api/ai/transcribe acepta hasta 4 MiB de audio sin tope de duración en
 * el servidor (los 60 s viven solo en la grabadora del navegador), lo manda
 * entero a Whisper —que DaleControl paga por minuto— y cobraba al cupo como
 * MÁXIMO 60 s (2 000 tokens). Llamando a la API directo, una hora de audio a
 * bajo bitrate costaba al cupo lo mismo que un minuto.
 *
 * Arreglo: se cobra la duración que devuelve Whisper (sin el tope de 60 s), y
 * el cupo se reserva antes de llamar (lead 18) por lo que cuesta una
 * grabación normal.
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
const desglose: number[] = [];
let duracionWhisper: number | undefined = 3600;
let llamadasWhisper = 0;

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
const prismaFalso = {
  clinic: {
    findUnique: async () => ({ ...clinica }),
    update: async ({ data }: any) => { aplicar(data); return { ...clinica }; },
    updateMany: async ({ where, data }: any) => {
      if (where.aiTokensUsed !== undefined && !cumple(clinica.aiTokensUsed, where.aiTokensUsed)) return { count: 0 };
      aplicar(data);
      return { count: 1 };
    },
  },
  aiQuotaUsage: { create: async ({ data }: any) => { desglose.push(data.tokens); return data; } },
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/auth-context.ts"), { getAuthContext: async () => ({ userId: "u1", clinicId: "c1", role: "DOCTOR", permissionsOverride: [] }) }],
  [path.join(RAIZ, "src/lib/rate-limit.ts"), { rateLimit: () => null }],
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaFalso }],
  [path.join(RAIZ, "src/lib/ai-tokens-owner.ts"), { tokensDeLasOtrasSedes: async () => ({ tokens: 0, sedes: 1 }) }],
  [path.join(RAIZ, "src/lib/ai-billing/interruptores.server.ts"), { cortarSiIaApagada: async () => null }],
  [path.join(RAIZ, "src/lib/integrations/whisper.ts"), {
    transcribeAudio: async () => { llamadasWhisper++; return { text: " nota ", duration: duracionWhisper }; },
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
  ({ POST } = await import("@/app/api/ai/transcribe/route"));
});
beforeEach(() => {
  clinica.aiTokensUsed = 0;
  clinica.aiTokensLimit = LIMITE;
  desglose.length = 0;
  llamadasWhisper = 0;
});

async function dictar(bytes = 4 * 1024 * 1024 - 1) {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type: "audio/webm" }), "a.webm");
  const r = await POST(new NextRequestCtor("http://localhost/api/ai/transcribe", { method: "POST", body: form }));
  return { status: r.status, body: await r.json() };
}

test("🔴 una hora de audio cobra una hora (120 000 tokens), no 60 s", async () => {
  duracionWhisper = 3600;
  const r = await dictar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tokensCharged, 120_000);
  assert.equal(clinica.aiTokensUsed, 120_000, "el contador queda en lo real");
  assert.deepEqual(desglose, [120_000]);
});

test("una grabación normal (25 s) cobra lo de siempre", async () => {
  duracionWhisper = 25;
  const r = await dictar(200_000);
  assert.equal(r.status, 200);
  assert.equal(r.body.tokensCharged, 833);
  assert.equal(clinica.aiTokensUsed, 833);
});

test("sin duración de Whisper se estima por tamaño, tampoco con el tope de 60 s", async () => {
  duracionWhisper = undefined;
  const r = await dictar(8 * 1024 * 120); // 120 s al bitrate nominal (8 KB/s)
  assert.equal(r.body.tokensCharged, 4000);
});

test("sin cupo para una grabación: 429 sin llamar a Whisper", async () => {
  clinica.aiTokensUsed = LIMITE - 100;
  const r = await dictar(200_000);
  assert.equal(r.status, 429);
  assert.equal(llamadasWhisper, 0);
  assert.equal(clinica.aiTokensUsed, LIMITE - 100);
});

test("🔴 un archivo de 4 MiB reserva por su tamaño (no 60 s): con cupo para un minuto ya no pasa", async () => {
  duracionWhisper = 3600;
  clinica.aiTokensUsed = LIMITE - 3000; // cabe una grabación normal (2 000), no 4 MiB (~512 s al bitrate nominal)
  const grande = await dictar();
  assert.equal(grande.status, 429);
  assert.equal(llamadasWhisper, 0, "no se le paga a Whisper");
  duracionWhisper = 25;
  const normal = await dictar(200_000);
  assert.equal(normal.status, 200, "una grabación normal sí cabe");
});
