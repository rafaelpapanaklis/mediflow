/**
 * ws1-t5 — POST /api/ai/transcribe exige un permiso coherente con quien ve el
 * micrófono. Antes bastaba la sesión: un rol de solo lectura que llamara a la API
 * directo gastaba el cupo de IA de la clínica.
 *
 * Run: npm run test:dictado-permiso
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const RAIZ = process.cwd();
type Fila = Record<string, any>;

const sesion = { ctx: null as Fila | null };
const cuenta = { whisper: 0, cupo: 0, cobros: 0, interruptor: 0 };

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/auth-context.ts"), { getAuthContext: async () => sesion.ctx }],
  [path.join(RAIZ, "src/lib/rate-limit.ts"), { rateLimit: () => null }],
  [path.join(RAIZ, "src/lib/prisma.ts"), {
    prisma: { clinic: { findUnique: async () => ({ aiTokensUsed: 10, aiTokensLimit: 1000 }) } },
  }],
  [path.join(RAIZ, "src/lib/ai-billing/interruptores.server.ts"), {
    cortarSiIaApagada: async () => { cuenta.interruptor++; return null; },
  }],
  [path.join(RAIZ, "src/lib/ai-tokens.ts"), {
    aiTokenLimitError: async () => { cuenta.cupo++; return null; },
    addAiTokens: async () => { cuenta.cobros++; },
  }],
  [path.join(RAIZ, "src/lib/integrations/whisper.ts"), {
    transcribeAudio: async () => { cuenta.whisper++; return { text: " hola ", duration: 3 }; },
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
  cuenta.whisper = cuenta.cupo = cuenta.cobros = cuenta.interruptor = 0;
  sesion.ctx = null;
});

function conRol(role: string, permissionsOverride: string[] = []) {
  sesion.ctx = { userId: "u1", clinicId: "c1", role, permissionsOverride };
}
function llamar() {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(2000)], { type: "audio/webm" }), "a.webm");
  return POST(new NextRequestCtor("http://localhost/api/ai/transcribe", { method: "POST", body: form }));
}

test("sin sesión: 401 y nada se gasta", async () => {
  const r = await llamar();
  assert.equal(r.status, 401);
  assert.equal(cuenta.whisper, 0);
});

test("🔴 solo lectura: 403, sin leer el cupo, sin llamar a Whisper y sin cobrar", async () => {
  conRol("READONLY");
  const r = await llamar();
  assert.equal(r.status, 403);
  assert.equal(cuenta.interruptor, 0);
  assert.equal(cuenta.cupo, 0);
  assert.equal(cuenta.whisper, 0);
  assert.equal(cuenta.cobros, 0);
});

test("🔴 un override sin ningún permiso de dictado también se corta", async () => {
  conRol("DOCTOR", ["patients.view"]);
  const r = await llamar();
  assert.equal(r.status, 403);
  assert.equal(cuenta.whisper, 0);
});

test("el doctor (expediente) dicta y se cobra", async () => {
  conRol("DOCTOR");
  const r = await llamar();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).text, "hola");
  assert.equal(cuenta.whisper, 1);
  assert.equal(cuenta.cobros, 1);
});

test("quien solo tiene Ortodoncia (override) dicta: ve el micrófono en sus formularios", async () => {
  conRol("DOCTOR", ["specialties.orthodontics"]);
  const r = await llamar();
  assert.equal(r.status, 200);
});

test("el administrador dicta", async () => {
  conRol("ADMIN");
  const r = await llamar();
  assert.equal(r.status, 200);
});
