/**
 * B3 (auditoría 30-sep-2026) — enumeración de cuentas: lo que responden
 * check-email, el login y el registro del portal del paciente y la solicitud
 * ARCO es IGUAL exista o no la cuenta / el paciente.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Estado de los dobles ─────────────────────────────────────────────────────
let sesion: any;
let usuarios: Array<{ id: string }>;
let cuentas: Record<string, any>;
let fallos: any[];
let comparaciones: number;
let correos: any[];
let escrituras: string[];
let pacientes: Record<string, any>;
let arcos: any[];

beforeEach(() => {
  sesion = null;
  usuarios = [];
  fallos = [];
  comparaciones = 0;
  correos = [];
  escrituras = [];
  arcos = [];
  cuentas = {
    "existe@x.mx": { id: "a1", email: "existe@x.mx", name: "Ana", emailVerified: true, passwordHash: "hash-real" },
    "invitada@x.mx": { id: "a2", email: "invitada@x.mx", name: "Inés", emailVerified: false, passwordHash: null },
  };
  pacientes = {
    p1: { id: "p1", clinicId: "clinA", email: "paciente@x.mx" },
    p2: { id: "p2", clinicId: "clinA", email: null },
  };
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      user: { findFirst: async () => (usuarios.length ? usuarios[0] : null) },
      patientAccount: {
        findUnique: async ({ where }: any) => cuentas[where.email] ?? null,
        create: async ({ data }: any) => { escrituras.push("create:" + data.email); return { id: "nueva", ...data }; },
        update: async ({ where }: any) => { escrituras.push("update:" + where.id); return {}; },
      },
      patient: { findUnique: async ({ where }: any) => pacientes[where.id] ?? null },
      arcoRequest: {
        create: async ({ data }: any) => { arcos.push(data); return { id: "arco" + arcos.length, ...data }; },
      },
    },
  },
});
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesion } });
(mock as any).module("@/lib/failban", {
  namedExports: {
    persistentRateLimit: async () => null,
    failbanGuard: async () => null,
    recordAuthFailure: async (_r: any, t: any) => { fallos.push(t); },
    recordAuthSuccess: async () => undefined,
    AUTH_FLOOD_RATE_LIMIT: { limit: 15, windowSec: 60 },
  },
});
(mock as any).module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
(mock as any).module("@/lib/email", { namedExports: { sendEmail: async (m: any) => { correos.push(m); } } });
(mock as any).module("@/lib/patient-portal/crypto", {
  namedExports: {
    verifyPassword: async () => { comparaciones++; return false; },
    hashPassword: async () => { comparaciones++; return "hash"; },
    generateVerifyCode: () => "123456",
    sha256: (v: string) => "sha:" + v,
  },
});
(mock as any).module("@/lib/patient-portal/session", {
  namedExports: { createPatientSession: async () => ({ token: "t", expiresAt: new Date() }), sessionCookieOptions: () => ({}) },
});
(mock as any).module("@/lib/patient-portal/link", { namedExports: { autoLinkPatientsByEmail: async () => 0 } });

const req = (body: unknown, extra: Record<string, unknown> = {}) =>
  ({ json: async () => body, headers: new Headers(), nextUrl: { origin: "https://app.test", searchParams: new URLSearchParams() }, ...extra }) as any;
const lee = async (r: Response) => ({ status: r.status, body: await r.json() });

// ═══ check-email ═════════════════════════════════════════════════════════════
test("check-email sin sesión: el mismo {exists:false} para un correo que existe y para uno que no", async () => {
  const { POST, GET } = await import("@/app/api/auth/check-email/route");
  usuarios = [{ id: "u1" }];
  const existe = await lee(await POST(req({ email: "existe@x.mx" })));
  usuarios = [];
  const noExiste = await lee(await POST(req({ email: "noexiste@x.mx" })));
  assert.deepEqual(existe, noExiste);
  assert.deepEqual(existe.body, { exists: false });

  usuarios = [{ id: "u1" }];
  const viaGet = await lee(await GET({ ...req(null), nextUrl: { searchParams: new URLSearchParams("email=existe@x.mx") } }));
  assert.deepEqual(viaGet.body, { exists: false });
});

test("check-email CON sesión sí responde la verdad", async () => {
  const { POST } = await import("@/app/api/auth/check-email/route");
  sesion = { userId: "u", clinicId: "c" };
  usuarios = [{ id: "u1" }];
  assert.deepEqual((await lee(await POST(req({ email: "existe@x.mx" })))).body, { exists: true });
  usuarios = [];
  assert.deepEqual((await lee(await POST(req({ email: "noexiste@x.mx" })))).body, { exists: false });
});

// ═══ login del portal ════════════════════════════════════════════════════════
test("login del portal: inexistente, invitada sin contraseña y contraseña mala dan LO MISMO (401, texto, bcrypt, fallo)", async () => {
  const { POST } = await import("@/app/api/paciente/login/route");
  const resultados = [];
  for (const email of ["noexiste@x.mx", "invitada@x.mx", "existe@x.mx"]) {
    comparaciones = 0;
    const antes = fallos.length;
    const r = await lee(await POST(req({ email, password: "cualquiera123" })));
    resultados.push({ ...r, comparaciones, fallos: fallos.length - antes });
  }
  assert.equal(resultados[0].status, 401);
  assert.deepEqual(resultados[0], resultados[1]);
  assert.deepEqual(resultados[0], resultados[2]);
  assert.equal(resultados[0].comparaciones, 1, "siempre un bcrypt");
  assert.equal(resultados[0].fallos, 1, "siempre cuenta como fallo");
  assert.ok(!("needsActivation" in resultados[1].body));
});

// ═══ registro del portal ═════════════════════════════════════════════════════
const alta = (email: string) => req({ name: "Ana Pérez", email, phone: "5512345678", password: "contraseña-larga" });

test("registro del portal: un correo con cuenta verificada responde igual que uno nuevo (200, sin 409)", async () => {
  const { POST } = await import("@/app/api/paciente/register/route");
  const nuevo = await lee(await POST(alta("nuevo@x.mx")));
  correos = [];
  escrituras = [];
  const existente = await lee(await POST(alta("existe@x.mx")));
  assert.equal(nuevo.status, 200);
  assert.equal(existente.status, 200);
  assert.deepEqual(Object.keys(existente.body).sort(), Object.keys(nuevo.body).sort());
  assert.equal(existente.body.ok, true);
  // A la cuenta existente NO se le toca nada y su dueño recibe el aviso.
  assert.deepEqual(escrituras, []);
  assert.equal(correos.length, 1);
  assert.equal(correos[0].to, "existe@x.mx");
  assert.match(correos[0].subject, /Ya tienes una cuenta/);
  assert.ok(!/123456/.test(correos[0].html), "no lleva código de verificación");
});

test("registro del portal: el alta nueva y la reclamación de una invitada siguen funcionando", async () => {
  const { POST } = await import("@/app/api/paciente/register/route");
  const nuevo = await lee(await POST(alta("nuevo@x.mx")));
  assert.equal(nuevo.status, 200);
  assert.deepEqual(escrituras, ["create:nuevo@x.mx"]);
  assert.match(correos[0].subject, /123456/);

  escrituras = [];
  correos = [];
  const inv = await lee(await POST(alta("invitada@x.mx")));
  assert.equal(inv.status, 200);
  assert.deepEqual(escrituras, ["update:a2"]);
  assert.match(correos[0].subject, /123456/);
});

// ═══ solicitud ARCO ══════════════════════════════════════════════════════════
const arco = (patientId?: string, email = "paciente@x.mx") =>
  req({ type: "ACCESS", reason: "Quiero conocer mis datos personales", email, ...(patientId ? { patientId } : {}) });

test("ARCO: paciente que existe, que no existe y con otro correo reciben el MISMO 201", async () => {
  const { POST } = await import("@/app/api/arco/request/route");
  const buena = await lee(await POST(arco("p1")));
  const inexistente = await lee(await POST(arco("p-no-existe")));
  const ajena = await lee(await POST(arco("p1", "otro@x.mx")));
  for (const r of [buena, inexistente, ajena]) {
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body).sort(), ["eta", "ok", "requestId"]);
    assert.equal(r.body.eta, buena.body.eta);
  }
  // Solo la que coincide queda en la clínica; las otras dos caen como anónimas.
  assert.equal(arcos[0].clinicId, "clinA");
  assert.equal(arcos[0].patientId, "p1");
  assert.equal(arcos[1].clinicId, null);
  assert.equal(arcos[1].patientId, null);
  assert.equal(arcos[2].clinicId, null);
  assert.equal(arcos[2].patientId, null);
});

test("ARCO: el patientId declarado llega solo al aviso interno, marcado como no verificado", async () => {
  const { POST } = await import("@/app/api/arco/request/route");
  await POST(arco("p-no-existe"));
  assert.match(correos[0].html, /NO verificado/);
  assert.match(correos[0].html, /p-no-existe/);
});
